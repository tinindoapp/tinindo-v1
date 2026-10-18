-- P03 · Motor de agenda: expediente semanal, bloqueios, disponibilidade e reservas.
-- Padrão da ADR-0003: tabela privada com tenant_id NOT NULL + UNIQUE (tenant_id, id) + FKs compostas + RLS;
-- leitura de membro por RLS/RPC; escrita SÓ por RPC transacional.
--
-- Protocolo de todo comando que muda capacidade (docs/02 "Reserva e concorrência"):
--   autoriza → idempotency_claim → trava a linha do recurso (FOR UPDATE) → libera holds vencidos
--   do recurso → valida expediente/bloqueios → grava → a constraint de exclusão é a última barreira
--   → evento (outbox) e auditoria → idempotency_complete. Tudo numa transação.
--
-- Erros: SLOT_CONFLICT (409) para horário ocupado, fora do expediente ou bloqueado; STALE_VERSION (409);
-- POLICY_REJECTED (422) para transição de estado inválida ou hold vencido; NOT_FOUND neutro.
--
-- Depende de: fundação, P02 (customers, provider_services). Preço: até o P05, a reserva confirmada
-- congela o preço base do serviço e quote_id deve ser null (o P05 troca isso por cotação validada).

-- ---------------------------------------------------------------------------
-- Parâmetros do motor
-- ---------------------------------------------------------------------------

create function app.sched_hold_minutes() returns integer
language sql immutable set search_path = '' as $$ select 15 $$;

/** Passo entre inícios de horário oferecidos (minutos). */
create function app.sched_slot_step() returns interval
language sql immutable set search_path = '' as $$ select interval '15 minutes' $$;

create function app.sched_ts(p_ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

create function app.sched_range_json(p_range tstzrange) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('starts_at', app.sched_ts(lower(p_range)), 'ends_at', app.sched_ts(upper(p_range)))
$$;

-- ---------------------------------------------------------------------------
-- Expediente semanal (horário local + timezone do tenant) e bloqueios pessoais
-- ---------------------------------------------------------------------------

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  resource_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  local_start time not null,
  local_end time not null,
  created_at timestamptz not null default now(),
  constraint availability_rules_order check (local_end > local_start),
  constraint availability_rules_resource foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.availability_rules is
  'Expediente semanal em horário local; o conjunto é trocado inteiro por scheduling_rules_save (versão no recurso).';
create index availability_rules_resource on public.availability_rules (tenant_id, resource_id, weekday);

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  resource_id uuid not null,
  period tstzrange not null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  removed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint availability_blocks_period check (
    not isempty(period) and lower_inc(period) and not upper_inc(period)
    and lower(period) is not null and upper(period) is not null
    and upper(period) - lower(period) <= interval '31 days'
  ),
  constraint availability_blocks_resource foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete restrict,
  unique (tenant_id, id)
);
comment on table public.availability_blocks is 'Bloqueio pessoal: indisponibilidade, não cliente fictício (doc06).';
create index availability_blocks_active on public.availability_blocks using gist (tenant_id, resource_id, period)
  where removed_at is null;
create trigger availability_blocks_touch before update on public.availability_blocks
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Reservas. occupied_range inclui os intervalos antes/depois do serviço.
-- ---------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  resource_id uuid not null,
  customer_id uuid,
  guest_ref text check (char_length(btrim(guest_ref)) between 1 and 80),
  service_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_range tstzrange not null,
  -- Só as RPCs escrevem. Verdadeiro enquanto a reserva ocupa a agenda.
  blocks_capacity boolean not null,
  status text not null check (status in ('held', 'confirmed', 'completed', 'expired', 'cancelled', 'no_show')),
  hold_expires_at timestamptz,
  price_quote_id uuid,
  agreed_price_cents bigint check (agreed_price_cents between 0 and 9007199254740991),
  source text not null check (source in ('owner', 'public_link', 'waitlist', 'agent', 'import')),
  series_id uuid,
  -- Motivo de cancelamento/falta informado pelo profissional. Não vai para auditoria nem eventos.
  status_reason text check (char_length(status_reason) <= 280),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint bookings_time check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  constraint bookings_occupied check (
    lower_inc(occupied_range) and not upper_inc(occupied_range)
    and occupied_range @> tstzrange(starts_at, ends_at, '[)')
  ),
  constraint bookings_customer_or_guest check (customer_id is null or guest_ref is null),
  constraint bookings_capacity_by_status check (blocks_capacity = (status in ('held', 'confirmed', 'completed'))),
  constraint bookings_hold_deadline check (status <> 'held' or hold_expires_at is not null),
  constraint bookings_resource foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete restrict,
  constraint bookings_customer foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint bookings_service foreign key (tenant_id, service_id)
    references public.provider_services (tenant_id, id) on delete restrict,
  constraint bookings_no_overlap exclude using gist (
    tenant_id with =, resource_id with =, occupied_range with &&
  ) where (blocks_capacity),
  unique (tenant_id, id)
);
comment on table public.bookings is
  'Reservas. A constraint bookings_no_overlap é a autoridade final sobre capacidade (um atendimento por vez).';
create index bookings_tenant_start on public.bookings (tenant_id, starts_at, id);
create index bookings_held on public.bookings (hold_expires_at) where status = 'held';
create index bookings_customer on public.bookings (tenant_id, customer_id) where customer_id is not null;
create trigger bookings_touch before update on public.bookings
  for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------------

create function app.sched_booking_json(b public.bookings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id,
    'tenant_id', b.tenant_id,
    'resource_id', b.resource_id,
    'customer_id', b.customer_id,
    'service_id', b.service_id,
    'starts_at', app.sched_ts(b.starts_at),
    'ends_at', app.sched_ts(b.ends_at),
    'status', b.status,
    'hold_expires_at', case when b.hold_expires_at is null then null else app.sched_ts(b.hold_expires_at) end,
    'price_quote_id', b.price_quote_id,
    'agreed_price_cents', b.agreed_price_cents,
    'source', b.source,
    'version', b.version
  )
$$;

/** Auditoria sem PII: horários, estado e versão. Motivo e guest_ref ficam fora. */
create function app.sched_booking_audit(b public.bookings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('starts_at', app.sched_ts(b.starts_at), 'ends_at', app.sched_ts(b.ends_at),
    'status', b.status, 'service_id', b.service_id, 'version', b.version)
$$;

create function app.sched_event_payload(b public.bookings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('booking_id', b.id, 'resource_id', b.resource_id, 'service_id', b.service_id,
    'customer_id', b.customer_id, 'starts_at', app.sched_ts(b.starts_at), 'ends_at', app.sched_ts(b.ends_at),
    'agreed_price_cents', b.agreed_price_cents, 'source', b.source)
$$;

/** Expira holds vencidos de um recurso. Chamada SEMPRE com o recurso travado. */
create function app.sched_release_expired(p_tenant_id uuid, p_resource_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.bookings b
  set status = 'expired', blocks_capacity = false
  where b.tenant_id = p_tenant_id and b.resource_id = p_resource_id
    and b.status = 'held' and b.hold_expires_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

/** Trava o recurso (serializa os comandos de capacidade) e libera holds vencidos. */
create function app.sched_lock_resource(p_tenant_id uuid, p_resource_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.resources r
  where r.tenant_id = p_tenant_id and r.id = p_resource_id and r.active
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
  end if;
  perform app.sched_release_expired(p_tenant_id, p_resource_id);
end $$;

/** Expediente (multirange) do recurso na janela, a partir das regras em horário local do tenant. */
create function app.sched_open_hours(p_tenant_id uuid, p_resource_id uuid, p_from timestamptz, p_to timestamptz)
returns tstzmultirange
language sql stable security definer set search_path = '' as $$
  with tz as (select t.timezone from public.tenants t where t.id = p_tenant_id),
  days as (
    select g::date as day
    from tz, generate_series(
      ((p_from at time zone tz.timezone)::date - 1)::timestamp,
      ((p_to at time zone tz.timezone)::date + 1)::timestamp,
      interval '1 day') g
  )
  select coalesce(
    range_agg(tstzrange((d.day + r.local_start) at time zone tz.timezone,
                        (d.day + r.local_end) at time zone tz.timezone, '[)')),
    '{}'::tstzmultirange
  ) * tstzmultirange(tstzrange(p_from, p_to, '[)'))
  from tz
  cross join days d
  join public.availability_rules r
    on r.tenant_id = p_tenant_id and r.resource_id = p_resource_id
   and r.weekday = extract(dow from d.day)::smallint
$$;

/** Tempo ocupado por reservas ativas (holds vencidos não contam) e bloqueios. */
create function app.sched_busy(p_tenant_id uuid, p_resource_id uuid, p_from timestamptz, p_to timestamptz,
  p_exclude_booking uuid default null)
returns tstzmultirange
language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(x.r), '{}'::tstzmultirange) from (
    select b.occupied_range as r
    from public.bookings b
    where b.tenant_id = p_tenant_id and b.resource_id = p_resource_id and b.blocks_capacity
      and not (b.status = 'held' and b.hold_expires_at <= clock_timestamp())
      and b.occupied_range && tstzrange(p_from, p_to, '[)')
      and (p_exclude_booking is null or b.id <> p_exclude_booking)
    union all
    select k.period
    from public.availability_blocks k
    where k.tenant_id = p_tenant_id and k.resource_id = p_resource_id and k.removed_at is null
      and k.period && tstzrange(p_from, p_to, '[)')
  ) x
$$;

/**
 * Horários livres: o atendimento cabe no expediente e o intervalo ocupado (com buffers) não toca
 * reserva ativa nem bloqueio. Não revela quem ocupa os outros horários.
 */
create function app.sched_slots(p_tenant_id uuid, p_resource_id uuid, p_service_id uuid,
  p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_svc public.provider_services;
  v_tz text;
  v_open tstzmultirange;
  v_busy tstzmultirange;
  v_dur interval;
  v_before interval;
  v_after interval;
  v_comp tstzrange;
  v_start timestamptz;
  v_floor timestamptz := greatest(p_from, clock_timestamp());
  v_slots jsonb[] := '{}';
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window';
  end if;
  select * into v_svc from public.provider_services s
  where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  perform 1 from public.resources r where r.tenant_id = p_tenant_id and r.id = p_resource_id and r.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;

  v_dur := make_interval(mins => v_svc.duration_min);
  v_before := make_interval(mins => v_svc.buffer_before_min);
  v_after := make_interval(mins => v_svc.buffer_after_min);
  v_open := app.sched_open_hours(p_tenant_id, p_resource_id, p_from, p_to);
  v_busy := app.sched_busy(p_tenant_id, p_resource_id, p_from - interval '1 day', p_to + interval '1 day');

  for v_comp in select unnest(v_open) loop
    v_start := lower(v_comp);
    while v_start + v_dur <= upper(v_comp) and cardinality(v_slots) < 500 loop
      if v_start >= v_floor
         and not (tstzrange(v_start - v_before, v_start + v_dur + v_after, '[)') && v_busy) then
        v_slots := v_slots || app.sched_range_json(tstzrange(v_start, v_start + v_dur, '[)'));
      end if;
      v_start := v_start + app.sched_slot_step();
    end loop;
  end loop;
  return jsonb_build_object('slots', to_jsonb(v_slots), 'timezone', v_tz);
end $$;

/** Valida que [starts, ends) cabe no expediente e não toca bloqueio. Recurso já travado. */
create function app.sched_assert_bookable(p_tenant_id uuid, p_resource_id uuid, p_occupied tstzrange,
  p_starts timestamptz, p_ends timestamptz)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_starts < clock_timestamp() then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot',
      detail = 'horário no passado';
  end if;
  if not (tstzrange(p_starts, p_ends, '[)') <@ app.sched_open_hours(p_tenant_id, p_resource_id, p_starts, p_ends)) then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', detail = 'fora do expediente';
  end if;
  if exists (
    select 1 from public.availability_blocks k
    where k.tenant_id = p_tenant_id and k.resource_id = p_resource_id and k.removed_at is null
      and k.period && p_occupied
  ) then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', detail = 'bloqueio';
  end if;
end $$;

/**
 * Insere uma reserva seguindo o protocolo (o chamador já autorizou e fez o claim).
 * Reutilizada por booking.create, booking.create_series e, depois, P06/P09.
 */
create function app.sched_insert_booking(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_service_id uuid,
  p_customer_id uuid,
  p_guest_ref text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_quote_id uuid,
  p_mode text,
  p_source text,
  p_series_id uuid,
  p_request_id uuid
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_svc public.provider_services;
  v_occ tstzrange;
  v_row public.bookings;
begin
  if p_mode is null or p_mode not in ('hold', 'confirm') then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'mode';
  end if;
  if p_quote_id is not null then
    -- Cotação validada chega com o P05; até lá a reserva usa o preço base do serviço.
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'quote_id';
  end if;
  if p_customer_id is not null and p_guest_ref is not null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'guest_ref';
  end if;
  if p_customer_id is not null then
    perform 1 from public.customers c
    where c.tenant_id = p_tenant_id and c.id = p_customer_id and c.archived_at is null;
    if not found then
      raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'customer_id';
    end if;
  end if;
  select * into v_svc from public.provider_services s
  where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'service_id';
  end if;
  if p_starts_at is null or p_ends_at is null
     or p_ends_at - p_starts_at <> make_interval(mins => v_svc.duration_min) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot',
      detail = 'duração diferente da do serviço';
  end if;
  v_occ := tstzrange(p_starts_at - make_interval(mins => v_svc.buffer_before_min),
                     p_ends_at + make_interval(mins => v_svc.buffer_after_min), '[)');

  perform app.sched_lock_resource(p_tenant_id, p_resource_id);
  perform app.sched_assert_bookable(p_tenant_id, p_resource_id, v_occ, p_starts_at, p_ends_at);

  begin
    insert into public.bookings (tenant_id, resource_id, customer_id, guest_ref, service_id, starts_at, ends_at,
      occupied_range, blocks_capacity, status, hold_expires_at, price_quote_id, agreed_price_cents, source,
      series_id, created_by)
    values (p_tenant_id, p_resource_id, p_customer_id, nullif(btrim(p_guest_ref), ''), p_service_id,
      p_starts_at, p_ends_at, v_occ, true,
      case when p_mode = 'hold' then 'held' else 'confirmed' end,
      case when p_mode = 'hold' then clock_timestamp() + make_interval(mins => app.sched_hold_minutes()) end,
      null,
      case when p_mode = 'confirm' then v_svc.base_price_cents end,
      p_source, p_series_id, auth.uid())
    returning * into v_row;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT';
  end;

  if v_row.status = 'confirmed' then
    perform app.emit_event(p_tenant_id, 'booking.confirmed.v1', v_row.id, v_row.version,
      coalesce(p_request_id, gen_random_uuid()), app.sched_event_payload(v_row));
  end if;
  perform app.audit(p_tenant_id, 'booking.create', 'booking', v_row.id, p_request_id, null,
    app.sched_booking_audit(v_row));
  return v_row;
end $$;

/** Lê e trava a reserva (depois do recurso, sempre nesta ordem) e confere a versão. */
create function app.sched_lock_booking(p_tenant_id uuid, p_booking_id uuid, p_expected_version integer)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_resource uuid;
  v_row public.bookings;
begin
  select b.resource_id into v_resource from public.bookings b
  where b.tenant_id = p_tenant_id and b.id = p_booking_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  perform app.sched_lock_resource(p_tenant_id, v_resource);
  select * into v_row from public.bookings b
  where b.tenant_id = p_tenant_id and b.id = p_booking_id
  for update;
  if p_expected_version is null or v_row.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs públicas (chamadas pela Edge Function `scheduling` com o JWT do usuário)
-- ---------------------------------------------------------------------------

create function public.scheduling_availability(p_tenant_id uuid, p_resource_id uuid, p_service_id uuid,
  p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return app.sched_slots(p_tenant_id, p_resource_id, p_service_id, p_from, p_to);
end $$;

create function public.scheduling_booking_create(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_service_id uuid,
  p_customer_id uuid,
  p_guest_ref text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_quote_id uuid,
  p_mode text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_row public.bookings;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.create', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  v_row := app.sched_insert_booking(p_tenant_id, p_resource_id, p_service_id, p_customer_id, p_guest_ref,
    p_starts_at, p_ends_at, p_quote_id, p_mode, 'owner', null, p_request_id);
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_row));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/**
 * Recorrência semanal finita: cada ocorrência é materializada e passa pelo mesmo protocolo.
 * all_or_nothing = true: um conflito desfaz tudo (409). false: cria as livres e devolve os conflitos.
 * Nunca diz "série confirmada" se alguma data falhou.
 */
create function public.scheduling_booking_create_series(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_service_id uuid,
  p_customer_id uuid,
  p_guest_ref text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_weeks integer,
  p_all_or_nothing boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_tz text;
  v_series uuid := gen_random_uuid();
  v_local_start timestamp;
  v_local_end timestamp;
  v_starts timestamptz;
  v_ends timestamptz;
  v_row public.bookings;
  v_created jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.create_series', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_weeks is null or p_weeks not between 2 and 12 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'weeks';
  end if;
  if p_all_or_nothing is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'all_or_nothing';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  -- Mesma hora LOCAL a cada semana (atravessa horário de verão sem deslocar o atendimento).
  v_local_start := p_starts_at at time zone v_tz;
  v_local_end := p_ends_at at time zone v_tz;

  for i in 0 .. p_weeks - 1 loop
    v_starts := (v_local_start + make_interval(days => 7 * i)) at time zone v_tz;
    v_ends := (v_local_end + make_interval(days => 7 * i)) at time zone v_tz;
    begin
      v_row := app.sched_insert_booking(p_tenant_id, p_resource_id, p_service_id, p_customer_id, p_guest_ref,
        v_starts, v_ends, null, 'confirm', 'owner', v_series, p_request_id);
      v_created := v_created || jsonb_build_array(app.sched_booking_json(v_row));
    exception when sqlstate 'PT409' then
      if p_all_or_nothing then
        raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'series',
          detail = format('ocorrência %s indisponível', i + 1);
      end if;
      v_conflicts := v_conflicts || jsonb_build_array(app.sched_range_json(tstzrange(v_starts, v_ends, '[)')));
    end;
  end loop;

  if jsonb_array_length(v_created) = 0 then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'series';
  end if;
  v_body := jsonb_build_object('series_id', v_series, 'created', v_created, 'conflicts', v_conflicts);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.create_series', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

/** held → confirmed. O prazo é conferido no banco (clock_timestamp), não no cliente. */
create function public.scheduling_booking_confirm(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.bookings;
  v_new public.bookings;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.confirm', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  -- O lock do recurso já expira holds vencidos: depois dele, um hold vencido aparece como 'expired'.
  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_old.status <> 'held' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED',
      hint = case when v_old.status = 'expired' then 'hold_expires_at' else 'status' end;
  end if;

  update public.bookings b
  set status = 'confirmed', hold_expires_at = null,
      agreed_price_cents = (select s.base_price_cents from public.provider_services s
                            where s.tenant_id = b.tenant_id and s.id = b.service_id)
  where b.tenant_id = p_tenant_id and b.id = p_booking_id
  returning * into v_new;

  perform app.emit_event(p_tenant_id, 'booking.confirmed.v1', v_new.id, v_new.version,
    coalesce(p_request_id, gen_random_uuid()), app.sched_event_payload(v_new));
  perform app.audit(p_tenant_id, 'booking.confirm', 'booking', v_new.id, p_request_id,
    app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.confirm', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Atômico: ou o novo horário entra e o anterior sai, ou nada muda. Preço combinado é mantido. */
create function public.scheduling_booking_reschedule(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_quote_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.bookings;
  v_new public.bookings;
  v_svc public.provider_services;
  v_occ tstzrange;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.reschedule', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_quote_id is not null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'quote_id';
  end if;

  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_old.status not in ('held', 'confirmed') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  select * into v_svc from public.provider_services s where s.tenant_id = p_tenant_id and s.id = v_old.service_id;
  if p_starts_at is null or p_ends_at is null
     or p_ends_at - p_starts_at <> make_interval(mins => v_svc.duration_min) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'slot',
      detail = 'duração diferente da do serviço';
  end if;
  v_occ := tstzrange(p_starts_at - make_interval(mins => v_svc.buffer_before_min),
                     p_ends_at + make_interval(mins => v_svc.buffer_after_min), '[)');
  perform app.sched_assert_bookable(p_tenant_id, v_old.resource_id, v_occ, p_starts_at, p_ends_at);

  begin
    update public.bookings b
    set starts_at = p_starts_at, ends_at = p_ends_at, occupied_range = v_occ
    where b.tenant_id = p_tenant_id and b.id = p_booking_id
    returning * into v_new;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT';
  end;

  perform app.audit(p_tenant_id, 'booking.reschedule', 'booking', v_new.id, p_request_id,
    app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.reschedule', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** held|confirmed → cancelled. Libera a capacidade e emite o evento na mesma transação. */
create function public.scheduling_booking_cancel(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.bookings;
  v_new public.bookings;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.cancel', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;

  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_old.status not in ('held', 'confirmed') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;

  update public.bookings b
  set status = 'cancelled', blocks_capacity = false, hold_expires_at = null, status_reason = btrim(p_reason)
  where b.tenant_id = p_tenant_id and b.id = p_booking_id
  returning * into v_new;

  perform app.emit_event(p_tenant_id, 'booking.cancelled.v1', v_new.id, v_new.version,
    coalesce(p_request_id, gen_random_uuid()),
    app.sched_event_payload(v_new) || jsonb_build_object('previous_status', v_old.status));
  perform app.audit(p_tenant_id, 'booking.cancel', 'booking', v_new.id, p_request_id,
    app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.cancel', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** confirmed → completed, só depois do início. Não registra pagamento (P07 escuta o evento). */
create function public.scheduling_booking_complete(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.bookings;
  v_new public.bookings;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.complete', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_old.status <> 'confirmed' then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if v_old.starts_at > clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'starts_at';
  end if;

  update public.bookings b set status = 'completed'
  where b.tenant_id = p_tenant_id and b.id = p_booking_id
  returning * into v_new;

  perform app.emit_event(p_tenant_id, 'booking.completed.v1', v_new.id, v_new.version,
    coalesce(p_request_id, gen_random_uuid()), app.sched_event_payload(v_new));
  perform app.audit(p_tenant_id, 'booking.complete', 'booking', v_new.id, p_request_id,
    app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.complete', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** confirmed → no_show (depois do início), ou no_show → confirmed com p_revert. Motivo obrigatório. */
create function public.scheduling_booking_no_show(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_reason text,
  p_revert boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.bookings;
  v_new public.bookings;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.no_show', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 280 or p_revert is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;

  v_old := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if (not p_revert and v_old.status <> 'confirmed') or (p_revert and v_old.status <> 'no_show') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  if v_old.starts_at > clock_timestamp() then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'starts_at';
  end if;

  begin
    update public.bookings b
    set status = case when p_revert then 'confirmed' else 'no_show' end,
        blocks_capacity = p_revert,
        status_reason = btrim(p_reason)
    where b.tenant_id = p_tenant_id and b.id = p_booking_id
    returning * into v_new;
  exception when exclusion_violation then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT';
  end;

  perform app.audit(p_tenant_id, case when p_revert then 'booking.no_show_revert' else 'booking.no_show' end,
    'booking', v_new.id, p_request_id, app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
  v_body := jsonb_build_object('booking', app.sched_booking_json(v_new));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.no_show', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Atendimentos que começam na janela (todos os estados), keyset em (starts_at, id). */
create function public.scheduling_booking_list(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_after_starts timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 100
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_rows public.bookings[];
  v_last public.bookings;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window';
  end if;
  if (p_after_starts is null) <> (p_after_id is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cursor';
  end if;

  select coalesce(array_agg(x order by x.starts_at, x.id), '{}') into v_rows from (
    select * from public.bookings b
    where b.tenant_id = p_tenant_id and b.starts_at >= p_from and b.starts_at < p_to
      and (p_after_starts is null or (b.starts_at, b.id) > (p_after_starts, p_after_id))
    order by b.starts_at, b.id
    limit v_limit + 1
  ) x;

  if cardinality(v_rows) > v_limit then
    v_last := v_rows[v_limit];
    v_rows := v_rows[1:v_limit];
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(app.sched_booking_json(r) order by r.starts_at, r.id) from unnest(v_rows) r),
                      '[]'::jsonb),
    'next', case when v_last.id is null then null
                 else jsonb_build_object('key', app.sched_ts(v_last.starts_at), 'id', v_last.id) end
  );
end $$;

create function public.scheduling_booking_get(p_tenant_id uuid, p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.bookings;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select * into v_row from public.bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('booking', app.sched_booking_json(v_row));
end $$;

/** Recurso ativo, timezone e expediente semanal (para a tela e para o contexto da agenda). */
create function public.scheduling_settings(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_res public.resources;
  v_tz text;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  select * into v_res from public.resources r where r.tenant_id = p_tenant_id and r.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  return jsonb_build_object(
    'resource_id', v_res.id,
    'resource_version', v_res.version,
    'timezone', v_tz,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', r.weekday,
        'local_start', to_char(r.local_start, 'HH24:MI'), 'local_end', to_char(r.local_end, 'HH24:MI'))
        order by r.weekday, r.local_start)
      from public.availability_rules r where r.tenant_id = p_tenant_id and r.resource_id = v_res.id
    ), '[]'::jsonb)
  );
end $$;

/**
 * Troca o expediente semanal inteiro. Versão otimista no recurso. Reservas existentes não mudam:
 * o novo expediente vale para novos horários.
 */
create function public.scheduling_rules_save(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_expected_version integer,
  p_rules jsonb,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_res public.resources;
  v_before jsonb;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'schedule.rules_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 50 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'rules';
  end if;

  select * into v_res from public.resources r
  where r.tenant_id = p_tenant_id and r.id = p_resource_id and r.active
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
  end if;
  if p_expected_version is null or v_res.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;

  begin
    perform 1 from jsonb_to_recordset(p_rules) as n(weekday smallint, local_start time, local_end time);
  exception when others then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'rules';
  end;
  if exists (
       select 1 from jsonb_to_recordset(p_rules) as n(weekday smallint, local_start time, local_end time)
       where n.weekday is null or n.weekday not between 0 and 6
          or n.local_start is null or n.local_end is null or n.local_end <= n.local_start)
     or exists (
       with n as (
         select row_number() over () as i, x.*
         from jsonb_to_recordset(p_rules) as x(weekday smallint, local_start time, local_end time)
       )
       select 1 from n a join n b
         on a.weekday = b.weekday and a.i < b.i and a.local_start < b.local_end and b.local_start < a.local_end) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'rules';
  end if;

  v_before := (public.scheduling_settings(p_tenant_id))->'rules';
  delete from public.availability_rules r where r.tenant_id = p_tenant_id and r.resource_id = p_resource_id;
  insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
  select p_tenant_id, p_resource_id, n.weekday, n.local_start, n.local_end
  from jsonb_to_recordset(p_rules) as n(weekday smallint, local_start time, local_end time);
  -- Toca o recurso para subir a versão (trigger app.touch_row).
  update public.resources r set name = r.name where r.tenant_id = p_tenant_id and r.id = p_resource_id;

  v_body := public.scheduling_settings(p_tenant_id);
  perform app.audit(p_tenant_id, 'schedule.rules_save', 'resource', p_resource_id, p_request_id,
    jsonb_build_object('rules', v_before), jsonb_build_object('rules', v_body->'rules'));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'schedule.rules_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function app.sched_block_json(k public.availability_blocks) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', k.id, 'range', app.sched_range_json(k.period), 'label', k.label, 'version', k.version)
$$;

/** Bloqueio pessoal. Não pode cobrir reserva ativa (cancelar/reagendar antes): 409. */
create function public.scheduling_block_create(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_label text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_row public.availability_blocks;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'schedule.block_create', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at - p_starts_at > interval '31 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'range';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 80 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'label';
  end if;

  perform app.sched_lock_resource(p_tenant_id, p_resource_id);
  if exists (
    select 1 from public.bookings b
    where b.tenant_id = p_tenant_id and b.resource_id = p_resource_id and b.blocks_capacity
      and b.status in ('held', 'confirmed')
      and b.occupied_range && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', detail = 'há reserva no período';
  end if;

  insert into public.availability_blocks (tenant_id, resource_id, period, label, created_by)
  values (p_tenant_id, p_resource_id, tstzrange(p_starts_at, p_ends_at, '[)'), btrim(p_label), v_uid)
  returning * into v_row;

  v_body := jsonb_build_object('block', app.sched_block_json(v_row));
  perform app.audit(p_tenant_id, 'schedule.block_create', 'availability_block', v_row.id, p_request_id, null,
    jsonb_build_object('range', app.sched_range_json(v_row.period)));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'schedule.block_create', p_idem_key, 201, v_body);
  return jsonb_build_object('status_code', 201, 'body', v_body);
end $$;

create function public.scheduling_block_remove(
  p_tenant_id uuid,
  p_block_id uuid,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_old public.availability_blocks;
  v_new public.availability_blocks;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'schedule.block_remove', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;

  select * into v_old from public.availability_blocks k
  where k.tenant_id = p_tenant_id and k.id = p_block_id and k.removed_at is null
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  update public.availability_blocks k set removed_at = now()
  where k.tenant_id = p_tenant_id and k.id = p_block_id
  returning * into v_new;

  v_body := jsonb_build_object('block', app.sched_block_json(v_new));
  perform app.audit(p_tenant_id, 'schedule.block_remove', 'availability_block', v_new.id, p_request_id,
    jsonb_build_object('range', app.sched_range_json(v_old.period)), null);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'schedule.block_remove', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/**
 * Expediente por dia local na janela: abertos (componentes do multirange), pausas (lacunas entre
 * componentes do mesmo dia) e bloqueios ativos.
 */
create function public.scheduling_day_plans(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_res uuid;
  v_tz text;
  v_days jsonb := '[]'::jsonb;
  v_day date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_open jsonb;
  v_pauses jsonb;
  v_blocks jsonb;
  v_prev timestamptz;
  v_comp tstzrange;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window';
  end if;
  select r.id into v_res from public.resources r where r.tenant_id = p_tenant_id and r.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;

  v_day := (p_from at time zone v_tz)::date;
  while (v_day::timestamp at time zone v_tz) < p_to loop
    v_day_start := v_day::timestamp at time zone v_tz;
    v_day_end := (v_day + 1)::timestamp at time zone v_tz;
    v_open := '[]'::jsonb;
    v_pauses := '[]'::jsonb;
    v_prev := null;
    for v_comp in select unnest(app.sched_open_hours(p_tenant_id, v_res, v_day_start, v_day_end)) loop
      v_open := v_open || jsonb_build_array(app.sched_range_json(v_comp));
      if v_prev is not null then
        v_pauses := v_pauses || jsonb_build_array(app.sched_range_json(tstzrange(v_prev, lower(v_comp), '[)')));
      end if;
      v_prev := upper(v_comp);
    end loop;
    select coalesce(jsonb_agg(app.sched_block_json(k) order by lower(k.period)), '[]'::jsonb) into v_blocks
    from public.availability_blocks k
    where k.tenant_id = p_tenant_id and k.resource_id = v_res and k.removed_at is null
      and k.period && tstzrange(v_day_start, v_day_end, '[)');
    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'date', to_char(v_day, 'YYYY-MM-DD'), 'open', v_open, 'pauses', v_pauses, 'blocks', v_blocks));
    v_day := v_day + 1;
  end loop;
  return jsonb_build_object('resource_id', v_res, 'timezone', v_tz, 'days', v_days);
end $$;

/**
 * Horários do link público (P09): só negócio ativo com perfil publicado, recurso ativo e serviço ativo.
 * Devolve apenas os horários livres; nunca tenant, recurso, reservas ou clientes.
 */
create function public.scheduling_public_slots(p_slug text, p_service_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_res uuid;
begin
  select p.tenant_id into v_tenant
  from public.public_profiles p join public.tenants t on t.id = p.tenant_id
  where p.slug = p_slug and p.published_at is not null and t.status = 'active';
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '14 days' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'window';
  end if;
  select r.id into v_res from public.resources r where r.tenant_id = v_tenant and r.active;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return app.sched_slots(v_tenant, v_res, p_service_id, p_from, p_to);
end $$;

/** Varredura de holds vencidos (cron/worker do P06). Correção não depende dela: os comandos liberam sob lock. */
create function public.scheduling_expire_holds() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.bookings b
  set status = 'expired', blocks_capacity = false
  where b.status = 'held' and b.hold_expires_at <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.sched_hold_minutes() from public;
revoke all on function app.sched_slot_step() from public;
revoke all on function app.sched_ts(timestamptz) from public;
revoke all on function app.sched_range_json(tstzrange) from public;
revoke all on function app.sched_booking_json(public.bookings) from public;
revoke all on function app.sched_booking_audit(public.bookings) from public;
revoke all on function app.sched_event_payload(public.bookings) from public;
revoke all on function app.sched_release_expired(uuid, uuid) from public;
revoke all on function app.sched_lock_resource(uuid, uuid) from public;
revoke all on function app.sched_open_hours(uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function app.sched_busy(uuid, uuid, timestamptz, timestamptz, uuid) from public;
revoke all on function app.sched_slots(uuid, uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function app.sched_assert_bookable(uuid, uuid, tstzrange, timestamptz, timestamptz) from public;
revoke all on function app.sched_insert_booking(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, uuid, uuid) from public;
revoke all on function app.sched_lock_booking(uuid, uuid, integer) from public;
revoke all on function app.sched_block_json(public.availability_blocks) from public;
grant execute on function app.sched_insert_booking(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, uuid, uuid) to service_role;
grant execute on function app.sched_slots(uuid, uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function app.sched_lock_resource(uuid, uuid) to service_role;
grant execute on function app.sched_booking_json(public.bookings) to service_role;

revoke all on function public.scheduling_availability(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.scheduling_booking_create(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.scheduling_booking_create_series(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, integer, boolean, text, text, uuid) from public, anon;
revoke all on function public.scheduling_booking_confirm(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.scheduling_booking_reschedule(uuid, uuid, integer, timestamptz, timestamptz, uuid, text, text, uuid) from public, anon;
revoke all on function public.scheduling_booking_cancel(uuid, uuid, integer, text, text, text, uuid) from public, anon;
revoke all on function public.scheduling_booking_complete(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.scheduling_booking_no_show(uuid, uuid, integer, text, boolean, text, text, uuid) from public, anon;
revoke all on function public.scheduling_booking_list(uuid, timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon;
revoke all on function public.scheduling_booking_get(uuid, uuid) from public, anon;
revoke all on function public.scheduling_settings(uuid) from public, anon;
revoke all on function public.scheduling_rules_save(uuid, uuid, integer, jsonb, text, text, uuid) from public, anon;
revoke all on function public.scheduling_block_create(uuid, uuid, timestamptz, timestamptz, text, text, text, uuid) from public, anon;
revoke all on function public.scheduling_block_remove(uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.scheduling_day_plans(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.scheduling_public_slots(text, uuid, timestamptz, timestamptz) from public;
revoke all on function public.scheduling_expire_holds() from public, anon, authenticated;

grant execute on function public.scheduling_availability(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.scheduling_booking_create(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.scheduling_booking_create_series(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, integer, boolean, text, text, uuid) to authenticated;
grant execute on function public.scheduling_booking_confirm(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.scheduling_booking_reschedule(uuid, uuid, integer, timestamptz, timestamptz, uuid, text, text, uuid) to authenticated;
grant execute on function public.scheduling_booking_cancel(uuid, uuid, integer, text, text, text, uuid) to authenticated;
grant execute on function public.scheduling_booking_complete(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.scheduling_booking_no_show(uuid, uuid, integer, text, boolean, text, text, uuid) to authenticated;
grant execute on function public.scheduling_booking_list(uuid, timestamptz, timestamptz, timestamptz, uuid, integer) to authenticated;
grant execute on function public.scheduling_booking_get(uuid, uuid) to authenticated;
grant execute on function public.scheduling_settings(uuid) to authenticated;
grant execute on function public.scheduling_rules_save(uuid, uuid, integer, jsonb, text, text, uuid) to authenticated;
grant execute on function public.scheduling_block_create(uuid, uuid, timestamptz, timestamptz, text, text, text, uuid) to authenticated;
grant execute on function public.scheduling_block_remove(uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.scheduling_day_plans(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.scheduling_public_slots(text, uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.scheduling_expire_holds() to service_role;

alter table public.availability_rules enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.bookings enable row level security;

revoke all on public.availability_rules, public.availability_blocks, public.bookings from anon, authenticated;
grant select on public.availability_rules, public.availability_blocks to authenticated;
-- Leitura direta sem as colunas de texto livre do profissional (motivo, referência de visitante, autor):
-- o cliente vinculado lê a própria reserva, nunca a anotação sobre ela.
grant select (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, status, hold_expires_at,
  price_quote_id, agreed_price_cents, source, series_id, created_at, updated_at, version)
  on public.bookings to authenticated;
grant select, insert, update, delete on public.availability_rules, public.availability_blocks, public.bookings
  to service_role;

create policy availability_rules_select_member on public.availability_rules
  for select to authenticated using (app.is_member(tenant_id));
create policy availability_blocks_select_member on public.availability_blocks
  for select to authenticated using (app.is_member(tenant_id));
create policy bookings_select_member on public.bookings
  for select to authenticated using (app.is_member(tenant_id));
-- Cliente vinculado (P01) vê só as próprias reservas; nunca as de outros clientes.
create policy bookings_select_linked_customer on public.bookings
  for select to authenticated
  using (customer_id is not null and customer_id = app.linked_customer_id(tenant_id));

-- Agenda do personal completa (pendências do handoff P51 "Repetir toda semana"; recado de P51-claude-p51).
-- 1. `series_id` na leitura do atendimento (booking.get, booking.list, booking.list_by_customer e toda resposta que
--    usa app.sched_booking_json): a tela deixa de guardar a série na memória do aparelho.
-- 2. `booking.create_series` com vários dias da semana numa série só (`p_weekdays`): terça e quinta viram UM
--    series_id. Sem `p_weekdays`, o comportamento é o de antes (o dia da semana do primeiro horário).
-- 3. `booking.series` (leitura): os atendimentos de uma série, para "3 de 16" e "Abrir o próximo".
-- 4. `booking.cancel_series_from`: cancela este atendimento e os próximos da mesma série numa transação, idempotente,
--    com motivo; atendimentos passados, concluídos ou já cancelados ficam como estão.
-- 5. Trava de módulo no servidor: `app.module_guard` recusa operação de módulo desligado para o negócio (403
--    FORBIDDEN, hint module_disabled) e `app.authorize` junta papel e módulo. Aplicada primeiro na Agenda: nos
--    comandos (pela trava do recurso, que todos usam), nas leituras e nas operações novas. A Agenda é do piloto e está
--    sempre ligada; a trava vale para quando um módulo guardado usar a mesma função.
-- Depende de: P03 (motor), P51 (chave de módulo), P05 (sched_insert_booking).

-- ---------------------------------------------------------------------------
-- Trava de módulo (comum)
-- ---------------------------------------------------------------------------

/** Recusa a operação quando o módulo está desligado para o negócio. Não autoriza ninguém: só nega. */
create function app.module_guard(p_tenant_id uuid, p_module text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.module_level(p_module) is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'module';
  end if;
  if not app.module_enabled(p_tenant_id, p_module) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', hint = 'module_disabled';
  end if;
end $$;
revoke all on function app.module_guard(uuid, text) from public, anon, authenticated;

/** Autorização de RPC de módulo: papel no negócio e módulo ligado, nessa ordem (quem não é membro não descobre nada). */
create function app.authorize(p_tenant_id uuid, p_roles text[], p_module text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, p_roles) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  perform app.module_guard(p_tenant_id, p_module);
end $$;
revoke all on function app.authorize(uuid, text[], text) from public, anon, authenticated;

-- Todos os comandos da Agenda (criar, série, confirmar, reagendar, cancelar, concluir, falta, bloqueios e o pedido
-- pelo link) passam por esta trava. Última definição: 20261018130000_p03_scheduling.sql, mais a trava de módulo.
create or replace function app.sched_lock_resource(p_tenant_id uuid, p_resource_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.module_guard(p_tenant_id, 'scheduling');
  perform 1 from public.resources r
  where r.tenant_id = p_tenant_id and r.id = p_resource_id and r.active
  for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'resource_id';
  end if;
  perform app.sched_release_expired(p_tenant_id, p_resource_id);
end $$;

-- ---------------------------------------------------------------------------
-- series_id na leitura
-- ---------------------------------------------------------------------------

-- Última definição: 20261029030000_booking_status_reason.sql, mais series_id.
create or replace function app.sched_booking_json(b public.bookings) returns jsonb
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
    'status_reason', case when b.status in ('cancelled', 'no_show') then b.status_reason end,
    'hold_expires_at', case when b.hold_expires_at is null then null else app.sched_ts(b.hold_expires_at) end,
    'price_quote_id', b.price_quote_id,
    'agreed_price_cents', b.agreed_price_cents,
    'source', b.source,
    'series_id', b.series_id,
    'version', b.version
  )
$$;

create index if not exists bookings_series on public.bookings (tenant_id, series_id, starts_at) where series_id is not null;

-- Leituras com a trava de módulo. Última definição: 20261018130000_p03_scheduling.sql.
create or replace function public.scheduling_booking_list(
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
  perform app.authorize(p_tenant_id, array['owner', 'staff'], 'scheduling');
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

create or replace function public.scheduling_booking_get(p_tenant_id uuid, p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.bookings;
begin
  perform app.authorize(p_tenant_id, array['owner', 'staff'], 'scheduling');
  select * into v_row from public.bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('booking', app.sched_booking_json(v_row));
end $$;

/** booking.series: todos os atendimentos de uma série, em ordem (no máximo 84 = 12 semanas × 7 dias). */
create function public.scheduling_booking_series(p_tenant_id uuid, p_series_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_items jsonb;
begin
  perform app.authorize(p_tenant_id, array['owner', 'staff'], 'scheduling');
  select jsonb_agg(app.sched_booking_json(b) order by b.starts_at, b.id) into v_items
  from public.bookings b where b.tenant_id = p_tenant_id and b.series_id = p_series_id;
  if v_items is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  return jsonb_build_object('series_id', p_series_id, 'bookings', v_items);
end $$;
revoke all on function public.scheduling_booking_series(uuid, uuid) from public, anon;
grant execute on function public.scheduling_booking_series(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Série com vários dias da semana
-- ---------------------------------------------------------------------------

drop function public.scheduling_booking_create_series(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, integer, boolean, text, text, uuid);

/**
 * Repetição semanal finita, sempre confirmada pelo dono. `p_weekdays` (0 = domingo … 6 = sábado, no fuso do negócio):
 * para cada dia, a primeira data a partir do dia do primeiro horário, à mesma hora local, repetida `p_weeks` semanas.
 * Todas as ocorrências têm o mesmo series_id. Sem `p_weekdays`, só o dia do primeiro horário (como antes).
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
  p_request_id uuid default null,
  p_weekdays integer[] default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_tz text;
  v_series uuid := gen_random_uuid();
  v_local_start timestamp;
  v_local_end timestamp;
  v_first_dow integer;
  v_days integer[];
  v_offset integer;
  v_starts timestamptz;
  v_ends timestamptz;
  v_row public.bookings;
  v_created jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_body jsonb;
  d integer;
  r record;
begin
  perform app.authorize(p_tenant_id, array['owner'], 'scheduling');
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.create_series', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_weeks is null or p_weeks not between 2 and 12 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'weeks';
  end if;
  if p_all_or_nothing is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'all_or_nothing';
  end if;
  if p_weekdays is not null and (cardinality(p_weekdays) not between 1 and 7
      or exists (select 1 from unnest(p_weekdays) w where w is null or w not between 0 and 6)
      or (select count(distinct w) from unnest(p_weekdays) w) <> cardinality(p_weekdays)) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'weekdays';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  -- Mesma hora LOCAL a cada semana (atravessa horário de verão sem deslocar o atendimento).
  v_local_start := p_starts_at at time zone v_tz;
  v_local_end := p_ends_at at time zone v_tz;
  v_first_dow := extract(dow from v_local_start)::integer;
  v_days := coalesce(p_weekdays, array[v_first_dow]);

  -- Ocorrências em ordem de data: (semana, distância do dia em relação ao primeiro horário).
  for r in
    select i, ((dd - v_first_dow + 7) % 7) as off
    from generate_series(0, p_weeks - 1) i, unnest(v_days) dd
    order by i, ((dd - v_first_dow + 7) % 7)
  loop
    v_offset := r.i * 7 + r.off;
    v_starts := (v_local_start + make_interval(days => v_offset)) at time zone v_tz;
    v_ends := (v_local_end + make_interval(days => v_offset)) at time zone v_tz;
    begin
      v_row := app.sched_insert_booking(p_tenant_id, p_resource_id, p_service_id, p_customer_id, p_guest_ref,
        v_starts, v_ends, null, 'confirm', 'owner', v_series, p_request_id);
      v_created := v_created || jsonb_build_array(app.sched_booking_json(v_row));
    exception when sqlstate 'PT409' then
      if p_all_or_nothing then
        raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'series',
          detail = format('ocorrência em %s indisponível', to_char(v_starts at time zone v_tz, 'DD/MM HH24:MI'));
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
revoke all on function public.scheduling_booking_create_series(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, integer, boolean, text, text, uuid, integer[]) from public, anon;
grant execute on function public.scheduling_booking_create_series(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, integer, boolean, text, text, uuid, integer[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancelar este e os próximos
-- ---------------------------------------------------------------------------

/**
 * booking.cancel_series_from: cancela o atendimento indicado e os seguintes da mesma série (que começam depois dele)
 * ainda marcados (held ou confirmed), numa transação, com o mesmo motivo. Os passados, concluídos, com falta ou já
 * cancelados ficam como estão e voltam em `kept`. Idempotente pela chave. A versão confere só o atendimento indicado
 * (é o que a pessoa está vendo); os outros são travados pelo recurso.
 */
create function public.scheduling_booking_cancel_series_from(
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
  v_first public.bookings;
  v_old public.bookings;
  v_new public.bookings;
  v_cancelled jsonb := '[]'::jsonb;
  v_kept integer;
  v_body jsonb;
begin
  perform app.authorize(p_tenant_id, array['owner'], 'scheduling');
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'booking.cancel_series_from', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 280 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'reason';
  end if;

  v_first := app.sched_lock_booking(p_tenant_id, p_booking_id, p_expected_version);
  if v_first.series_id is null then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'series';
  end if;
  if v_first.status not in ('held', 'confirmed') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;

  for v_old in
    select * from public.bookings b
    where b.tenant_id = p_tenant_id and b.series_id = v_first.series_id and b.starts_at >= v_first.starts_at
      and b.status in ('held', 'confirmed')
    order by b.starts_at, b.id
    for update
  loop
    update public.bookings b
    set status = 'cancelled', blocks_capacity = false, hold_expires_at = null, status_reason = btrim(p_reason)
    where b.tenant_id = p_tenant_id and b.id = v_old.id
    returning * into v_new;
    perform app.emit_event(p_tenant_id, 'booking.cancelled.v1', v_new.id, v_new.version,
      coalesce(p_request_id, gen_random_uuid()),
      app.sched_event_payload(v_new) || jsonb_build_object('previous_status', v_old.status, 'series_id', v_new.series_id));
    perform app.audit(p_tenant_id, 'booking.cancel_series_from', 'booking', v_new.id, p_request_id,
      app.sched_booking_audit(v_old), app.sched_booking_audit(v_new));
    v_cancelled := v_cancelled || jsonb_build_array(app.sched_booking_json(v_new));
  end loop;

  select count(*)::integer into v_kept from public.bookings b
  where b.tenant_id = p_tenant_id and b.series_id = v_first.series_id and b.starts_at >= v_first.starts_at
    and b.status not in ('held', 'confirmed', 'cancelled');
  v_body := jsonb_build_object('series_id', v_first.series_id, 'cancelled', v_cancelled, 'kept', v_kept);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'booking.cancel_series_from', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;
revoke all on function public.scheduling_booking_cancel_series_from(uuid, uuid, integer, text, text, text, uuid) from public, anon;
grant execute on function public.scheduling_booking_cancel_series_from(uuid, uuid, integer, text, text, text, uuid) to authenticated;

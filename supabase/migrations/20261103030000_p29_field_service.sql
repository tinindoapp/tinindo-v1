-- P29 · Serviço a domicílio: área de atendimento por bairro/CEP e distância declarada; deslocamento entre atendimentos
-- ocupando a agenda; janela de chegada para o cliente; roteiro do dia em ordem.
-- Invariantes (docs/02, docs/04, docs/17, tasks/P29, ADR-0034):
-- * Localização só para isso e com precisão limitada: zona (bairro) e prefixo de CEP de 5 dígitos. Nunca endereço,
--   coordenada ou rastreamento: não há coluna para isso.
-- * Deslocamento entra na disponibilidade: vira um bloqueio da agenda do P03 (availability_blocks, rótulo
--   "Deslocamento"), então some dos horários livres, do link público (P43) e da criação de reservas, sem mudar o motor.
-- * O roteiro do dia é refeito por inteiro sob o lock do recurso do P03 (mesma ordem de trava da agenda): ou todos os
--   deslocamentos cabem, ou nada muda (SLOT_CONFLICT, campo travel).
-- * Fora da área (zona inativa ou além da distância máxima) não vira visita.
-- Fora deste pacote: contratação pelo marketplace (P25).
-- Depende de: fundação, P02 (customers, provider_services), P03 (resources, bookings, availability_blocks, agenda).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.field_settings (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  enabled boolean not null default true,
  -- Minutos de deslocamento quando não há tempo cadastrado entre as duas zonas.
  default_travel_min integer not null default 30 check (default_travel_min between 0 and 240),
  -- Entre dois atendimentos na mesma zona.
  same_zone_travel_min integer not null default 10 check (same_zone_travel_min between 0 and 120),
  -- Janela de chegada mostrada ao cliente: chegada entre (início − janela) e o início.
  arrival_window_min integer not null default 30 check (arrival_window_min between 0 and 120),
  -- Área por distância: zonas com distância declarada acima disto ficam fora (nulo = sem limite).
  max_km numeric(5, 1) check (max_km > 0 and max_km <= 200),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);
comment on table public.field_settings is 'Regras do atendimento a domicílio do negócio. Sem endereço nem coordenada.';
create trigger field_settings_touch before update on public.field_settings for each row execute function app.touch_row();

/** Prefixos de CEP válidos: exatamente 5 dígitos cada. */
create function app.fs_ceps_ok(p text[]) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(bool_and(x ~ '^[0-9]{5}$'), true) from unnest(p) x $$;

create table public.field_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- Prefixos de CEP de 5 dígitos que caem nesta zona (setor postal, não rua).
  cep_prefixes text[] not null default '{}' check (array_position(cep_prefixes, null) is null and cardinality(cep_prefixes) <= 50),
  -- Distância aproximada da base, declarada pelo dono (km). Sem geocodificação.
  distance_km numeric(5, 1) not null check (distance_km >= 0 and distance_km <= 200),
  -- Minutos da base até a zona (primeira visita do dia).
  travel_from_base_min integer not null check (travel_from_base_min between 0 and 240),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint field_zones_ceps check (app.fs_ceps_ok(cep_prefixes)),
  unique (tenant_id, id)
);
comment on table public.field_zones is 'Zona de atendimento (bairro) com prefixos de CEP e distância declarada. Precisão limitada por desenho.';
create unique index field_zones_unique_name on public.field_zones (tenant_id, lower(btrim(name))) where active;
create trigger field_zones_touch before update on public.field_zones for each row execute function app.touch_row();

create table public.field_travel_times (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  -- Par guardado em ordem (zone_a < zone_b): o tempo vale nos dois sentidos.
  zone_a uuid not null,
  zone_b uuid not null,
  minutes integer not null check (minutes between 0 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint field_travel_times_order check (zone_a < zone_b),
  constraint field_travel_times_a foreign key (tenant_id, zone_a) references public.field_zones (tenant_id, id) on delete restrict,
  constraint field_travel_times_b foreign key (tenant_id, zone_b) references public.field_zones (tenant_id, id) on delete restrict,
  unique (zone_a, zone_b),
  unique (tenant_id, id)
);
comment on table public.field_travel_times is 'Minutos entre duas zonas, nos dois sentidos. Sem par cadastrado, vale o padrão.';
create trigger field_travel_times_touch before update on public.field_travel_times for each row execute function app.touch_row();

create table public.field_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  booking_id uuid not null,
  zone_id uuid not null,
  -- Só o setor postal (5 dígitos), opcional. Nunca o endereço.
  cep5 text check (cep5 ~ '^[0-9]{5}$'),
  -- Deslocamento calculado na última montagem do roteiro (nulo = precisa recalcular).
  travel_min integer check (travel_min between 0 and 240),
  travel_block_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint field_visits_booking foreign key (tenant_id, booking_id) references public.bookings (tenant_id, id) on delete restrict,
  constraint field_visits_zone foreign key (tenant_id, zone_id) references public.field_zones (tenant_id, id) on delete restrict,
  constraint field_visits_block foreign key (tenant_id, travel_block_id) references public.availability_blocks (tenant_id, id) on delete restrict,
  unique (booking_id),
  unique (tenant_id, id)
);
comment on table public.field_visits is 'Atendimento a domicílio: reserva do P03 + zona (+ CEP de 5 dígitos). O deslocamento é um bloqueio da agenda.';
create trigger field_visits_touch before update on public.field_visits for each row execute function app.touch_row();

-- ---------------------------------------------------------------------------
-- Regras internas
-- ---------------------------------------------------------------------------

create function app.fs_owner(p_tenant_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
end $$;

create function app.fs_settings(p_tenant_id uuid) returns public.field_settings
language sql stable security definer set search_path = '' as $$
  select coalesce((select s from public.field_settings s where s.tenant_id = p_tenant_id),
    row(p_tenant_id, true, 30, 10, 30, null, null, now(), now(), 1)::public.field_settings)
$$;

create function app.fs_settings_json(s public.field_settings) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('enabled', s.enabled, 'default_travel_min', s.default_travel_min, 'same_zone_travel_min', s.same_zone_travel_min,
    'arrival_window_min', s.arrival_window_min, 'max_km', s.max_km, 'version', s.version)
$$;

create function app.fs_zone_json(z public.field_zones, p_max_km numeric) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', z.id, 'name', z.name, 'cep_prefixes', to_jsonb(z.cep_prefixes), 'distance_km', z.distance_km,
    'travel_from_base_min', z.travel_from_base_min, 'active', z.active,
    'in_area', z.active and (p_max_km is null or z.distance_km <= p_max_km), 'version', z.version)
$$;

/** Minutos de uma zona para outra: mesma zona, par cadastrado, ou o padrão. p_from nulo = saindo da base. */
create function app.fs_travel(p_tenant_id uuid, p_from uuid, p_to uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when p_from is null then (select z.travel_from_base_min from public.field_zones z where z.id = p_to)
    when p_from = p_to then (app.fs_settings(p_tenant_id)).same_zone_travel_min
    else coalesce((select t.minutes from public.field_travel_times t where t.zone_a = least(p_from, p_to) and t.zone_b = greatest(p_from, p_to)),
      (app.fs_settings(p_tenant_id)).default_travel_min) end
$$;

/** Agenda (P03) do negócio: a que tem o expediente. */
create function app.fs_agenda(p_tenant_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.resources r where r.tenant_id = p_tenant_id and r.active order by r.created_at, r.id limit 1
$$;

/**
 * Refaz os deslocamentos de um dia local, em ordem de início: tira os bloqueios de deslocamento antigos do dia e cria
 * um por visita ativa, terminando quando começa o atendimento (com o intervalo do serviço). Chamada com o recurso
 * travado. Se um deslocamento não cabe (reserva ou bloqueio no caminho), levanta SLOT_CONFLICT/travel e a transação
 * inteira é desfeita: o roteiro anterior continua.
 */
create function app.fs_rebuild_day(p_tenant_id uuid, p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := (select t.timezone from public.tenants t where t.id = p_tenant_id);
  v_from timestamptz := p_day::timestamp at time zone v_tz;
  v_to timestamptz := (p_day + 1)::timestamp at time zone v_tz;
  v_res uuid := app.fs_agenda(p_tenant_id);
  v_prev_zone uuid := null;
  v_travel integer;
  v_end timestamptz;
  v_range tstzrange;
  v_block public.availability_blocks;
  v_n integer := 0;
  r record;
begin
  -- Remove os deslocamentos do dia (inclusive de visitas que deixaram de valer).
  update public.availability_blocks k set removed_at = clock_timestamp()
  where k.id in (select v.travel_block_id from public.field_visits v join public.bookings b on b.id = v.booking_id
                 where v.tenant_id = p_tenant_id and v.travel_block_id is not null
                   and (b.starts_at >= v_from and b.starts_at < v_to or not b.blocks_capacity))
    and k.removed_at is null;
  update public.field_visits v set travel_block_id = null, travel_min = null
  from public.bookings b where b.id = v.booking_id and v.tenant_id = p_tenant_id
    and (b.starts_at >= v_from and b.starts_at < v_to or not b.blocks_capacity) and (v.travel_block_id is not null or v.travel_min is not null);
  for r in
    select v.id as visit_id, v.zone_id, b.id as booking_id, b.starts_at, lower(b.occupied_range) as occ_start, z.name as zone_name
    from public.field_visits v join public.bookings b on b.id = v.booking_id join public.field_zones z on z.id = v.zone_id
    where v.tenant_id = p_tenant_id and b.blocks_capacity and b.status in ('held', 'confirmed')
      and b.starts_at >= v_from and b.starts_at < v_to
    order by b.starts_at, b.id
  loop
    v_travel := app.fs_travel(p_tenant_id, v_prev_zone, r.zone_id);
    if v_travel > 0 then
      v_end := r.occ_start;
      v_range := tstzrange(v_end - make_interval(mins => v_travel), v_end, '[)');
      if exists (select 1 from public.bookings b where b.tenant_id = p_tenant_id and b.resource_id = v_res and b.blocks_capacity
                   and not (b.status = 'held' and b.hold_expires_at <= clock_timestamp()) and b.occupied_range && v_range)
         or exists (select 1 from public.availability_blocks k where k.tenant_id = p_tenant_id and k.resource_id = v_res and k.removed_at is null
                   and k.period && v_range) then
        raise exception using errcode = 'PT409', message = 'SLOT_CONFLICT', hint = 'travel', detail = 'não dá tempo de chegar';
      end if;
      insert into public.availability_blocks (tenant_id, resource_id, period, label, created_by)
      values (p_tenant_id, v_res, v_range, left('Deslocamento até ' || r.zone_name, 80), auth.uid()) returning * into v_block;
      update public.field_visits v set travel_block_id = v_block.id, travel_min = v_travel where v.id = r.visit_id;
    else
      update public.field_visits v set travel_min = 0 where v.id = r.visit_id;
    end if;
    v_prev_zone := r.zone_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

/** Reagendar ou cancelar no P03 solta o deslocamento daquela visita (o roteiro mostra "recalcular"). */
create function app.fs_on_booking_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (not new.blocks_capacity or old.occupied_range is distinct from new.occupied_range) then
    update public.availability_blocks k set removed_at = clock_timestamp()
    where k.id = (select v.travel_block_id from public.field_visits v where v.booking_id = new.id) and k.removed_at is null;
    update public.field_visits v set travel_block_id = null, travel_min = null where v.booking_id = new.id and v.travel_block_id is not null;
    -- As outras visitas do dia mantêm o bloqueio (a agenda continua protegida), mas o tempo pode ter mudado: o roteiro
    -- passa a pedir recálculo.
    if exists (select 1 from public.field_visits v where v.booking_id = new.id) then
      update public.field_visits v set travel_min = null
      from public.bookings b, public.tenants t
      where b.id = v.booking_id and t.id = new.tenant_id and v.tenant_id = new.tenant_id and v.booking_id <> new.id and v.travel_min is not null
        and (b.starts_at at time zone t.timezone)::date in ((old.starts_at at time zone t.timezone)::date, (new.starts_at at time zone t.timezone)::date);
    end if;
  end if;
  return new;
end $$;
create trigger bookings_field_visit after update of occupied_range, blocks_capacity on public.bookings for each row
  when (old.occupied_range is distinct from new.occupied_range or old.blocks_capacity is distinct from new.blocks_capacity)
  execute function app.fs_on_booking_change();

create function app.fs_stop_json(v public.field_visits, p_window integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('visit_id', v.id, 'booking_id', b.id, 'status', b.status, 'zone_id', v.zone_id, 'zone_name', z.name, 'cep5', v.cep5,
    'customer_name', (select c.name from public.customers c where c.id = b.customer_id),
    'service_name', (select s.name from public.provider_services s where s.id = b.service_id),
    'travel_min', v.travel_min, 'depart_at', app.sched_ts(lower(k.period)),
    'arrival_from', app.sched_ts(b.starts_at - make_interval(mins => p_window)), 'arrival_to', app.sched_ts(b.starts_at),
    'starts_at', app.sched_ts(b.starts_at), 'ends_at', app.sched_ts(b.ends_at), 'version', v.version)
  from public.bookings b join public.field_zones z on z.id = v.zone_id
  left join public.availability_blocks k on k.id = v.travel_block_id and k.removed_at is null
  where b.id = v.booking_id
$$;

-- ---------------------------------------------------------------------------
-- Dono: regras, zonas e tempos
-- ---------------------------------------------------------------------------

create function public.field_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_s public.field_settings := app.fs_settings(p_tenant_id);
begin
  perform app.fs_owner(p_tenant_id);
  return jsonb_build_object('settings', app.fs_settings_json(v_s),
    'zones', coalesce((select jsonb_agg(app.fs_zone_json(z, v_s.max_km) order by z.active desc, z.distance_km, z.name) from public.field_zones z where z.tenant_id = p_tenant_id), '[]'::jsonb),
    'travel_times', coalesce((select jsonb_agg(jsonb_build_object('zone_a', t.zone_a, 'zone_b', t.zone_b, 'minutes', t.minutes) order by t.created_at)
      from public.field_travel_times t where t.tenant_id = p_tenant_id), '[]'::jsonb),
    'timezone', (select t.timezone from public.tenants t where t.id = p_tenant_id));
end $$;

create function public.field_settings_save(
  p_tenant_id uuid,
  p_expected_version integer,
  p_enabled boolean,
  p_default_travel_min integer,
  p_same_zone_travel_min integer,
  p_arrival_window_min integer,
  p_max_km numeric,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_s public.field_settings;
  v_body jsonb;
begin
  perform app.fs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'field.settings_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_s from public.field_settings s where s.tenant_id = p_tenant_id for update;
  if found and (p_expected_version is null or v_s.version <> p_expected_version) then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  begin
    insert into public.field_settings (tenant_id, enabled, default_travel_min, same_zone_travel_min, arrival_window_min, max_km, updated_by)
    values (p_tenant_id, coalesce(p_enabled, true), p_default_travel_min, p_same_zone_travel_min, p_arrival_window_min, p_max_km, v_uid)
    on conflict (tenant_id) do update set enabled = excluded.enabled, default_travel_min = excluded.default_travel_min,
      same_zone_travel_min = excluded.same_zone_travel_min, arrival_window_min = excluded.arrival_window_min, max_km = excluded.max_km, updated_by = v_uid
    returning * into v_s;
  exception when check_violation or not_null_violation then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'settings';
  end;
  perform app.audit(p_tenant_id, 'field.settings_save', 'field_settings', p_tenant_id, p_request_id, null, app.fs_settings_json(v_s));
  v_body := jsonb_build_object('settings', app.fs_settings_json(v_s));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'field.settings_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

create function public.field_zone_save(
  p_tenant_id uuid,
  p_zone_id uuid,
  p_expected_version integer,
  p_name text,
  p_cep_prefixes text[],
  p_distance_km numeric,
  p_travel_from_base_min integer,
  p_active boolean,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_z public.field_zones;
  v_body jsonb;
begin
  perform app.fs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'field.zone_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  -- Um prefixo de CEP pertence a uma zona ativa só (senão "qual zona é este CEP?" fica ambíguo).
  if exists (select 1 from public.field_zones z, unnest(z.cep_prefixes) c where z.tenant_id = p_tenant_id and z.active
               and z.id is distinct from p_zone_id and c = any (coalesce(p_cep_prefixes, '{}'))) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'cep_prefixes', detail = 'CEP já está em outra zona';
  end if;
  begin
    if p_zone_id is null then
      insert into public.field_zones (tenant_id, name, cep_prefixes, distance_km, travel_from_base_min, active, created_by)
      values (p_tenant_id, btrim(p_name), coalesce(p_cep_prefixes, '{}'), p_distance_km, p_travel_from_base_min, coalesce(p_active, true), v_uid)
      returning * into v_z;
    else
      select * into v_z from public.field_zones z where z.tenant_id = p_tenant_id and z.id = p_zone_id for update;
      if not found then
        raise exception using errcode = 'PT404', message = 'NOT_FOUND';
      end if;
      if p_expected_version is null or v_z.version <> p_expected_version then
        raise exception using errcode = 'PT409', message = 'STALE_VERSION';
      end if;
      update public.field_zones z set name = btrim(p_name), cep_prefixes = coalesce(p_cep_prefixes, '{}'), distance_km = p_distance_km,
        travel_from_base_min = p_travel_from_base_min, active = coalesce(p_active, z.active)
      where z.id = v_z.id returning * into v_z;
    end if;
  exception
    when unique_violation then
      raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'name', detail = 'nome repetido';
    when check_violation or not_null_violation then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'zone';
  end;
  perform app.audit(p_tenant_id, 'field.zone_save', 'field_zone', v_z.id, p_request_id, null,
    jsonb_build_object('distance_km', v_z.distance_km, 'travel_from_base_min', v_z.travel_from_base_min, 'active', v_z.active, 'ceps', cardinality(v_z.cep_prefixes)));
  v_body := jsonb_build_object('zone', app.fs_zone_json(v_z, (app.fs_settings(p_tenant_id)).max_km));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'field.zone_save', p_idem_key, case when p_zone_id is null then 201 else 200 end, v_body);
  return jsonb_build_object('status_code', case when p_zone_id is null then 201 else 200 end, 'body', v_body);
end $$;

/** Minutos entre duas zonas (nos dois sentidos). p_minutes nulo tira o par (volta o padrão). */
create function public.field_travel_save(
  p_tenant_id uuid,
  p_zone_a uuid,
  p_zone_b uuid,
  p_minutes integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_a uuid := least(p_zone_a, p_zone_b);
  v_b uuid := greatest(p_zone_a, p_zone_b);
  v_body jsonb;
begin
  perform app.fs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'field.travel_save', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if v_a is null or v_a = v_b then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'zone_b';
  end if;
  if (select count(*) from public.field_zones z where z.tenant_id = p_tenant_id and z.id in (v_a, v_b)) <> 2 then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'zone_id';
  end if;
  if p_minutes is null then
    delete from public.field_travel_times t where t.zone_a = v_a and t.zone_b = v_b;
  elsif p_minutes not between 0 and 240 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'minutes';
  else
    insert into public.field_travel_times (tenant_id, zone_a, zone_b, minutes) values (p_tenant_id, v_a, v_b, p_minutes)
    on conflict (zone_a, zone_b) do update set minutes = excluded.minutes;
  end if;
  perform app.audit(p_tenant_id, 'field.travel_save', 'field_zone', v_a, p_request_id, null, jsonb_build_object('zone_b', v_b, 'minutes', p_minutes));
  v_body := jsonb_build_object('travel_times', coalesce((select jsonb_agg(jsonb_build_object('zone_a', t.zone_a, 'zone_b', t.zone_b, 'minutes', t.minutes) order by t.created_at)
    from public.field_travel_times t where t.tenant_id = p_tenant_id), '[]'::jsonb));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'field.travel_save', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Zona de um CEP (5 primeiros dígitos) e se está dentro da área. Não guarda o CEP consultado. */
create function public.field_zone_for(p_tenant_id uuid, p_cep text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cep5 text := left(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), 5);
  v_s public.field_settings := app.fs_settings(p_tenant_id);
  v_z public.field_zones;
begin
  perform app.fs_owner(p_tenant_id);
  if v_cep5 !~ '^[0-9]{5}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cep';
  end if;
  select * into v_z from public.field_zones z where z.tenant_id = p_tenant_id and z.active and v_cep5 = any (z.cep_prefixes) limit 1;
  return jsonb_build_object('cep5', v_cep5, 'zone', case when v_z.id is null then null else app.fs_zone_json(v_z, v_s.max_km) end,
    'in_area', v_z.id is not null and v_s.enabled and (v_s.max_km is null or v_z.distance_km <= v_s.max_km));
end $$;

-- ---------------------------------------------------------------------------
-- Dono: visitas e roteiro
-- ---------------------------------------------------------------------------

/**
 * Marca uma reserva do P03 como atendimento a domicílio numa zona (ou troca a zona) e refaz o roteiro do dia.
 * Fora da área → POLICY_REJECTED/area. Deslocamento que não cabe → SLOT_CONFLICT/travel e nada muda.
 */
create function public.field_visit_attach(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_zone_id uuid,
  p_cep5 text,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_s public.field_settings := app.fs_settings(p_tenant_id);
  v_b public.bookings;
  v_z public.field_zones;
  v_v public.field_visits;
  v_day date;
  v_body jsonb;
begin
  perform app.fs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'field.visit_attach', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if not v_s.enabled then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'disabled';
  end if;
  -- Mesma ordem de trava da agenda: recurso primeiro.
  perform app.sched_lock_resource(p_tenant_id, app.fs_agenda(p_tenant_id));
  select * into v_b from public.bookings b where b.tenant_id = p_tenant_id and b.id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'booking_id';
  end if;
  if v_b.status not in ('held', 'confirmed') then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'status';
  end if;
  select * into v_z from public.field_zones z where z.tenant_id = p_tenant_id and z.id = p_zone_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', hint = 'zone_id';
  end if;
  if not v_z.active or (v_s.max_km is not null and v_z.distance_km > v_s.max_km) then
    raise exception using errcode = 'PT422', message = 'POLICY_REJECTED', hint = 'area', detail = 'fora da área de atendimento';
  end if;
  if p_cep5 is not null and (p_cep5 !~ '^[0-9]{5}$' or (cardinality(v_z.cep_prefixes) > 0 and not p_cep5 = any (v_z.cep_prefixes))) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'cep', detail = 'CEP não pertence à zona';
  end if;
  insert into public.field_visits (tenant_id, booking_id, zone_id, cep5, created_by) values (p_tenant_id, v_b.id, v_z.id, p_cep5, v_uid)
  on conflict (booking_id) do update set zone_id = excluded.zone_id, cep5 = excluded.cep5
  returning * into v_v;
  v_day := (v_b.starts_at at time zone (select t.timezone from public.tenants t where t.id = p_tenant_id))::date;
  perform app.fs_rebuild_day(p_tenant_id, v_day);
  select * into v_v from public.field_visits v where v.id = v_v.id;
  perform app.audit(p_tenant_id, 'field.visit_attach', 'booking', v_b.id, p_request_id, null,
    jsonb_build_object('zone_id', v_z.id, 'travel_min', v_v.travel_min));
  v_body := jsonb_build_object('stop', app.fs_stop_json(v_v, v_s.arrival_window_min));
  perform app.idempotency_complete(p_tenant_id, v_uid, 'field.visit_attach', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Tira a marca de domicílio da reserva (a reserva continua) e refaz o roteiro do dia. */
create function public.field_visit_detach(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_v public.field_visits;
  v_day date;
  v_body jsonb;
begin
  perform app.fs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'field.visit_detach', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  perform app.sched_lock_resource(p_tenant_id, app.fs_agenda(p_tenant_id));
  select * into v_v from public.field_visits v where v.tenant_id = p_tenant_id and v.booking_id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  update public.availability_blocks k set removed_at = clock_timestamp() where k.id = v_v.travel_block_id and k.removed_at is null;
  delete from public.field_visits v where v.id = v_v.id;
  v_day := ((select b.starts_at from public.bookings b where b.id = p_booking_id) at time zone (select t.timezone from public.tenants t where t.id = p_tenant_id))::date;
  perform app.fs_rebuild_day(p_tenant_id, v_day);
  perform app.audit(p_tenant_id, 'field.visit_detach', 'booking', p_booking_id, p_request_id, null, null);
  v_body := jsonb_build_object('booking_id', p_booking_id, 'detached', true);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'field.visit_detach', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Refaz os deslocamentos do dia (depois de reagendar ou cancelar na agenda). Tudo ou nada. */
create function public.field_route_rebuild(
  p_tenant_id uuid,
  p_day date,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_n integer;
  v_body jsonb;
begin
  perform app.fs_owner(p_tenant_id);
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'field.route_rebuild', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_day is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'day';
  end if;
  perform app.sched_lock_resource(p_tenant_id, app.fs_agenda(p_tenant_id));
  v_n := app.fs_rebuild_day(p_tenant_id, p_day);
  perform app.audit(p_tenant_id, 'field.route_rebuild', 'field_route', null, p_request_id, null, jsonb_build_object('day', p_day, 'stops', v_n));
  v_body := jsonb_build_object('day', to_char(p_day, 'YYYY-MM-DD'), 'stops', v_n);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'field.route_rebuild', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

/** Roteiro do dia em ordem: saída, deslocamento, janela de chegada, atendimento. Avisa se algo precisa recalcular. */
create function public.field_route(p_tenant_id uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := (select t.timezone from public.tenants t where t.id = p_tenant_id);
  v_s public.field_settings := app.fs_settings(p_tenant_id);
begin
  perform app.fs_owner(p_tenant_id);
  if p_day is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'day';
  end if;
  return jsonb_build_object('day', to_char(p_day, 'YYYY-MM-DD'), 'timezone', v_tz, 'arrival_window_min', v_s.arrival_window_min,
    'stops', coalesce((select jsonb_agg(app.fs_stop_json(v, v_s.arrival_window_min) order by b.starts_at, b.id)
      from public.field_visits v join public.bookings b on b.id = v.booking_id
      where v.tenant_id = p_tenant_id and b.status in ('held', 'confirmed', 'completed')
        and b.starts_at >= p_day::timestamp at time zone v_tz and b.starts_at < (p_day + 1)::timestamp at time zone v_tz), '[]'::jsonb),
    'needs_rebuild', exists (select 1 from public.field_visits v join public.bookings b on b.id = v.booking_id
      where v.tenant_id = p_tenant_id and b.status in ('held', 'confirmed') and v.travel_min is null
        and b.starts_at >= p_day::timestamp at time zone v_tz and b.starts_at < (p_day + 1)::timestamp at time zone v_tz),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('booking_id', b.id, 'starts_at', app.sched_ts(b.starts_at),
        'customer_name', (select c.name from public.customers c where c.id = b.customer_id),
        'service_name', (select s.name from public.provider_services s where s.id = b.service_id),
        'is_visit', exists (select 1 from public.field_visits v where v.booking_id = b.id)) order by b.starts_at)
      from public.bookings b where b.tenant_id = p_tenant_id and b.status in ('held', 'confirmed')
        and b.starts_at >= p_day::timestamp at time zone v_tz and b.starts_at < (p_day + 1)::timestamp at time zone v_tz), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Grants e RLS
-- ---------------------------------------------------------------------------

revoke all on function app.fs_ceps_ok(text[]), app.fs_owner(uuid), app.fs_settings(uuid), app.fs_settings_json(public.field_settings), app.fs_zone_json(public.field_zones, numeric),
  app.fs_travel(uuid, uuid, uuid), app.fs_agenda(uuid), app.fs_rebuild_day(uuid, date), app.fs_on_booking_change(),
  app.fs_stop_json(public.field_visits, integer) from public, anon, authenticated;

revoke all on function public.field_settings_get(uuid) from public, anon;
revoke all on function public.field_settings_save(uuid, integer, boolean, integer, integer, integer, numeric, text, text, uuid) from public, anon;
revoke all on function public.field_zone_save(uuid, uuid, integer, text, text[], numeric, integer, boolean, text, text, uuid) from public, anon;
revoke all on function public.field_travel_save(uuid, uuid, uuid, integer, text, text, uuid) from public, anon;
revoke all on function public.field_zone_for(uuid, text) from public, anon;
revoke all on function public.field_visit_attach(uuid, uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.field_visit_detach(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.field_route_rebuild(uuid, date, text, text, uuid) from public, anon;
revoke all on function public.field_route(uuid, date) from public, anon;
grant execute on function public.field_settings_get(uuid) to authenticated;
grant execute on function public.field_settings_save(uuid, integer, boolean, integer, integer, integer, numeric, text, text, uuid) to authenticated;
grant execute on function public.field_zone_save(uuid, uuid, integer, text, text[], numeric, integer, boolean, text, text, uuid) to authenticated;
grant execute on function public.field_travel_save(uuid, uuid, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.field_zone_for(uuid, text) to authenticated;
grant execute on function public.field_visit_attach(uuid, uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.field_visit_detach(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.field_route_rebuild(uuid, date, text, text, uuid) to authenticated;
grant execute on function public.field_route(uuid, date) to authenticated;

alter table public.field_settings enable row level security;
alter table public.field_zones enable row level security;
alter table public.field_travel_times enable row level security;
alter table public.field_visits enable row level security;
revoke all on public.field_settings, public.field_zones, public.field_travel_times, public.field_visits from anon, authenticated;
grant select on public.field_settings, public.field_zones, public.field_travel_times, public.field_visits to authenticated;
grant select, insert, update, delete on public.field_settings, public.field_zones, public.field_travel_times, public.field_visits to service_role;
create policy field_settings_select_owner on public.field_settings for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy field_zones_select_owner on public.field_zones for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy field_travel_times_select_owner on public.field_travel_times for select to authenticated using (app.is_member(tenant_id, array['owner']));
create policy field_visits_select_owner on public.field_visits for select to authenticated using (app.is_member(tenant_id, array['owner']));

-- P32 (parte), bloco 2 · Funil do primeiro dia por negócio.
-- Passos, pela data real de cada dado (sem flag gravada à mão):
--   signup          criou a conta (tenants.created_at)
--   configured      configurou: expediente, serviço com preço e antecedência de cancelamento (app.setup_state, P44)
--   link_published  publicou o link (perfil publicado, P09/P44)
--   first_booking   primeiro agendamento (qualquer origem)
--   first_service   primeiro atendimento concluído (auditoria booking.complete)
--   first_payment   primeiro recebimento (payment_entries, sem estorno)
--   returned        voltou no dia seguinte: algum uso do app ou ação registrada no dia seguinte ao da conta, no fuso do
--                   negócio. Só sim ou não (o dia de uso não guarda hora).
-- Cada passo traz o tempo desde o passo anterior feito e desde a conta, em minutos. Nada de conteúdo.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Dias com uso (sobrevive à retenção de 30 dias dos eventos): só a data, por negócio.
create table public.usage_days (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  primary key (tenant_id, day)
);
comment on table public.usage_days is 'P32: dias (no fuso do negócio) em que o app foi usado. Só a data, sem hora nem quem.';
alter table public.usage_days enable row level security;
revoke all on public.usage_days from public, anon, authenticated;

-- usage_record grava também o dia de uso (o resto da função é a definição do bloco 1, sem mudança).
create or replace function public.usage_record(p_tenant_id uuid, p_batch_id uuid, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_recorded integer := 0;
  v_room integer;
  v_tz text;
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  if p_batch_id is null or p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'events';
  end if;
  if not app.usage_enabled(p_tenant_id) then
    return jsonb_build_object('recorded', 0, 'enabled', false);
  end if;
  insert into public.usage_batches (tenant_id, batch_id, recorded) values (p_tenant_id, p_batch_id, 0)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('recorded', 0, 'enabled', true, 'duplicate', true);
  end if;

  v_room := greatest(2000 - (select count(*)::int from public.usage_events e
    where e.tenant_id = p_tenant_id and e.recorded_at > v_now - interval '1 hour'), 0);

  with raw as (
    select e ->> 'kind' as kind,
      case when e ->> 'kind' = 'screen' then app.ops_clean_route(e ->> 'name') else lower(e ->> 'name') end as name,
      e ->> 'outcome' as outcome, nullif(e ->> 'code', '') as code,
      case when (e ->> 'at') ~ '^\d{4}-\d{2}-\d{2}T' then (e ->> 'at')::timestamptz end as at,
      n
    from jsonb_array_elements(p_events) with ordinality as x(e, n)
    where jsonb_typeof(e) = 'object'
  ), valid as (
    select r.kind, r.name,
      case when r.kind = 'screen' then null else r.outcome end as outcome,
      case when r.kind = 'command' and r.outcome in ('refused', 'error') then r.code end as code,
      least(greatest(coalesce(r.at, v_now), v_now - interval '24 hours'), v_now) as at, r.n
    from raw r
    where (r.kind = 'screen' and r.name ~ '^/app(/[a-z0-9:._-]{1,40})*$' and char_length(r.name) <= 160)
       or (r.kind = 'command' and r.name ~ '^[a-z][a-z0-9-]{0,40}/[a-z][a-z0-9_]{0,40}\.[a-z][a-z0-9_]{0,40}$'
           and r.outcome in ('ok', 'refused', 'error')
           and (r.code is null or r.code ~ '^[A-Z][A-Z0-9_]{1,39}$'))
    order by r.n
    limit v_room
  )
  insert into public.usage_events (tenant_id, kind, name, outcome, code, occurred_at)
  select p_tenant_id, v.kind, v.name, v.outcome, v.code, v.at from valid v;
  get diagnostics v_recorded = row_count;
  update public.usage_batches b set recorded = v_recorded where b.tenant_id = p_tenant_id and b.batch_id = p_batch_id;
  if v_recorded > 0 then
    select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
    insert into public.usage_days (tenant_id, day) values (p_tenant_id, (v_now at time zone v_tz)::date)
    on conflict do nothing;
  end if;
  return jsonb_build_object('recorded', v_recorded, 'enabled', true);
end $$;

-- Desligar a medição apaga também os dias de uso (nada fica guardado depois do "não").
create or replace function public.usage_settings_set(
  p_tenant_id uuid,
  p_enabled boolean,
  p_expected_version integer,
  p_idem_key text,
  p_request_hash text,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_current integer;
  v_body jsonb;
begin
  if not app.is_member(p_tenant_id, array['owner']) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  v_replay := app.idempotency_claim(p_tenant_id, v_uid, 'usage.settings_set', p_idem_key, p_request_hash);
  if v_replay is not null then return v_replay; end if;
  if p_enabled is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'enabled';
  end if;
  select s.version into v_current from public.usage_settings s where s.tenant_id = p_tenant_id for update;
  if coalesce(v_current, 0) <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'PT409', message = 'STALE_VERSION';
  end if;
  insert into public.usage_settings (tenant_id, enabled, updated_by) values (p_tenant_id, p_enabled, v_uid)
  on conflict (tenant_id) do update set enabled = excluded.enabled, version = public.usage_settings.version + 1,
    updated_at = now(), updated_by = excluded.updated_by;
  if not p_enabled then
    delete from public.usage_events e where e.tenant_id = p_tenant_id;
    delete from public.usage_days d where d.tenant_id = p_tenant_id;
  end if;
  perform app.audit(p_tenant_id, 'usage.settings_set', 'usage_settings', null, p_request_id, null,
    jsonb_build_object('enabled', p_enabled));
  v_body := public.usage_settings_get(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'usage.settings_set', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Funil de um negócio
create function app.pilot_funnel_of(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant public.tenants;
  v_signup_day date;
  v_steps jsonb := '[]'::jsonb;
  v_prev timestamptz;
  v_at timestamptz;
  v_returned boolean;
  r record;
begin
  select * into v_tenant from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;
  v_signup_day := (v_tenant.created_at at time zone v_tenant.timezone)::date;
  v_prev := v_tenant.created_at;

  for r in
    select x.key, x.at from (values
      (1, 'signup', v_tenant.created_at),
      (2, 'configured', (select case when bool_and(s.done) then max(s.done_at) end from app.setup_state(p_tenant_id) s
                         where s.step in ('hours', 'service', 'cancellation_policy'))),
      (3, 'link_published', (select s.done_at from app.setup_state(p_tenant_id) s where s.step = 'profile' and s.done)),
      (4, 'first_booking', (select min(b.created_at) from public.bookings b where b.tenant_id = p_tenant_id)),
      (5, 'first_service', (select min(a.occurred_at) from public.audit_events a
                            where a.tenant_id = p_tenant_id and a.action = 'booking.complete')),
      (6, 'first_payment', (select min(e.created_at) from public.payment_entries e
                            where e.tenant_id = p_tenant_id and e.reversal_of is null))
    ) as x(ord, key, at) order by x.ord
  loop
    v_at := r.at;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'key', r.key,
      'done', v_at is not null,
      'at', app.sched_ts(v_at),
      'minutes_since_signup', case when v_at is not null then greatest(0, floor(extract(epoch from v_at - v_tenant.created_at) / 60))::bigint end,
      'minutes_since_previous', case when v_at is not null and r.key <> 'signup'
        then greatest(0, floor(extract(epoch from v_at - v_prev) / 60))::bigint end));
    if v_at is not null then v_prev := greatest(v_prev, v_at); end if;
  end loop;

  v_returned := exists (select 1 from public.usage_days d where d.tenant_id = p_tenant_id and d.day = v_signup_day + 1)
    or exists (select 1 from public.audit_events a where a.tenant_id = p_tenant_id
      and (a.occurred_at at time zone v_tenant.timezone)::date = v_signup_day + 1);
  v_steps := v_steps || jsonb_build_array(jsonb_build_object('key', 'returned', 'done', v_returned, 'at', null,
    'minutes_since_signup', null, 'minutes_since_previous', null));

  return jsonb_build_object('tenant_id', p_tenant_id, 'signup_at', app.sched_ts(v_tenant.created_at),
    'timezone', v_tenant.timezone, 'steps', v_steps,
    'done', (select count(*) from jsonb_array_elements(v_steps) s where (s ->> 'done')::boolean),
    'total', jsonb_array_length(v_steps));
end $$;
revoke all on function app.pilot_funnel_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Leitura da equipe Tinindo: o funil de todos os negócios (até 200, os mais novos primeiro; truncated avisa o corte).
create function public.pilot_funnel() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.svc_operator();
  return jsonb_build_object(
    'businesses', coalesce((select jsonb_agg(app.pilot_funnel_of(t.id) || jsonb_build_object('name', t.name, 'profession', t.profession)
        order by t.created_at desc)
      from (select * from public.tenants t order by t.created_at desc limit 200) t), '[]'::jsonb),
    'truncated', jsonb_build_object('businesses', exists (select 1 from public.tenants t offset 200)));
end $$;
revoke all on function public.pilot_funnel() from public, anon;
grant execute on function public.pilot_funnel() to authenticated;

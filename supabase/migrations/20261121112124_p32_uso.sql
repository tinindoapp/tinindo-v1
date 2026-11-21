-- P32 (parte), bloco 1 · Uso do produto sem dado pessoal.
-- O app grava, em lote, dois tipos de evento por negócio:
--   screen  · tela aberta: a rota sem id (mesma limpeza do P58, app.ops_clean_route), só dentro de /app;
--   command · comando concluído (ok), recusado (4xx, com o código do catálogo) ou com erro (5xx ou sem rede).
-- Nunca valor, nome, telefone, texto digitado, usuário, IP ou corpo. O banco só aceita vocabulário fechado (check).
-- Retenção curta (30 dias) registrada na tabela de prazos do P57; o negócio pode desligar a medição.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tabelas
create table public.usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('screen', 'command')),
  -- screen: rota sem id que começa em /app; command: "<função>/<operação>".
  name text not null check (
    (kind = 'screen' and name ~ '^/app(/[a-z0-9:._-]{1,40})*$' and char_length(name) <= 160)
    or (kind = 'command' and name ~ '^[a-z][a-z0-9-]{0,40}/[a-z][a-z0-9_]{0,40}\.[a-z][a-z0-9_]{0,40}$')
  ),
  outcome text check (outcome in ('ok', 'refused', 'error')),
  code text check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint usage_events_outcome check ((kind = 'screen') = (outcome is null)),
  constraint usage_events_code check (code is null or outcome in ('refused', 'error'))
);
comment on table public.usage_events is
  'P32: uso do app por negócio, sem dado pessoal (rota sem id, operação, resultado, código). Retenção usage_events.';
create index usage_events_tenant_time on public.usage_events (tenant_id, occurred_at);
create index usage_events_time on public.usage_events (occurred_at);

-- Lote já gravado: repetir o mesmo lote (nova tentativa, duas abas) não duplica.
create table public.usage_batches (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  batch_id uuid not null,
  recorded integer not null check (recorded >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, batch_id)
);
comment on table public.usage_batches is 'P32: lotes de uso já recebidos (dedupe). Retenção usage_batches.';
create index usage_batches_time on public.usage_batches (created_at);

-- Medição desligável por negócio. Sem linha = ligada (padrão do piloto, anotado no handoff).
create table public.usage_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.usage_settings is 'P32: o negócio liga ou desliga a medição de uso do app.';

alter table public.usage_events enable row level security;
alter table public.usage_batches enable row level security;
alter table public.usage_settings enable row level security;
-- Ninguém lê nem escreve direto: só as funções abaixo (o painel do piloto lê pela função da equipe).
revoke all on public.usage_events, public.usage_batches, public.usage_settings from public, anon, authenticated;

insert into public.retention_policies (category, days, starts_at, decision, note) values
  ('usage_events', 30, 'evento de uso', 'P32', 'Uso do app (rota sem id, operação, resultado e código): sem dado pessoal, para o painel do piloto.'),
  ('usage_batches', 2, 'recebimento do lote', 'P32', 'Identificador do lote de uso, só para não gravar duas vezes.');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Configuração
create function app.usage_enabled(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from public.usage_settings s where s.tenant_id = p_tenant_id), true)
$$;
revoke all on function app.usage_enabled(uuid) from public, anon, authenticated;

create function public.usage_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;
  return jsonb_build_object('enabled', app.usage_enabled(p_tenant_id),
    'version', coalesce((select s.version from public.usage_settings s where s.tenant_id = p_tenant_id), 0),
    'retention_days', (select r.days from public.retention_policies r where r.category = 'usage_events'));
end $$;

create function public.usage_settings_set(
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
  -- Desligar apaga o que já foi medido do negócio (nada fica guardado depois do "não").
  if not p_enabled then
    delete from public.usage_events e where e.tenant_id = p_tenant_id;
  end if;
  perform app.audit(p_tenant_id, 'usage.settings_set', 'usage_settings', null, p_request_id, null,
    jsonb_build_object('enabled', p_enabled));
  v_body := public.usage_settings_get(p_tenant_id);
  perform app.idempotency_complete(p_tenant_id, v_uid, 'usage.settings_set', p_idem_key, 200, v_body);
  return jsonb_build_object('status_code', 200, 'body', v_body);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Gravação em lote
-- Até 50 eventos por lote e 2.000 por negócio por hora. Evento fora do formato é descartado (não derruba o lote).
-- O horário vem do app, preso entre 24 h atrás e agora.
create function public.usage_record(p_tenant_id uuid, p_batch_id uuid, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_recorded integer := 0;
  v_room integer;
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
  -- Primeiro grava o lote: o segundo envio do mesmo lote (corrida ou nova tentativa) para aqui.
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
  return jsonb_build_object('recorded', v_recorded, 'enabled', true);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Retenção (linha nova em job_ticks; não reescreve jobs_run)
create function app.usage_tick(p_batch integer default 1000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_events integer;
  v_batches integer;
  v_limit integer := greatest(coalesce(p_batch, 1000), 1);
begin
  delete from public.usage_events e where e.id in (
    select x.id from public.usage_events x where x.occurred_at < v_now - app.retention_days('usage_events')
    order by x.occurred_at limit v_limit);
  get diagnostics v_events = row_count;
  delete from public.usage_batches b where (b.tenant_id, b.batch_id) in (
    select x.tenant_id, x.batch_id from public.usage_batches x where x.created_at < v_now - app.retention_days('usage_batches')
    order by x.created_at limit v_limit);
  get diagnostics v_batches = row_count;
  if v_events > 0 then
    insert into public.retention_runs (category, affected) values ('usage_events', v_events);
  end if;
  if v_batches > 0 then
    insert into public.retention_runs (category, affected) values ('usage_batches', v_batches);
  end if;
  return jsonb_build_object('usage_events', v_events, 'usage_batches', v_batches);
end $$;
revoke all on function app.usage_tick(integer) from public, anon, authenticated;

insert into public.job_ticks (name, fn, takes_batch, batch, phase, position) values
  ('usage_retention', 'app.usage_tick', true, 1000, 'after_outbox', 95);

revoke all on function public.usage_settings_get(uuid) from public, anon;
revoke all on function public.usage_settings_set(uuid, boolean, integer, text, text, uuid) from public, anon;
revoke all on function public.usage_record(uuid, uuid, jsonb) from public, anon;
grant execute on function public.usage_settings_get(uuid) to authenticated;
grant execute on function public.usage_settings_set(uuid, boolean, integer, text, text, uuid) to authenticated;
grant execute on function public.usage_record(uuid, uuid, jsonb) to authenticated;

-- P58 parte 2 · Operação: saber quando algo quebra (captura de erro, saúde e alerta) e o registro do que foi publicado.
-- 1. public.ops_errors: erro de tela/chamada do frontend e 5xx das funções. Só vocabulário fechado (rota sem id, código
--    do catálogo, SHA, request_id): nenhum texto livre, nenhum dado pessoal. Retenção curta (14 dias, retention_policies).
--    Grava por public.ops_error_record (anon e authenticated), com teto por janela para não virar alvo de abuso.
-- 2. public.ops_releases: cada publicação ou reversão (release/publicar.sh e release/reverter.sh) anota o SHA aqui.
-- 3. app.ops_health_snapshot(): leitura única da saúde (fila, rotinas, erros da última hora, versão, alerta).
--    public.ops_health() entrega a leitura à equipe Tinindo (operador ativo); o smoke lê a de app direto.
-- 4. app.ops_watch_tick: linha nova em job_ticks (não reescreve jobs_run). Apaga erros vencidos, calcula os motivos de
--    "precisa de atenção" e devolve notify = true só na passagem de ok para atenção (o e-mail, desligado por padrão,
--    fica na função jobs).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Erros capturados
create table public.ops_errors (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  -- front: o navegador; function: a Edge Function (resposta 5xx ou exceção).
  source text not null check (source in ('front', 'function')),
  -- render: erro de tela; call: chamada que voltou 5xx ou não chegou; unhandled: erro solto na página;
  -- http_5xx: a função respondeu 5xx; exception: a função lançou exceção sem responder.
  kind text not null check (kind in ('render', 'call', 'unhandled', 'http_5xx', 'exception')),
  fn text check (fn ~ '^[a-z][a-z0-9-]{0,40}$'),
  route text check (route ~ '^[a-z0-9/:._-]{0,160}$'),
  status integer check (status between 0 and 599),
  code text check (code ~ '^[A-Za-z][A-Za-z0-9_]{0,59}$'),
  build_sha text check (build_sha ~ '^[0-9a-f]{7,40}$'),
  request_id uuid,
  check (source = 'front' or kind in ('http_5xx', 'exception')),
  check (source = 'function' or kind in ('render', 'call', 'unhandled'))
);
comment on table public.ops_errors is
  'P58: erros de tela, de chamada e 5xx das funções. Só rota sem id, código, SHA e request_id; sem dado pessoal. Retenção: ops_errors em retention_policies.';
-- A mesma requisição registrada duas vezes pela mesma origem (nova tentativa do envio) vira uma linha.
create unique index ops_errors_request on public.ops_errors (source, request_id) where request_id is not null;
create index ops_errors_recent on public.ops_errors (source, occurred_at);
alter table public.ops_errors enable row level security;
revoke all on public.ops_errors from public, anon, authenticated;

insert into public.retention_policies (category, days, starts_at, decision, note) values
  ('ops_errors', 14, 'registro do erro', 'P58', 'Erros capturados (rota sem id, código, SHA, request_id): só para a operação ver o que quebrou.');

/** Rota sem dado: minúsculas, sem query, e todo trecho com id, número longo, @ ou comprido demais vira ":id". */
create function app.ops_clean_route(p_route text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(coalesce(string_agg(
    case
      when s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or s ~ '[0-9]{3,}' or s like '%@%'
        or char_length(s) > 40 then ':id'
      else regexp_replace(s, '[^a-z0-9:._-]', '', 'g')
    end, '/' order by n), ''), 160), '')
  from unnest(string_to_array(split_part(split_part(lower(left(coalesce(p_route, ''), 400)), '?', 1), '#', 1), '/'))
    with ordinality as t(s, n)
$$;
revoke all on function app.ops_clean_route(text) from public, anon, authenticated;

/**
 * Grava um erro. Aberta a anon e authenticated (o erro de tela pode vir antes do login); só aceita o vocabulário da
 * tabela. Valor fora do formato vira null em vez de recusar: a captura nunca derruba quem chama. Teto: 500 linhas por
 * origem a cada 10 minutos; acima disso não grava (devolve false).
 */
create function public.ops_error_record(
  p_source text, p_kind text, p_fn text default null, p_route text default null, p_status integer default null,
  p_code text default null, p_build_sha text default null, p_request_id uuid default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_fn text := case when p_fn ~ '^[a-z][a-z0-9-]{0,40}$' then p_fn end;
  v_code text := case when p_code ~ '^[A-Za-z][A-Za-z0-9_]{0,59}$' then p_code end;
  v_sha text := case when lower(p_build_sha) ~ '^[0-9a-f]{7,40}$' then lower(p_build_sha) end;
  v_status integer := case when p_status between 0 and 599 then p_status end;
  v_route text := app.ops_clean_route(p_route);
begin
  if p_source not in ('front', 'function')
     or not ((p_source = 'front' and p_kind in ('render', 'call', 'unhandled'))
          or (p_source = 'function' and p_kind in ('http_5xx', 'exception'))) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR', hint = 'kind';
  end if;
  if (select count(*) from public.ops_errors e
      where e.source = p_source and e.occurred_at > clock_timestamp() - interval '10 minutes') >= 500 then
    return false;
  end if;
  insert into public.ops_errors (source, kind, fn, route, status, code, build_sha, request_id)
  values (p_source, p_kind, v_fn, v_route, v_status, v_code, v_sha, p_request_id)
  on conflict (source, request_id) where request_id is not null do nothing;
  return true;
end $$;
revoke all on function public.ops_error_record(text, text, text, text, integer, text, text, uuid) from public;
grant execute on function public.ops_error_record(text, text, text, text, integer, text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. O que está publicado
create table public.ops_releases (
  id bigint generated always as identity primary key,
  published_at timestamptz not null default clock_timestamp(),
  environment text not null check (environment ~ '^[a-z][a-z0-9_-]{0,30}$'),
  kind text not null check (kind in ('publish', 'revert')),
  sha text not null check (sha ~ '^[0-9a-f]{40}$'),
  -- Última migration do repositório no SHA publicado (o banco é só aditivo: numa reversão, fica a mais nova aplicada).
  migrations_until text check (migrations_until ~ '^[0-9]{14}_[a-z0-9_]+$'),
  functions integer check (functions between 0 and 200)
);
comment on table public.ops_releases is 'P58: cada publicação e reversão (release/publicar.sh, release/reverter.sh). Só service_role grava.';
create index ops_releases_recent on public.ops_releases (published_at desc);
alter table public.ops_releases enable row level security;
revoke all on public.ops_releases from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Limites do alerta e estado
create table public.ops_alert_settings (
  id boolean primary key default true check (id),
  -- Fila atrasada: o evento vencido mais antigo esperando há mais que isto.
  queue_late_minutes integer not null default 15 check (queue_late_minutes between 1 and 1440),
  -- Rotina do job_ticks com tantas falhas seguidas.
  tick_failures integer not null default 3 check (tick_failures between 1 and 100),
  -- Teto de 5xx das funções na última hora (todas juntas).
  function_errors_per_hour integer not null default 20 check (function_errors_per_hour between 1 and 100000)
);
comment on table public.ops_alert_settings is 'P58: limites do "precisa de atenção". Uma linha; mudar = migration nova.';
insert into public.ops_alert_settings default values;
alter table public.ops_alert_settings enable row level security;
revoke all on public.ops_alert_settings from public, anon, authenticated;

create table public.ops_alert_state (
  id boolean primary key default true check (id),
  state text not null default 'ok' check (state in ('ok', 'attention')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  since timestamptz,
  checked_at timestamptz,
  notified_at timestamptz
);
comment on table public.ops_alert_state is 'P58: último estado calculado pela rotina ops_watch (job_ticks).';
insert into public.ops_alert_state default values;
alter table public.ops_alert_state enable row level security;
revoke all on public.ops_alert_state from public, anon, authenticated;

/** Motivos de "precisa de atenção" agora. Lista vazia = tudo certo. */
create function app.ops_alert_reasons() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.ops_alert_settings;
  v_now timestamptz := clock_timestamp();
  v_out jsonb := '[]'::jsonb;
  v_oldest timestamptz;
  v_ticks jsonb;
  v_errors integer;
begin
  select * into s from public.ops_alert_settings;
  select min(o.next_run_at) into v_oldest from public.outbox_events o
  where (o.status = 'pending' and o.next_run_at <= v_now) or (o.status = 'processing' and o.leased_until < v_now);
  if v_oldest is not null and v_oldest < v_now - make_interval(mins => s.queue_late_minutes) then
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'queue_late',
      'minutes', floor(extract(epoch from v_now - v_oldest) / 60)::int, 'limit', s.queue_late_minutes));
  end if;
  select jsonb_agg(j.name order by j.name) into v_ticks from public.job_ticks j
  where j.enabled and j.consecutive_failures >= s.tick_failures;
  if v_ticks is not null then
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'tick_failing', 'ticks', v_ticks, 'limit', s.tick_failures));
  end if;
  select count(*) into v_errors from public.ops_errors e
  where e.source = 'function' and e.occurred_at > v_now - interval '1 hour';
  if v_errors > s.function_errors_per_hour then
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'errors_over_ceiling', 'count', v_errors,
      'limit', s.function_errors_per_hour));
  end if;
  return v_out;
end $$;
revoke all on function app.ops_alert_reasons() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Leitura única da saúde
create function app.ops_health_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reasons jsonb := app.ops_alert_reasons();
  st public.ops_alert_state;
  v_oldest_due timestamptz;
  v_stale boolean;
begin
  select * into st from public.ops_alert_state;
  -- A rotina do alerta roda a cada minuto pelo cron; parada há 5 minutos é sinal de que o worker parou.
  v_stale := st.checked_at is not null and st.checked_at < v_now - interval '5 minutes';
  if v_stale then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code', 'watch_stale',
      'minutes', floor(extract(epoch from v_now - st.checked_at) / 60)::int));
  end if;
  select min(o.next_run_at) into v_oldest_due from public.outbox_events o
  where (o.status = 'pending' and o.next_run_at <= v_now) or (o.status = 'processing' and o.leased_until < v_now);
  return jsonb_build_object(
    'as_of', v_now,
    'attention', jsonb_array_length(v_reasons) > 0,
    'reasons', v_reasons,
    'outbox', (select jsonb_build_object(
        'pending', count(*) filter (where o.status = 'pending'),
        'processing', count(*) filter (where o.status = 'processing'),
        'due', count(*) filter (where (o.status = 'pending' and o.next_run_at <= v_now)
                                   or (o.status = 'processing' and o.leased_until < v_now)),
        'oldest_due_at', v_oldest_due,
        'late_minutes', case when v_oldest_due is null then 0 else floor(extract(epoch from v_now - v_oldest_due) / 60)::int end,
        'oldest_pending_at', min(o.occurred_at) filter (where o.status in ('pending', 'processing')),
        'dead', count(*) filter (where o.status = 'dead'),
        'dead_24h', count(*) filter (where o.status = 'dead' and o.occurred_at > v_now - interval '24 hours'))
      from public.outbox_events o where o.status <> 'done'),
    'dead_by_type', coalesce((select jsonb_agg(jsonb_build_object('event_type', d.event_type, 'count', d.n) order by d.n desc, d.event_type)
      from (select o.event_type, count(*)::int as n from public.outbox_events o where o.status = 'dead'
            group by o.event_type order by 2 desc, 1 limit 10) d), '[]'::jsonb),
    'ticks', coalesce((select jsonb_agg(jsonb_build_object('name', j.name, 'enabled', j.enabled,
        'consecutive_failures', j.consecutive_failures, 'last_error', left(j.last_error, 200),
        'last_failed_at', j.last_failed_at) order by j.phase desc, j.position) from public.job_ticks j), '[]'::jsonb),
    'errors', jsonb_build_object(
      'window_minutes', 60,
      'functions', coalesce((select jsonb_agg(jsonb_build_object('fn', f.fn, 'count', f.n) order by f.n desc, f.fn)
        from (select coalesce(e.fn, '?') as fn, count(*)::int as n from public.ops_errors e
              where e.source = 'function' and e.occurred_at > v_now - interval '1 hour' group by 1) f), '[]'::jsonb),
      'function_total', (select count(*) from public.ops_errors e where e.source = 'function' and e.occurred_at > v_now - interval '1 hour'),
      'front', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'count', f.n) order by f.kind)
        from (select e.kind, count(*)::int as n from public.ops_errors e
              where e.source = 'front' and e.occurred_at > v_now - interval '1 hour' group by 1) f), '[]'::jsonb),
      'front_total', (select count(*) from public.ops_errors e where e.source = 'front' and e.occurred_at > v_now - interval '1 hour')),
    'release', (select jsonb_build_object('environment', r.environment, 'kind', r.kind, 'sha', r.sha,
        'migrations_until', r.migrations_until, 'functions', r.functions, 'published_at', r.published_at)
      from public.ops_releases r order by r.published_at desc, r.id desc limit 1),
    'watch', jsonb_build_object('state', st.state, 'since', st.since, 'checked_at', st.checked_at,
      'notified_at', st.notified_at, 'stale', v_stale),
    'limits', (select jsonb_build_object('queue_late_minutes', s.queue_late_minutes, 'tick_failures', s.tick_failures,
        'function_errors_per_hour', s.function_errors_per_hour) from public.ops_alert_settings s));
end $$;
revoke all on function app.ops_health_snapshot() from public, anon, authenticated;

/** Saúde da operação para a equipe Tinindo (painel em service-ops). Quem não é operador ativo recebe FORBIDDEN. */
create function public.ops_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.svc_operator();
  return app.ops_health_snapshot();
end $$;
revoke all on function public.ops_health() from public, anon;
grant execute on function public.ops_health() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Rotina do alerta (linha nova em job_ticks)
create function app.ops_watch_tick(p_batch integer default 500) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_purged integer;
  v_reasons jsonb;
  v_state text;
  v_notify boolean := false;
begin
  -- Retenção curta dos erros (D25 e P58): lote limitado por rodada, com a contagem no relatório da retenção.
  delete from public.ops_errors e where e.id in (
    select x.id from public.ops_errors x where x.occurred_at < v_now - app.retention_days('ops_errors')
    order by x.occurred_at limit greatest(coalesce(p_batch, 500), 1));
  get diagnostics v_purged = row_count;
  if v_purged > 0 then
    insert into public.retention_runs (category, affected) values ('ops_errors', v_purged);
  end if;

  v_reasons := app.ops_alert_reasons();
  v_state := case when jsonb_array_length(v_reasons) > 0 then 'attention' else 'ok' end;
  -- Passagem de ok para atenção: só um worker ganha a troca (where state <> 'attention'), então o aviso sai uma vez.
  if v_state = 'attention' then
    update public.ops_alert_state a set state = 'attention', reasons = v_reasons, since = v_now, checked_at = v_now,
      notified_at = v_now
    where a.id and a.state <> 'attention';
    v_notify := found;
  end if;
  update public.ops_alert_state a set state = v_state, reasons = v_reasons, checked_at = v_now,
    since = case when v_state = 'ok' then null else a.since end
  where a.id and not (v_notify);
  return jsonb_build_object('state', v_state,
    'reasons', coalesce((select jsonb_agg(r -> 'code') from jsonb_array_elements(v_reasons) r), '[]'::jsonb),
    'notify', v_notify, 'purged', v_purged);
end $$;
revoke all on function app.ops_watch_tick(integer) from public, anon, authenticated;

insert into public.job_ticks (name, fn, takes_batch, batch, phase, position) values
  ('ops_watch', 'app.ops_watch_tick', true, 500, 'after_outbox', 90);

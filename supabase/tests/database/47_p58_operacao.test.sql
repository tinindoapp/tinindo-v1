-- P58 parte 2 · Operação: captura de erro (vocabulário fechado, rota sem id, teto, dedupe), leitura de saúde só para a
-- equipe Tinindo, rotina ops_watch no job_ticks (motivos, aviso uma vez, volta a ok, retenção curta) e registro de release.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as op1,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a;
grant select on ids to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return v_state || '/' || v_msg;
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;
create function pg_temp.reasons() returns text[] language sql as $$
  select coalesce(array_agg(r ->> 'code' order by r ->> 'code'), '{}') from jsonb_array_elements(app.ops_alert_reasons()) r
$$;

insert into public.platform_operators (user_id, display_name) values ((select op1 from ids), 'Operadora (exemplo)')
on conflict do nothing;
-- Parte de um estado limpo: o seed não deixa fila vencida nem rotina falhando.
update public.outbox_events set status = 'done' where status in ('pending', 'processing');
update public.job_ticks set consecutive_failures = 0;

-- ------------------------------------------------------------------ estrutura e acesso
select has_table('public', 'ops_errors', 'tabela de erros existe');
select is((select relrowsecurity from pg_class where oid = 'public.ops_errors'::regclass), true, 'RLS ligada nos erros');
select ok(not has_table_privilege('anon', 'public.ops_errors', 'select') and not has_table_privilege('authenticated', 'public.ops_errors', 'select')
  and not has_table_privilege('authenticated', 'public.ops_errors', 'insert'), 'ninguém lê nem grava a tabela direto');
select ok(not has_table_privilege('authenticated', 'public.ops_releases', 'select') and not has_table_privilege('authenticated', 'public.ops_alert_state', 'select')
  and not has_table_privilege('authenticated', 'public.ops_alert_settings', 'update'), 'releases, estado e limites fechados');
select ok(has_function_privilege('anon', 'public.ops_error_record(text, text, text, text, integer, text, text, uuid)', 'execute'), 'anon registra erro (tela antes do login)');
select ok(not has_function_privilege('anon', 'public.ops_health()', 'execute'), 'anon não lê a saúde');
select ok(not has_function_privilege('authenticated', 'app.ops_health_snapshot()', 'execute')
  and not has_function_privilege('authenticated', 'app.ops_watch_tick(integer)', 'execute')
  and not has_function_privilege('authenticated', 'app.ops_alert_reasons()', 'execute'), 'funções de app fechadas');
select is((select days from public.retention_policies where category = 'ops_errors'), 14, 'retenção curta: 14 dias');
select is((select fn from public.job_ticks where name = 'ops_watch' and enabled and phase = 'after_outbox'), 'app.ops_watch_tick', 'ops_watch é linha do job_ticks');

-- ------------------------------------------------------------------ rota sem dado
select is(app.ops_clean_route('/app/clientes/7f1c2a9e-1b2c-4d3e-8f00-0123456789ab?aba=historico#x'), '/app/clientes/:id', 'uuid e query saem');
select is(app.ops_clean_route('/Pagar/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef'), '/pagar/:id', 'token comprido vira :id');
select is(app.ops_clean_route('/app/x/11987654321'), '/app/x/:id', 'telefone (número longo) vira :id');
select is(app.ops_clean_route('/app/fulana@exemplo.com'), '/app/:id', 'e-mail vira :id');
select is(app.ops_clean_route('/p/barbearia <script>'), '/p/barbeariascript', 'caractere fora do conjunto sai');
select is(app.ops_clean_route('finance.ledger'), 'finance.ledger', 'rota da função fica');

-- ------------------------------------------------------------------ gravar
set local role anon;
select ok(public.ops_error_record('front', 'render', null, '/app/clientes/7f1c2a9e-1b2c-4d3e-8f00-0123456789ab', null, 'TypeError', 'ABCDEF1234567', null), 'anon grava erro de tela');
select ok(public.ops_error_record('front', 'call', 'finance', '/app/caixa', 503, 'PROVIDER_UNAVAILABLE', null, '11111111-1111-4111-8111-111111111111'), 'erro de chamada com request_id');
select ok(public.ops_error_record('front', 'call', 'finance', '/app/caixa', 503, 'PROVIDER_UNAVAILABLE', null, '11111111-1111-4111-8111-111111111111'), 'mesma requisição de novo: aceita sem duplicar');
select ok(public.ops_error_record('function', 'http_5xx', 'finance', 'finance.ledger', 500, 'INTERNAL_ERROR', 'abcdef1', '11111111-1111-4111-8111-111111111111'), 'a função grava o mesmo request_id na origem dela');
select ok(public.ops_error_record('front', 'unhandled', 'NÃO VALE', 'x', 9999, 'código com espaço', 'zz', null), 'valor fora do formato não derruba');
select is(pg_temp.err($$ select public.ops_error_record('front', 'http_5xx') $$), 'PT400/VALIDATION_ERROR', 'tipo de outra origem recusado');
select is(pg_temp.err($$ select public.ops_error_record('servidor', 'render') $$), 'PT400/VALIDATION_ERROR', 'origem desconhecida recusada');
reset role;
select is((select count(*)::int from public.ops_errors), 4, 'quatro linhas: a repetida não duplicou');
select is((select route || '|' || code || '|' || build_sha from public.ops_errors where kind = 'render'), '/app/clientes/:id|TypeError|abcdef1234567', 'gravado sem id, SHA em minúsculas');
select ok((select fn is null and status is null and code is null and build_sha is null and route = 'x' from public.ops_errors where kind = 'unhandled'), 'fora do formato vira nulo');

-- Teto: 500 por origem a cada 10 minutos.
insert into public.ops_errors (source, kind) select 'front', 'unhandled' from generate_series(1, 497);
set local role anon;
select ok(not public.ops_error_record('front', 'render'), 'acima do teto não grava');
reset role;
select is((select count(*)::int from public.ops_errors where source = 'front'), 500, 'teto respeitado');
delete from public.ops_errors where source = 'front' and kind = 'unhandled';

-- ------------------------------------------------------------------ saúde: só a equipe
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err($$ select public.ops_health() $$), 'PT403/FORBIDDEN', 'dono de negócio não lê a saúde');
reset role;
select pg_temp.login_as((select op1 from ids));
set local role authenticated;
select ok((select (public.ops_health() ->> 'attention')::boolean = false), 'operador lê; tudo certo agora');
reset role;
select ok((select h ? 'outbox' and h ? 'ticks' and h ? 'errors' and h ? 'release' and h ? 'watch' and h ? 'limits' and h ? 'dead_by_type'
  from (select app.ops_health_snapshot() h) x), 'leitura traz fila, rotinas, erros, versão, alerta e limites');
select is((select (app.ops_health_snapshot() -> 'errors' -> 'functions' -> 0) from (select 1) x), '{"fn": "finance", "count": 1}'::jsonb, 'erros por função na última hora');

-- ------------------------------------------------------------------ motivos
insert into public.outbox_events (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, next_run_at, occurred_at)
values ((select tenant_a from ids), 'ops.teste.v1', gen_random_uuid(), 1, gen_random_uuid(), now() - interval '20 minutes', now() - interval '20 minutes');
select is(pg_temp.reasons(), array['queue_late'], 'evento vencido há 20 min: fila atrasada');
update public.job_ticks set consecutive_failures = 3, last_error = 'falha simulada' where name = 'referrals';
insert into public.ops_errors (source, kind, fn) select 'function', 'http_5xx', 'scheduling' from generate_series(1, 20);
select is(pg_temp.reasons(), array['errors_over_ceiling', 'queue_late', 'tick_failing'], 'rotina com 3 falhas e 21 erros (teto 20)');
select is((select r -> 'ticks' from jsonb_array_elements(app.ops_alert_reasons()) r where r ->> 'code' = 'tick_failing'), '["referrals"]'::jsonb, 'diz qual rotina');
update public.job_ticks set enabled = false where name = 'referrals';
select ok(not ('tick_failing' = any(pg_temp.reasons())), 'rotina desligada não conta');
update public.job_ticks set enabled = true where name = 'referrals';

-- ------------------------------------------------------------------ rotina ops_watch
select is((select app.ops_watch_tick(500) -> 'notify'), 'true'::jsonb, 'passou para atenção: avisa');
select is((select app.ops_watch_tick(500) -> 'notify'), 'false'::jsonb, 'continua em atenção: não avisa de novo');
select is((select state from public.ops_alert_state), 'attention', 'estado gravado');
update public.outbox_events set status = 'done' where event_type = 'ops.teste.v1';
update public.job_ticks set consecutive_failures = 0 where name = 'referrals';
delete from public.ops_errors where source = 'function' and fn = 'scheduling';
select is((select app.ops_watch_tick(500) ->> 'state'), 'ok', 'resolvido: volta a ok');
select ok((select since is null and checked_at is not null from public.ops_alert_state), 'ok sem "desde"');
update public.ops_alert_state set checked_at = now() - interval '6 minutes';
select ok((select app.ops_health_snapshot() -> 'reasons' @> '[{"code": "watch_stale"}]'), 'rotina do alerta parada há 6 min aparece');
update public.ops_alert_state set checked_at = now();

-- Retenção: erro de 15 dias sai, o de hoje fica, e a contagem vai para retention_runs.
insert into public.ops_errors (occurred_at, source, kind) values (now() - interval '15 days', 'front', 'render');
select is((select (app.ops_watch_tick(500) ->> 'purged')::int), 1, 'apagou o erro vencido');
select ok((select count(*) = 1 from public.retention_runs where category = 'ops_errors'), 'contagem no relatório da retenção');

-- ------------------------------------------------------------------ release
insert into public.ops_releases (environment, kind, sha, migrations_until, functions)
values ('homolog', 'publish', repeat('a', 40), '20261121034614_p58_operacao', 29);
select is((select app.ops_health_snapshot() -> 'release' ->> 'sha'), repeat('a', 40), 'versão publicada na leitura');

select * from finish();
rollback;

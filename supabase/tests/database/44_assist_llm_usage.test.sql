-- Assistente parte 2 · T11: uso da camada de linguagem por negócio. RLS ligada e só o dono lê; escrita só pela RPC;
-- outro negócio não grava nem lê; upsert soma; mês no fuso do negócio; custo null não zera a soma; teto de tokens
-- (abaixo e acima); anon não chama; nada de texto guardado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
/** sqlstate/mensagem/hint de uma chamada; 'ok' se não deu erro. */
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return v_state || '/' || v_msg || '/' || coalesce(nullif(v_hint, ''), '-');
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;
create function pg_temp.rec(p_tenant uuid, p_task text, p_in bigint, p_out bigint, p_cost numeric) returns jsonb
language sql as $$ select public.agent_llm_record(p_tenant, p_task, p_in, p_out, p_cost) $$;
grant execute on function pg_temp.rec(uuid, text, bigint, bigint, numeric) to authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'agent_llm_usage'), 'RLS ligada em agent_llm_usage');
select ok(not has_table_privilege('authenticated', 'public.agent_llm_usage', 'insert')
  and not has_table_privilege('authenticated', 'public.agent_llm_usage', 'update')
  and not has_table_privilege('authenticated', 'public.agent_llm_usage', 'delete'),
  'ninguém escreve direto na tabela: só pela RPC');
select ok(not has_table_privilege('anon', 'public.agent_llm_usage', 'select'), 'anon não lê o uso');
select ok(not has_function_privilege('anon', 'public.agent_llm_record(uuid, text, bigint, bigint, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.agent_llm_allowance(uuid)', 'execute'), 'anon não chama as RPCs de uso');
select ok(has_function_privilege('authenticated', 'public.agent_llm_record(uuid, text, bigint, bigint, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.agent_llm_allowance(uuid)', 'execute'), 'usuário logado chama as RPCs');
select ok(not has_function_privilege('authenticated', 'app.agent_llm_month(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.agent_llm_used(uuid, date)', 'execute'), 'funções internas fechadas');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('agent_llm_record', 'agent_llm_allowance')), 'RPCs security definer com search_path vazio');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_llm_usage'
  and (data_type in ('text', 'jsonb', 'character varying') and column_name <> 'task' or column_name in ('user_id', 'prompt'))),
  'sem texto, conteúdo nem usuário: só números e a tarefa');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'agent_quotas'
  and column_name = 'llm_monthly_tokens'), '400000', 'teto padrão: 400 mil tokens por mês');

-- ------------------------------------------------------------------ mês no fuso do negócio
select is(app.agent_llm_month((select tenant_a from ids), '2026-12-01 02:00:00+00'), '2026-11-01'::date,
  '01/12 02:00 UTC ainda é novembro em São Paulo');
update public.tenants set timezone = 'Asia/Tokyo' where id = (select tenant_b from ids);
select is(app.agent_llm_month((select tenant_b from ids), '2026-11-30 16:00:00+00'), '2026-12-01'::date,
  '30/11 16:00 UTC já é dezembro em Tóquio');
update public.tenants set timezone = 'America/Sao_Paulo' where id = (select tenant_b from ids);

-- ------------------------------------------------------------------ anon e sem vínculo
set local role anon;
select is(pg_temp.err(format($$ select public.agent_llm_record(%L, 'intent', 1, 1, 0) $$, (select tenant_a from ids))),
  '42501/permission denied for function agent_llm_record/-', 'anon não grava');
reset role;
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.agent_llm_record(%L, 'intent', 700, 100, 0.00012) $$, (select tenant_a from ids))),
  'PT403/FORBIDDEN/-', 'sem vínculo: não grava');
select is(pg_temp.err(format($$ select public.agent_llm_allowance(%L) $$, (select tenant_a from ids))),
  'PT403/FORBIDDEN/-', 'sem vínculo: não consulta o teto');

-- ------------------------------------------------------------------ dono grava; upsert soma
select pg_temp.login_as((select owner_a from ids));
select is(pg_temp.rec((select tenant_a from ids), 'intent', 700, 100, 0.00012)->>'calls', '1', 'primeira chamada do mês');
select is(pg_temp.rec((select tenant_a from ids), 'intent', 600, 50, 0.000085)->>'calls', '2', 'segunda soma na mesma linha');
select is(pg_temp.rec((select tenant_a from ids), 'intent', 300, 20, null)->>'unpriced_calls', '1', 'sem preço: conta em unpriced_calls');
select is(pg_temp.rec((select tenant_a from ids), 'draft', 400, 200, 0.00014)->>'calls', '1', 'outra tarefa, outra linha');
select is((select count(*)::int from public.agent_llm_usage where tenant_id = (select tenant_a from ids)), 2,
  'dono lê as linhas do próprio negócio (uma por tarefa)');
select row_eq($$ select calls, input_tokens, output_tokens, cost_usd, unpriced_calls from public.agent_llm_usage
  where tenant_id = '10000000-0000-4000-8000-00000000000a' and task = 'intent' $$,
  row(3, 1600::bigint, 170::bigint, 0.000205::numeric(12, 6), 1), 'soma de chamadas, tokens e custo; null não zera o custo');
select is((select month from public.agent_llm_usage where tenant_id = (select tenant_a from ids) and task = 'intent'),
  (select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date), 'mês gravado é o do fuso do negócio');
select is(pg_temp.err(format($$ select public.agent_llm_record(%L, 'sql', 1, 1, 0) $$, (select tenant_a from ids))),
  'PT400/VALIDATION_ERROR/task', 'tarefa fora da lista: recusada');
select is(pg_temp.err(format($$ select public.agent_llm_record(%L, 'intent', -1, 1, 0) $$, (select tenant_a from ids))),
  'PT400/VALIDATION_ERROR/input_tokens', 'tokens negativos: recusados');
select is(pg_temp.err(format($$ select public.agent_llm_record(%L, 'intent', 1, 1, -0.5) $$, (select tenant_a from ids))),
  'PT400/VALIDATION_ERROR/cost_usd', 'custo negativo: recusado');
select is(pg_temp.err(format($$ insert into public.agent_llm_usage (tenant_id, month, task) values (%L, '2026-11-01', 'intent') $$,
  (select tenant_a from ids))), '42501/permission denied for table agent_llm_usage/-', 'dono não escreve direto na tabela');

-- ------------------------------------------------------------------ teto: abaixo e acima
select is(public.agent_llm_allowance((select tenant_a from ids)),
  jsonb_build_object('allowed', true, 'used_tokens', 2370, 'limit_tokens', 400000), 'abaixo do teto: liberado, com o uso do mês');
reset role;
insert into public.agent_quotas (tenant_id, period_start, llm_monthly_tokens) values ((select tenant_a from ids), current_date, 2370)
on conflict (tenant_id) do update set llm_monthly_tokens = 2370;
set local role authenticated;
select is(public.agent_llm_allowance((select tenant_a from ids))->>'allowed', 'false', 'no teto: bloqueado (usado = limite)');
reset role;
update public.agent_quotas set llm_monthly_tokens = 2371 where tenant_id = (select tenant_a from ids);
set local role authenticated;
select is(public.agent_llm_allowance((select tenant_a from ids))->>'allowed', 'true', 'um token abaixo do teto: liberado');
select is(pg_temp.rec((select tenant_a from ids), 'intent', 10, 0, 0.000001)->>'calls', '4', 'a chamada que cruza o teto é gravada');
select is(public.agent_llm_allowance((select tenant_a from ids)),
  jsonb_build_object('allowed', false, 'used_tokens', 2380, 'limit_tokens', 2371), 'passou do teto: bloqueado');

-- ------------------------------------------------------------------ outro negócio não grava nem lê
select pg_temp.login_as((select owner_b from ids));
select is(pg_temp.err(format($$ select public.agent_llm_record(%L, 'intent', 1, 1, 0) $$, (select tenant_a from ids))),
  'PT403/FORBIDDEN/-', 'dono de B não grava no negócio A');
select is(pg_temp.err(format($$ select public.agent_llm_allowance(%L) $$, (select tenant_a from ids))),
  'PT403/FORBIDDEN/-', 'dono de B não consulta o teto de A');
select is((select count(*)::int from public.agent_llm_usage where tenant_id = (select tenant_a from ids)), 0,
  'dono de B não lê o uso de A');
select is(public.agent_llm_allowance((select tenant_b from ids)),
  jsonb_build_object('allowed', true, 'used_tokens', 0, 'limit_tokens', 400000), 'B começa do zero, com o teto padrão');

-- ------------------------------------------------------------------ equipe grava (usa o assistente) mas não lê
reset role;
insert into public.tenant_memberships (tenant_id, user_id, role) values ((select tenant_a from ids), (select owner_b from ids), 'staff');
set local role authenticated;
select is(pg_temp.err(format($$ select public.agent_llm_record(%L, 'intent', 5, 5, 0.00001) $$, (select tenant_a from ids))),
  'ok', 'equipe usa o assistente: o uso conta para o negócio');
select is((select count(*)::int from public.agent_llm_usage where tenant_id = (select tenant_a from ids)), 0,
  'equipe não lê o custo do negócio');
select pg_temp.login_as((select owner_a from ids));
select is((select calls from public.agent_llm_usage where tenant_id = (select tenant_a from ids) and task = 'intent'), 5,
  'chamada da equipe somada na linha do negócio');

select * from finish();
rollback;

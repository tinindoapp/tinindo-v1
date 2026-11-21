-- Assistente parte 2, item 2 · "Por quê?" nos insights (T3): frase do modelo guardada por versão do insight.
-- RLS ligada e só o dono lê; isolamento entre negócios (RPC e FK composta); escrita só pela RPC; versão errada não
-- grava; segunda gravação da mesma versão não sobrescreve; versão nova do insight pede frase nova.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '45000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '45000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '45100000-0000-4000-8000-00000000000a'::uuid as insight_a,
  '45100000-0000-4000-8000-00000000000b'::uuid as insight_b;
grant select on ids to authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert on r to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
grant execute on function pg_temp.got(text) to authenticated;

-- Dois negócios, cada um com o seu dono, o módulo Metas e sugestões ligado e um insight aberto (versão 3).
insert into public.tenants (id, name, profession, timezone) select tenant_a, 'Negócio Explica A', 'barber', 'America/Sao_Paulo' from ids;
insert into public.tenants (id, name, profession, timezone) select tenant_b, 'Negócio Explica B', 'barber', 'America/Sao_Paulo' from ids;
insert into public.tenant_memberships (tenant_id, user_id, role) select tenant_a, owner_a, 'owner' from ids;
insert into public.tenant_memberships (tenant_id, user_id, role) select tenant_b, owner_b, 'owner' from ids;
select app.module_admin_set(tenant_a, 'growth-advice', true) from ids;
select app.module_admin_set(tenant_b, 'growth-advice', true) from ids;
insert into public.insights (id, tenant_id, rule_code, subject_key, priority, title, body, evidence, action, first_seen_on, last_seen_on, valid_until, version)
select x.iid, x.tid, 'no_show_concentration', 'wd3', 80, 'Faltas concentradas na quarta', 'Na quarta faltaram 5 de 12 atendimentos.',
  '{"period_start": "2026-08-21", "period_end": "2026-10-20", "numerator": 5, "denominator": 12, "weekday": 3}'::jsonb,
  '{"kind": "open", "flow": "P13", "label": "Ajustar lembretes", "route": "/app/relacionamento"}'::jsonb,
  current_date, current_date, now() + interval '2 days', 3
from (select tenant_a as tid, insight_a as iid from ids union all select tenant_b, insight_b from ids) x;

-- ------------------------------------------------------------------ estrutura
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.insight_explanations'::regclass), 'RLS ligada');
select ok(not has_table_privilege('authenticated', 'public.insight_explanations', 'insert')
  and not has_table_privilege('authenticated', 'public.insight_explanations', 'update')
  and not has_table_privilege('authenticated', 'public.insight_explanations', 'delete'), 'dono não grava direto: só pela RPC');
select ok(not has_table_privilege('anon', 'public.insight_explanations', 'select'), 'anônimo não lê');
select ok(not has_function_privilege('anon', 'public.insight_explanation_save(uuid, uuid, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.insight_explanation_get(uuid, uuid)', 'execute'), 'anônimo não chama as RPCs');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
  where p.oid in ('public.insight_explanation_save(uuid, uuid, integer, text)'::regprocedure, 'public.insight_explanation_get(uuid, uuid)'::regprocedure)),
  'RPCs SECURITY DEFINER com search_path vazio');
select throws_ok(
  $$ insert into public.insight_explanations (tenant_id, insight_id, version, text) select tenant_a, insight_b, 3, 'x' from ids $$,
  '23503', null, 'FK composta: frase do negócio A não aponta para insight do negócio B');

-- ------------------------------------------------------------------ dono A
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'get0', public.insight_explanation_get((select tenant_a from ids), (select insight_a from ids));
select is(pg_temp.got('get0')->>'version', '3', 'leitura traz a versão atual do insight');
select is(pg_temp.got('get0')->'evidence'->>'denominator', '12', 'leitura traz a evidência (com denominador)');
select ok(pg_temp.got('get0') ? 'text' and pg_temp.got('get0')->'text' = 'null'::jsonb, 'sem frase guardada: text nulo');

select throws_ok(
  $$ select public.insight_explanation_save((select tenant_a from ids), (select insight_a from ids), 2, 'Frase de versão velha.') $$,
  'PT409', 'STALE_VERSION', 'versão diferente da atual: recusa');
select is((select count(*)::int from public.insight_explanations), 0, 'versão errada não grava');

insert into r select 'save1', public.insight_explanation_save((select tenant_a from ids), (select insight_a from ids), 3,
  'De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta.');
select is(pg_temp.got('save1')->>'saved', 'true', 'primeira gravação da versão grava');
insert into r select 'save2', public.insight_explanation_save((select tenant_a from ids), (select insight_a from ids), 3, 'Outra frase qualquer.');
select is(pg_temp.got('save2')->>'saved', 'false', 'segunda gravação da mesma versão não grava');
select is(pg_temp.got('save2')->>'text', 'De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta.', '... e devolve a frase que já estava (não sobrescreve)');
select is((public.insight_explanation_get((select tenant_a from ids), (select insight_a from ids)))->>'text',
  'De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta.', 'leitura devolve a frase guardada da versão atual');
select is((select count(*)::int from public.insight_explanations), 1, 'dono A lê a própria frase pela RLS');
select throws_ok(
  $$ select public.insight_explanation_save((select tenant_a from ids), (select insight_a from ids), 3, '   ') $$,
  'PT400', 'VALIDATION_ERROR', 'frase vazia é recusada');

-- Isolamento: o dono A não lê nem grava no negócio B (nem pelo header do negócio, nem pelo id do insight).
select throws_ok(
  $$ select public.insight_explanation_get((select tenant_b from ids), (select insight_b from ids)) $$,
  'PT403', 'FORBIDDEN', 'dono A não lê insight do negócio B');
select throws_ok(
  $$ select public.insight_explanation_save((select tenant_a from ids), (select insight_b from ids), 3, 'Frase cruzada.') $$,
  'PT404', 'NOT_FOUND', 'insight de outro negócio não existe para o negócio A');
reset role;

-- O motor recalcula o insight (versão 4): a frase da versão 3 fica, a versão 4 começa sem frase.
update public.insights set version = 4 where id = (select insight_a from ids);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select ok((public.insight_explanation_get((select tenant_a from ids), (select insight_a from ids)))->'text' = 'null'::jsonb,
  'versão nova do insight: sem frase (o servidor gera de novo)');
reset role;

-- ------------------------------------------------------------------ dono B
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is((select count(*)::int from public.insight_explanations), 0, 'RLS: dono B não vê a frase do negócio A');
reset role;

-- Módulo desligado: a trava de módulo vale também aqui.
select app.module_admin_set(tenant_a, 'growth-advice', false) from ids;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(
  $$ select public.insight_explanation_save((select tenant_a from ids), (select insight_a from ids), 4, 'Frase com o módulo desligado.') $$,
  'PT403', 'FORBIDDEN', 'módulo Metas e sugestões desligado: recusa');
reset role;

select * from finish();
rollback;

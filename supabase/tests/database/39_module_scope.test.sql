-- P51 · Escopo visível do piloto: catálogo de 10 + 6 + 11 módulos, chave por negócio (sem linha = desligado), o dono
-- liga e desliga só os "por ativação" com idempotência e auditoria, módulo guardado só pelo backend, isolamento entre
-- negócios, RLS, e a rotina de campanhas (módulo guardado) parada para o negócio sem o módulo (D4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as staff_a,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.mod(p_scope jsonb, p_module text) returns jsonb language sql as $$
  select m from jsonb_array_elements(p_scope->'modules') m where m->>'module' = p_module $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return v_state || '/' || v_msg || '/' || coalesce(nullif(v_hint, ''), '-');
end $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.mod(jsonb, text), pg_temp.err(text) to anon, authenticated;

insert into public.tenant_memberships (tenant_id, user_id, role) select tenant_a, staff_a, 'staff' from ids;
-- O seed liga todos os módulos para A (recado #142); este teste parte de um negócio sem chave nenhuma.
delete from public.tenant_modules where tenant_id = (select tenant_a from ids);

-- ------------------------------------------------------------------ catálogo, estrutura e grants
select is((select string_agg(level || '=' || n, ',' order by level) from (select level, count(*) n from app.module_catalog() group by level) x),
  'activation=6,pilot=11,stored=11', 'catálogo: 11 do piloto (10 + privacy), 6 por ativação, 11 guardados');
select is((select count(distinct module)::int from app.module_catalog()), 28, '28 módulos (27 + privacy), sem repetição');
select is((select string_agg(module, ',' order by ord) from app.module_catalog() where level = 'activation'),
  'recurrence,sales,growth-advice,analytics,referrals,service-ops', 'os seis por ativação');
select ok((select relrowsecurity from pg_class where oid = 'public.tenant_modules'::regclass), 'RLS ligada em tenant_modules');
select ok(not has_table_privilege('authenticated', 'public.tenant_modules', 'insert'), 'chave: sem insert pela Data API');
select ok(not has_table_privilege('authenticated', 'public.tenant_modules', 'update'), 'chave: sem update pela Data API');
select ok(not has_table_privilege('authenticated', 'public.tenant_modules', 'delete'), 'chave: sem delete pela Data API');
select ok(not has_table_privilege('anon', 'public.tenant_modules', 'select'), 'anon não lê a chave');
select ok(not has_function_privilege('anon', 'public.setup_scope(uuid)', 'execute'), 'anon não lê o escopo');
select ok(not has_function_privilege('anon', 'public.setup_module_set(uuid, text, boolean, text, text, uuid)', 'execute'), 'anon não muda a chave');
select ok(not has_function_privilege('authenticated', 'app.module_admin_set(uuid, text, boolean)', 'execute'), 'ligar guardado é só do backend');
select ok(not has_function_privilege('authenticated', 'app.module_write(uuid, text, boolean, uuid)', 'execute'), 'gravação só por dentro das RPCs');
select ok(has_function_privilege('service_role', 'app.module_admin_set(uuid, text, boolean)', 'execute'), 'backend pode ligar guardado');
select is(pg_temp.err(format($$ insert into public.tenant_modules (tenant_id, module, enabled) values (%L, 'scheduling', false) $$, (select tenant_a from ids))) like '23514/%', true,
  'módulo do piloto não tem chave (check)');
select is(pg_temp.err(format($$ insert into public.tenant_modules (tenant_id, module, enabled) values (%L, 'inexistente', true) $$, (select tenant_a from ids))) like '23514/%', true,
  'módulo inexistente não entra (check)');

-- ------------------------------------------------------------------ negócio novo: piloto ligado, o resto desligado; profissão e plano
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 's0', public.setup_scope((select tenant_a from ids));
select is(pg_temp.got('s0')->>'profession', 'barber', 'escopo traz a profissão');
select is(pg_temp.got('s0')->'plan'->>'code', 'free', 'sem assinatura registrada: plano Grátis');
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('s0')->'modules')), 28, 'escopo lista os 28 módulos');
select is((select string_agg(m->>'module', ',' order by o) from jsonb_array_elements(pg_temp.got('s0')->'modules') with ordinality x(m, o) where (m->>'enabled')::boolean),
  'scheduling,crm,finance,identity,setup,network,lifecycle,pricing,waitlist,agent,privacy', 'sem chave nenhuma: só os 11 do piloto ligados');
select is(pg_temp.mod(pg_temp.got('s0'), 'sales')->>'level', 'activation', 'Orçamentos é por ativação');
select is(pg_temp.mod(pg_temp.got('s0'), 'messaging')->>'level', 'stored', 'Mensagens está guardado');

-- ------------------------------------------------------------------ dono liga: idempotente e auditado
insert into r select 'on1', public.setup_module_set((select tenant_a from ids), 'sales', true, 'idem-p51-sales-on-00001', pg_temp.h('on'));
select is(pg_temp.got('on1')->>'status_code', '200', 'ligar responde 200');
select is(pg_temp.mod(pg_temp.got('on1')->'body'->'scope', 'sales')->>'enabled', 'true', 'a resposta já traz o módulo ligado');
insert into r select 'on1r', public.setup_module_set((select tenant_a from ids), 'sales', true, 'idem-p51-sales-on-00001', pg_temp.h('on'));
select is(pg_temp.got('on1r'), pg_temp.got('on1'), 'mesma chave: mesma resposta');
select is(pg_temp.err(format($$ select public.setup_module_set(%L, 'sales', false, 'idem-p51-sales-on-00001', %L) $$, (select tenant_a from ids), pg_temp.h('outro'))),
  'PT409/IDEMPOTENCY_MISMATCH/-', 'mesma chave com outro pedido: 409');
-- Chave nova pedindo o estado que já vale: não muda nada nem audita de novo.
insert into r select 'on2', public.setup_module_set((select tenant_a from ids), 'sales', true, 'idem-p51-sales-on-00002', pg_temp.h('on'));
reset role;
select is((select count(*)::int from public.audit_events a where a.tenant_id = (select tenant_a from ids) and a.occurred_at >= now() and a.action = 'module.enable'), 1, 'uma linha de auditoria para uma mudança');
select is((select a.before->>'enabled' || '>' || (a.after->>'enabled') || ':' || (a.after->>'module') from public.audit_events a
  where a.tenant_id = (select tenant_a from ids) and a.occurred_at >= now() and a.action = 'module.enable'), 'false>true:sales', 'auditoria guarda antes, depois e o módulo');
select is((select a.actor_user_id from public.audit_events a where a.tenant_id = (select tenant_a from ids) and a.occurred_at >= now() and a.action = 'module.enable'), (select owner_a from ids), 'auditoria guarda quem ligou');
select is((select count(*)::int from public.tenant_modules m where m.tenant_id = (select tenant_a from ids)), 1, 'uma linha de chave');

-- ------------------------------------------------------------------ dono desliga
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'off1', public.setup_module_set((select tenant_a from ids), 'sales', false, 'idem-p51-sales-off-0001', pg_temp.h('off'));
select is(pg_temp.mod(pg_temp.got('off1')->'body'->'scope', 'sales')->>'enabled', 'false', 'desligar devolve o módulo desligado');
reset role;
select is((select count(*)::int from public.audit_events a where a.tenant_id = (select tenant_a from ids) and a.occurred_at >= now() and a.action = 'module.disable'), 1, 'desligar também é auditado');
select is((select m.version from public.tenant_modules m where m.tenant_id = (select tenant_a from ids) and m.module = 'sales'), 2, 'a mesma linha muda de estado (versão 2)');

-- ------------------------------------------------------------------ o que o dono não pode
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.setup_module_set(%L, 'campaigns', true, 'idem-p51-stored-000001', %L) $$, (select tenant_a from ids), pg_temp.h('st'))),
  'PT403/FORBIDDEN/-', 'dono não liga módulo guardado');
select is(pg_temp.err(format($$ select public.setup_module_set(%L, 'scheduling', false, 'idem-p51-pilot-0000001', %L) $$, (select tenant_a from ids), pg_temp.h('pi'))),
  'PT400/VALIDATION_ERROR/module', 'módulo do piloto não se desliga');
select is(pg_temp.err(format($$ select public.setup_module_set(%L, 'nao-existe', true, 'idem-p51-unknown-00001', %L) $$, (select tenant_a from ids), pg_temp.h('un'))),
  'PT400/VALIDATION_ERROR/module', 'módulo inexistente: 400');
-- Equipe (staff) lê o escopo e não muda a chave.
select pg_temp.login_as((select staff_a from ids));
select is(public.setup_scope((select tenant_a from ids))->>'profession', 'barber', 'equipe lê o escopo do negócio');
select is(pg_temp.err(format($$ select public.setup_module_set(%L, 'sales', true, 'idem-p51-staff-0000001', %L) $$, (select tenant_a from ids), pg_temp.h('sf'))),
  'PT403/FORBIDDEN/-', 'equipe não liga módulo');

-- ------------------------------------------------------------------ isolamento entre negócios
select pg_temp.login_as((select owner_b from ids));
select is(pg_temp.err(format($$ select public.setup_scope(%L) $$, (select tenant_a from ids))), 'PT403/FORBIDDEN/-', 'dono B não lê o escopo de A');
select is(pg_temp.err(format($$ select public.setup_module_set(%L, 'sales', true, 'idem-p51-cross-0000001', %L) $$, (select tenant_a from ids), pg_temp.h('cx'))),
  'PT403/FORBIDDEN/-', 'dono B não muda a chave de A');
select is((select count(*)::int from public.tenant_modules m where m.tenant_id = (select tenant_a from ids)), 0, 'RLS: B não vê as chaves de A');
select is(public.setup_scope((select tenant_b from ids))->>'profession', 'personal_trainer', 'B lê o próprio escopo (personal)');
insert into r select 'b1', public.setup_module_set((select tenant_b from ids), 'recurrence', true, 'idem-p51-b-recur-000001', pg_temp.h('b'));
reset role;
select is((select string_agg(m.module || '=' || m.enabled, ',' order by m.module) from public.tenant_modules m where m.tenant_id = (select tenant_a from ids)), 'sales=false',
  'ligar em B não muda A');

-- ------------------------------------------------------------------ guardado: só o backend liga, com auditoria
select is(app.module_enabled((select tenant_a from ids), 'campaigns'), false, 'campanhas desligado por padrão');
select is(app.module_admin_set((select tenant_a from ids), 'campaigns', true), true, 'backend liga o guardado');
select is((select count(*)::int from public.audit_events a where a.tenant_id = (select tenant_a from ids) and a.occurred_at >= now() and a.action = 'module.enable' and a.after->>'module' = 'campaigns'), 1,
  'ligar guardado pelo backend também é auditado');

-- ------------------------------------------------------------------ o backend também desliga; piloto e inexistente recusados
select is(app.module_admin_set((select tenant_a from ids), 'campaigns', true), false, 'pedir o estado que já vale não muda nada');
select is(app.module_admin_set((select tenant_a from ids), 'campaigns', false), true, 'backend desliga o guardado');
select is(app.module_enabled((select tenant_a from ids), 'campaigns'), false, 'campanhas volta a desligado');
select is(pg_temp.err(format($$ select app.module_admin_set(%L, 'crm', false) $$, (select tenant_a from ids))), 'PT400/VALIDATION_ERROR/module', 'backend também não desliga módulo do piloto');
-- A rotina de campanhas parada sem o módulo (D4) é provada em 18_campaigns.test.sql, onde há campanha em curso.

-- ------------------------------------------------------------------ D3 (b): texto dos planos sem diferença que não existe
-- A versão 2 de cada plano (este pacote, D3 b) continua publicada e imutável. A versão 3 (planos por capacidade, D3 a)
-- é provada em 51_planos_capacidades.test.sql.
create function pg_temp.plan_v2(p_code text) returns public.offering_versions language sql as $$
  select v.* from public.offering_versions v join public.platform_offerings o on o.id = v.offering_id where o.code = p_code and v.version_no = 2 $$;
select is((pg_temp.plan_v2('founder')).version_no, 2, 'Completo ganhou versão nova (a anterior fica, imutável)');
select ok((pg_temp.plan_v2('founder')).included::text !~* 'ofertas de vaga|recuperação de agenda|tudo do grátis', 'Completo não promete mais o que todo negócio já tem');
select ok((pg_temp.plan_v2('founder')).description ~ 'mesmas do Grátis', 'Completo diz que no piloto as funções são as mesmas');
select is((pg_temp.plan_v2('free')).agent_questions_month, (pg_temp.plan_v2('founder')).agent_questions_month, 'a franquia do assistente continua igual nos dois');

select * from finish();
rollback;

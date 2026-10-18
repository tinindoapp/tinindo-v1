-- P15 · Planos e serviços assistidos: versão fixada (compromisso histórico), franquia aplicada no servidor, pedido
-- com escopo aceito, operador sem acesso global (concessão do dono com escopo/prazo, leitura auditada), minutos
-- medidos com teto, entrega com aprovação e reabertura registrada, isolamento entre negócios.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as op1,
  'e0000000-0000-4000-8000-0000000000ee'::uuid as op2,
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
create function pg_temp.ver(p_code text) returns jsonb language sql security definer as $$
  select jsonb_build_object('id', v.id, 'hash', v.scope_hash) from public.offering_versions v
  join public.platform_offerings o on o.id = v.offering_id where o.code = p_code order by v.version_no desc limit 1
$$;
create function pg_temp.oid(p_k text) returns uuid language sql as $$ select (v->'body'->'order'->>'id')::uuid from r where k = p_k $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.ver(text), pg_temp.oid(text) to authenticated;

insert into public.platform_operators (user_id, display_name) values
  ((select op1 from ids), 'Operadora Um (exemplo)'), ((select op2 from ids), 'Operador Dois (exemplo)');

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('platform_operators', 'subscriptions', 'service_orders', 'work_logs',
    'deliverables', 'access_grants', 'offering_versions')), 'RLS ligada');
select ok(not has_table_privilege('authenticated', 'public.platform_operators', 'insert'), 'ninguém se torna operador pelo app');
select ok(not has_table_privilege('authenticated', 'public.platform_operators', 'select'), 'lista de operadores não é legível direto');
select ok(not has_table_privilege('authenticated', 'public.work_logs', 'insert'), 'minutos só por RPC');
select ok(not has_function_privilege('authenticated',
  'app.svc_publish_offering(text, text, text, text, bigint, text, jsonb, jsonb, integer, integer, integer)', 'execute'),
  'publicar oferta é só do backend');
select ok(not has_function_privilege('anon', 'public.service_ops_queue()', 'execute'), 'anon não vê a fila');

-- ------------------------------------------------------------------ plano: versão fixada e franquia
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cur0', public.service_plan_current((select tenant_a from ids));
select is(pg_temp.got('cur0')->'plan'->>'code', 'free', 'sem assinatura: plano Grátis');
select is(pg_temp.got('cur0')->'subscription', 'null'::jsonb, 'sem assinatura registrada');
select throws_ok(format($$ select public.service_plan_subscribe(%L, %L, %L, 'idem-sv-sub-stale-1', %L) $$,
  (select tenant_a from ids), pg_temp.ver('founder')->>'id', repeat('0', 64), pg_temp.h('st')),
  'PT409', 'STALE_VERSION', 'assinar exige o hash do escopo visto');
insert into r select 'sub_a', public.service_plan_subscribe((select tenant_a from ids), (pg_temp.ver('founder')->>'id')::uuid,
  pg_temp.ver('founder')->>'hash', 'idem-sv-sub-a-0001', pg_temp.h('sub_a'));
select is(pg_temp.got('sub_a')->'body'->'plan'->>'code', 'founder', 'assinou o Completo');
select is((pg_temp.got('sub_a')->'body'->'subscription'->>'price_cents')::bigint, 7900::bigint, 'preço de fundador fixado');
select is((pg_temp.got('sub_a')->'body'->'usage'->>'agent_questions_limit')::int, 200, 'franquia do assistente aplicada');
select is(public.service_plan_subscribe((select tenant_a from ids), (pg_temp.ver('founder')->>'id')::uuid,
  pg_temp.ver('founder')->>'hash', 'idem-sv-sub-a-0001', pg_temp.h('sub_a')), pg_temp.got('sub_a'), 'repetição devolve o mesmo');
select throws_ok(format($$ select public.service_plan_subscribe(%L, %L, %L, 'idem-sv-sub-a-0002', %L) $$,
  (select tenant_a from ids), pg_temp.ver('founder')->>'id', pg_temp.ver('founder')->>'hash', pg_temp.h('again')),
  'PT422', 'POLICY_REJECTED', 'já está neste plano');
select throws_ok(format($$ select public.service_plan_subscribe(%L, %L, %L, 'idem-sv-sub-svc-01', %L) $$,
  (select tenant_a from ids), pg_temp.ver('implantacao_exemplo')->>'id', pg_temp.ver('implantacao_exemplo')->>'hash', pg_temp.h('svc')),
  'PT404', 'NOT_FOUND', 'serviço não é plano');
reset role;

-- Nova versão do plano (preço e franquia novos): quem já assinou mantém o compromisso.
create temp table old_founder as select pg_temp.ver('founder') as v;
grant select on old_founder to authenticated;
select app.svc_publish_offering('founder', 'plan', 'Completo', 'Nova versão.', 9900, 'monthly', '["Tudo"]', '["Nada"]', 300, null, null);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cur1', public.service_plan_current((select tenant_a from ids));
select is((pg_temp.got('cur1')->'plan'->>'price_cents')::bigint, 7900::bigint, 'versão nova não muda o preço de quem assinou');
select is((pg_temp.got('cur1')->>'plan_is_latest')::boolean, false, 'tela sabe que há versão mais nova');
select is((pg_temp.got('cur1')->'usage'->>'agent_questions_limit')::int, 200, 'franquia antiga preservada');
select throws_ok(format($$ select public.service_plan_subscribe(%L, %L, %L, 'idem-sv-sub-old-01', %L) $$,
  (select tenant_a from ids), (select v->>'id' from old_founder), (select v->>'hash' from old_founder), pg_temp.h('old')),
  'PT409', 'STALE_VERSION', 'versão antiga não aceita novas adesões');
select pg_temp.login_as((select owner_b from ids));
insert into r select 'sub_b', public.service_plan_subscribe((select tenant_b from ids), (pg_temp.ver('founder')->>'id')::uuid,
  pg_temp.ver('founder')->>'hash', 'idem-sv-sub-b-0001', pg_temp.h('sub_b'));
select is((pg_temp.got('sub_b')->'body'->'usage'->>'agent_questions_limit')::int, 300, 'nova adesão recebe a franquia nova');
reset role;
select is((select monthly_limit from public.agent_quotas where tenant_id = (select tenant_b from ids)), 300,
  'limite aplicado na tabela que o assistente (P08) debita');

-- ------------------------------------------------------------------ pedido de serviço
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'o1', public.service_order_request((select tenant_a from ids), (pg_temp.ver('implantacao_exemplo')->>'id')::uuid,
  pg_temp.ver('implantacao_exemplo')->>'hash', 'Prefiro de manhã', 'idem-sv-order-1-001', pg_temp.h('o1'));
select is(pg_temp.got('o1')->'body'->'order'->>'status', 'scope_accepted', 'pedido nasce com escopo aceito');
select is((pg_temp.got('o1')->'body'->'order'->>'minutes_quota')::int, 120, 'franquia de minutos fixada no pedido');
select throws_ok(format($$ select public.service_order_request(%L, %L, %L, null, 'idem-sv-order-plan1', %L) $$,
  (select tenant_a from ids), pg_temp.ver('free')->>'id', pg_temp.ver('free')->>'hash', pg_temp.h('op')),
  'PT404', 'NOT_FOUND', 'plano não é pedido de serviço');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
select throws_ok(format($$ select public.service_order_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN',
  'dono de B não lista pedidos de A');
select throws_ok(format($$ select public.service_access_grant(%L, %L, '{catalog}', now() + interval '1 day', 'x', 'idem-sv-grant-b-01', %L) $$,
  (select tenant_b from ids), pg_temp.oid('o1'), pg_temp.h('gb')), 'PT404', 'NOT_FOUND', 'dono de B não concede acesso ao pedido de A');
select is((select count(*)::int from public.service_orders), 0, 'RLS: dono de B não vê pedidos de A');
select pg_temp.login_as((select customer_ab from ids));
select throws_ok(format($$ select public.service_plan_current(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN',
  'cliente com login não vê o plano do negócio');
select pg_temp.login_as((select owner_a from ids));
select throws_ok($$ select public.service_ops_queue() $$, 'PT403', 'FORBIDDEN', 'dono não é operador');

-- ------------------------------------------------------------------ operação: sem concessão, sem acesso
select pg_temp.login_as((select op1 from ids));
insert into r select 'queue', public.service_ops_queue();
select ok(jsonb_array_length(pg_temp.got('queue')->'orders') >= 1, 'operador vê a fila de todos os negócios');
select ok(pg_temp.got('queue')::text !~ 'Cliente AB', 'fila sem dados de clientes dos negócios');
insert into r select 'asg', public.service_ops_assign((select tenant_a from ids), pg_temp.oid('o1'), (select op1 from ids),
  now() + interval '7 days', 'idem-sv-assign-1-01', pg_temp.h('asg'));
select is(pg_temp.got('asg')->'body'->'order'->>'status', 'awaiting_access', 'responsável definido, aguardando acesso');
select throws_ok(format($$ select public.service_ops_start(%L, %L, 'idem-sv-start-noacc', %L) $$, (select tenant_a from ids),
  pg_temp.oid('o1'), pg_temp.h('na')), 'PT422', 'POLICY_REJECTED', 'sem concessão do dono não começa');
select throws_ok(format($$ select public.service_ops_snapshot(%L, %L) $$, (select tenant_a from ids), pg_temp.oid('o1')),
  'PT403', 'FORBIDDEN', 'sem concessão não lê nada do negócio');

-- ------------------------------------------------------------------ concessão do dono
select pg_temp.login_as((select owner_a from ids));
select throws_ok(format($$ select public.service_access_grant(%L, %L, '{catalog}', now() + interval '40 days', 'Cadastro', 'idem-sv-grant-40d1', %L) $$,
  (select tenant_a from ids), pg_temp.oid('o1'), pg_temp.h('g40')), 'PT400', 'VALIDATION_ERROR', 'acesso dura no máximo 30 dias');
select throws_ok(format($$ select public.service_access_grant(%L, %L, '{finance}', now() + interval '7 days', 'Cadastro', 'idem-sv-grant-fin1', %L) $$,
  (select tenant_a from ids), pg_temp.oid('o1'), pg_temp.h('gf')), 'PT400', 'VALIDATION_ERROR', 'escopo fora da lista é recusado');
insert into r select 'g1', public.service_access_grant((select tenant_a from ids), pg_temp.oid('o1'), '{agenda,catalog}',
  now() + interval '7 days', 'Cadastrar serviços e horários', 'idem-sv-grant-1-001', pg_temp.h('g1'));
select is((pg_temp.got('g1')->'body'->'grant'->>'active')::boolean, true, 'concessão ativa para o responsável');
select is(pg_temp.got('g1')->'body'->'grant'->>'operator_user_id', (select op1::text from ids), 'concessão é pessoal');
reset role;
select throws_ok(format($$ update public.access_grants set scopes = '{catalog,agenda,customers}' where id = %L $$,
  pg_temp.got('g1')->'body'->'grant'->>'id'), 'PT403', 'FORBIDDEN', 'concessão não amplia escopo depois de criada');
set local role authenticated;

select pg_temp.login_as((select op2 from ids));
select throws_ok(format($$ select public.service_ops_snapshot(%L, %L) $$, (select tenant_a from ids), pg_temp.oid('o1')),
  'PT403', 'FORBIDDEN', 'outro operador não usa a concessão');
select pg_temp.login_as((select op1 from ids));
insert into r select 'snap', public.service_ops_snapshot((select tenant_a from ids), pg_temp.oid('o1'));
select ok(jsonb_array_length(pg_temp.got('snap')->'catalog') >= 1, 'lê o catálogo concedido');
select is(pg_temp.got('snap')->'customers', 'null'::jsonb, 'clientes fora do escopo concedido');
select ok(pg_temp.got('snap')::text !~ 'exemplo\.test', 'sem e-mail de cliente');
reset role;
select is((select count(*)::int from public.audit_events where action = 'access.read' and tenant_id = (select tenant_a from ids)), 1,
  'leitura auditada');
set local role authenticated;
select pg_temp.login_as((select owner_a from ids));
select ok(public.service_access_log((select tenant_a from ids))->'entries' @>
  '[{"action":"access.read","actor_name":"Operadora Um (exemplo)"}]', 'dono vê quem leu o quê');

-- ------------------------------------------------------------------ execução, minutos e entrega
select pg_temp.login_as((select op1 from ids));
insert into r select 'start', public.service_ops_start((select tenant_a from ids), pg_temp.oid('o1'), 'idem-sv-start-1-001', pg_temp.h('start'));
select is(pg_temp.got('start')->'body'->'order'->>'status', 'in_progress', 'execução iniciada');
insert into r select 'w1', public.service_ops_log_work((select tenant_a from ids), pg_temp.oid('o1'), 60, 'human', false, 'Serviços',
  'idem-sv-work-1-0001', pg_temp.h('w1'));
insert into r select 'w2', public.service_ops_log_work((select tenant_a from ids), pg_temp.oid('o1'), 30, 'automation', true, 'Reimportação',
  'idem-sv-work-1-0002', pg_temp.h('w2'));
select is((pg_temp.got('w2')->'body'->'order'->>'minutes_used')::int, 90, 'minutos medidos somados');
select is((pg_temp.got('w2')->'body'->'order'->>'reprocess_minutes')::int, 30, 'retrabalho medido à parte');
select is((pg_temp.got('w2')->'body'->'order'->>'human_minutes')::int, 60, 'tempo humano separado da automação');
select throws_ok(format($$ select public.service_ops_log_work(%L, %L, 31, 'human', false, null, 'idem-sv-work-1-0003', %L) $$,
  (select tenant_a from ids), pg_temp.oid('o1'), pg_temp.h('w3')), 'PT429', 'QUOTA_EXCEEDED', 'franquia de minutos é teto no servidor');
select is(public.service_ops_log_work((select tenant_a from ids), pg_temp.oid('o1'), 60, 'human', false, 'Serviços',
  'idem-sv-work-1-0001', pg_temp.h('w1')), pg_temp.got('w1'), 'repetir o registro não soma de novo');
select pg_temp.login_as((select op2 from ids));
select throws_ok(format($$ select public.service_ops_log_work(%L, %L, 5, 'human', false, null, 'idem-sv-work-op2-01', %L) $$,
  (select tenant_a from ids), pg_temp.oid('o1'), pg_temp.h('w4')), 'PT403', 'FORBIDDEN', 'só o responsável registra minutos');
reset role;
select throws_ok(format($$ update public.work_logs set minutes = 1 where order_id = %L $$, pg_temp.oid('o1')),
  'PT403', 'FORBIDDEN', 'minutos são append-only');
set local role authenticated;

select pg_temp.login_as((select op1 from ids));
insert into r select 'd1', public.service_ops_deliver((select tenant_a from ids), pg_temp.oid('o1'), 'Cadastro inicial',
  '12 serviços e horários de seg a sex cadastrados', 'idem-sv-deliver-1-01', pg_temp.h('d1'));
select is(pg_temp.got('d1')->'body'->'order'->>'status', 'client_review', 'entrega vai para revisão do cliente');
select pg_temp.login_as((select owner_a from ids));
insert into r select 'rv1', public.service_delivery_review((select tenant_a from ids), pg_temp.oid('o1'),
  (pg_temp.got('d1')->'body'->>'deliverable_id')::uuid, 'changes_requested', 'Faltou a barba', 'idem-sv-review-1-01', pg_temp.h('rv1'));
select is(pg_temp.got('rv1')->'body'->'order'->>'status', 'in_progress', 'pedir ajustes reabre');
select pg_temp.login_as((select op1 from ids));
insert into r select 'd2', public.service_ops_deliver((select tenant_a from ids), pg_temp.oid('o1'), 'Cadastro inicial',
  'Barba incluída', 'idem-sv-deliver-1-02', pg_temp.h('d2'));
select pg_temp.login_as((select owner_a from ids));
select throws_ok(format($$ select public.service_delivery_review(%L, %L, %L, 'approved', null, 'idem-sv-review-old1', %L) $$,
  (select tenant_a from ids), pg_temp.oid('o1'), pg_temp.got('d1')->'body'->>'deliverable_id', pg_temp.h('old')),
  'PT422', 'POLICY_REJECTED', 'só a entrega mais recente é aprovada');
insert into r select 'rv2', public.service_delivery_review((select tenant_a from ids), pg_temp.oid('o1'),
  (pg_temp.got('d2')->'body'->>'deliverable_id')::uuid, 'approved', null, 'idem-sv-review-1-02', pg_temp.h('rv2'));
select is(pg_temp.got('rv2')->'body'->'order'->>'status', 'delivered', 'entrega aprovada');
reset role;
select is((select count(*)::int from public.access_grants where order_id = pg_temp.oid('o1') and revoked_at is null), 0,
  'aprovar a entrega revoga o acesso');
select is((select array_agg(to_status order by id) from public.service_order_events where order_id = pg_temp.oid('o1')),
  array['scope_accepted', 'awaiting_access', 'in_progress', 'client_review', 'in_progress', 'client_review', 'delivered'],
  'histórico completo, com a reabertura registrada');
set local role authenticated;
select pg_temp.login_as((select op1 from ids));
select throws_ok(format($$ select public.service_ops_snapshot(%L, %L) $$, (select tenant_a from ids), pg_temp.oid('o1')),
  'PT403', 'FORBIDDEN', 'depois da entrega, sem acesso');

-- ------------------------------------------------------------------ revogação, troca de responsável, cancelamento
select pg_temp.login_as((select owner_a from ids));
insert into r select 'o2', public.service_order_request((select tenant_a from ids), (pg_temp.ver('implantacao_exemplo')->>'id')::uuid,
  pg_temp.ver('implantacao_exemplo')->>'hash', null, 'idem-sv-order-2-001', pg_temp.h('o2'));
select pg_temp.login_as((select op1 from ids));
insert into r select 'asg2', public.service_ops_assign((select tenant_a from ids), pg_temp.oid('o2'), (select op1 from ids), null,
  'idem-sv-assign-2-01', pg_temp.h('asg2'));
select pg_temp.login_as((select owner_a from ids));
insert into r select 'g2', public.service_access_grant((select tenant_a from ids), pg_temp.oid('o2'), '{customers}',
  now() + interval '2 days', 'Importar clientes', 'idem-sv-grant-2-001', pg_temp.h('g2'));
insert into r select 'rk2', public.service_access_revoke((select tenant_a from ids), (pg_temp.got('g2')->'body'->'grant'->>'id')::uuid,
  'idem-sv-revoke-2-01', pg_temp.h('rk2'));
select is((pg_temp.got('rk2')->'body'->'grant'->>'active')::boolean, false, 'dono revoga');
select pg_temp.login_as((select op1 from ids));
select throws_ok(format($$ select public.service_ops_snapshot(%L, %L) $$, (select tenant_a from ids), pg_temp.oid('o2')),
  'PT403', 'FORBIDDEN', 'revogado não lê mais');
select pg_temp.login_as((select owner_a from ids));
insert into r select 'g3', public.service_access_grant((select tenant_a from ids), pg_temp.oid('o2'), '{customers}',
  now() + interval '2 days', 'Importar clientes', 'idem-sv-grant-3-001', pg_temp.h('g3'));
select pg_temp.login_as((select op1 from ids));
insert into r select 'asg3', public.service_ops_assign((select tenant_a from ids), pg_temp.oid('o2'), (select op2 from ids), null,
  'idem-sv-assign-3-01', pg_temp.h('asg3'));
reset role;
select is((select count(*)::int from public.access_grants where order_id = pg_temp.oid('o2') and revoked_at is null), 0,
  'trocar o responsável revoga o acesso do anterior');
set local role authenticated;
select pg_temp.login_as((select owner_a from ids));
select throws_ok(format($$ select public.service_order_cancel(%L, %L, 1, 'idem-sv-cancel-2-st', %L) $$, (select tenant_a from ids),
  pg_temp.oid('o2'), pg_temp.h('cst')), 'PT409', 'STALE_VERSION', 'cancelar exige a versão atual');
insert into r select 'c2', public.service_order_cancel((select tenant_a from ids), pg_temp.oid('o2'),
  (select version from public.service_orders where id = pg_temp.oid('o2')), 'idem-sv-cancel-2-01', pg_temp.h('c2'));
select is(pg_temp.got('c2')->'body'->'order'->>'status', 'cancelled', 'cliente cancela');

select * from finish();
rollback;

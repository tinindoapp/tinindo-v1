-- Planos e cobrança da Tinindo (1/5) · capacidades legíveis por máquina em cada versão de plano (D3 a).
-- Estrutura validada, publicação idempotente e só do backend, versão imutável, leitura com capacidades e compromisso
-- histórico (quem está numa versão anterior continua nela, sem capacidades).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.latest(p_code text) returns public.offering_versions language sql as $$
  select v.* from public.offering_versions v join public.platform_offerings o on o.id = v.offering_id
  where o.code = p_code order by v.version_no desc limit 1 $$;
create function pg_temp.plan(p_patch jsonb) returns jsonb language sql as $$
  select jsonb_build_object('code', 'plano_teste', 'name', 'Plano de teste', 'description', 'só no teste', 'price_cents', 1000,
    'included', '[]'::jsonb, 'excluded', '[]'::jsonb,
    'capabilities', jsonb_build_object('modules', jsonb_build_array('sales'), 'customers_max', 10, 'bookings_month', 20,
      'agent_questions_month', 5, 'reminders_month', 7),
    'terms', jsonb_build_object('trial_days', 0, 'grace_days', 3, 'price_lock_months', null, 'available_from', null,
      'available_until', null),
    'a_confirmar_pelo_felipe', '[]'::jsonb) || p_patch $$;
create function pg_temp.caps(p_patch jsonb) returns jsonb language sql as $$
  select pg_temp.plan('{}') -> 'capabilities' || p_patch $$;

-- ------------------------------------------------------------------ estrutura
select has_column('public', 'offering_versions', 'capabilities', 'versão tem capacidades');
select has_column('public', 'offering_versions', 'terms', 'versão tem condições');
select ok(not has_function_privilege('authenticated', 'app.svc_publish_plan(jsonb)', 'execute'), 'publicar plano é só do backend');
select ok(not has_function_privilege('anon', 'app.svc_publish_plan(jsonb)', 'execute'), 'anon também não publica');

-- ------------------------------------------------------------------ versões publicadas (planos.json)
select is((pg_temp.latest('free')).version_no, 3, 'Grátis: versão 3 com capacidades');
select is((pg_temp.latest('founder')).version_no, 3, 'Completo: versão 3 com capacidades');
select ok(app.plan_caps_valid((pg_temp.latest('free')).capabilities), 'capacidades do Grátis bem formadas');
select ok(app.plan_terms_valid((pg_temp.latest('founder')).terms), 'condições do Completo bem formadas');
select is((pg_temp.latest('founder')).price_cents, 7900::bigint, 'Completo de fundador a R$ 79');
select is((pg_temp.latest('founder')).terms->>'price_lock_months', '12', 'preço de fundador travado por 12 meses');
select ok(((pg_temp.latest('free')).capabilities->>'customers_max')::int < ((pg_temp.latest('founder')).capabilities->>'customers_max')::int,
  'o Completo libera mais clientes que o Grátis');
select ok(jsonb_array_length((pg_temp.latest('founder')).capabilities->'modules') > jsonb_array_length((pg_temp.latest('free')).capabilities->'modules'),
  'o Completo libera mais recursos que o Grátis');
select is((pg_temp.latest('free')).agent_questions_month, ((pg_temp.latest('free')).capabilities->>'agent_questions_month')::int,
  'a coluna antiga da franquia do assistente acompanha a capacidade');
select ok((select bool_and(v.capabilities is null and v.terms is null) from public.offering_versions v
  join public.platform_offerings o on o.id = v.offering_id where o.code in ('free', 'founder') and v.version_no < 3),
  'versões anteriores ficam como estavam (sem capacidades)');

-- ------------------------------------------------------------------ publicação validada e idempotente
select throws_ok($$ select app.svc_publish_plan(pg_temp.plan(jsonb_build_object('capabilities', pg_temp.caps('{"modules": ["fiscal"]}')))) $$,
  'PT400', 'VALIDATION_ERROR', 'módulo guardado não entra em plano');
select throws_ok($$ select app.svc_publish_plan(pg_temp.plan(jsonb_build_object('capabilities', pg_temp.caps('{"modules": ["sales", "sales"]}')))) $$,
  'PT400', 'VALIDATION_ERROR', 'módulo repetido é recusado');
select throws_ok($$ select app.svc_publish_plan(pg_temp.plan(jsonb_build_object('capabilities', pg_temp.caps('{"customers_max": -1}')))) $$,
  'PT400', 'VALIDATION_ERROR', 'limite negativo é recusado');
select throws_ok($$ select app.svc_publish_plan(pg_temp.plan(jsonb_build_object('capabilities', pg_temp.caps('{"bookings_month": 2.5}')))) $$,
  'PT400', 'VALIDATION_ERROR', 'limite fracionário é recusado');
select throws_ok($$ select app.svc_publish_plan(pg_temp.plan(jsonb_build_object('capabilities', pg_temp.caps('{"ilimitado": true}')))) $$,
  'PT400', 'VALIDATION_ERROR', 'chave desconhecida é recusada (nada de "ilimitado")');
select throws_ok($$ select app.svc_publish_plan(pg_temp.plan(jsonb_build_object('capabilities', pg_temp.caps('{}') - 'reminders_month'))) $$,
  'PT400', 'VALIDATION_ERROR', 'capacidade faltando é recusada');
select throws_ok($$ select app.svc_publish_plan(pg_temp.plan(jsonb_build_object('terms',
  pg_temp.plan('{}')->'terms' || '{"available_from": "2027-01-01T00:00:00Z", "available_until": "2026-01-01T00:00:00Z"}'))) $$,
  'PT400', 'VALIDATION_ERROR', 'janela de adesão invertida é recusada');
select lives_ok($$ select app.svc_publish_plan(pg_temp.plan('{}')) $$, 'plano válido é publicado');
select is((app.svc_publish_plan(pg_temp.plan('{"a_confirmar_pelo_felipe": ["price_cents"]}'))).version_no, 1,
  'mesmo conteúdo não cria versão nova (a lista de pendências não entra no compromisso)');
select is((app.svc_publish_plan(pg_temp.plan(jsonb_build_object('capabilities', pg_temp.caps('{"customers_max": 11}'))))).version_no, 2,
  'capacidade diferente cria versão nova');
select throws_ok($$ update public.offering_versions set capabilities = null where scope_hash = (pg_temp.latest('free')).scope_hash $$,
  'PT403', 'FORBIDDEN', 'versão publicada é imutável');
select throws_ok($$ insert into public.offering_versions (offering_id, version_no, name, description, price_cents, billing,
    agent_questions_month, scope_hash, capabilities, terms)
  select (pg_temp.latest('free')).offering_id, 99, 'x', 'x', 0, 'monthly', 1, repeat('a', 64), pg_temp.caps('{}'), null $$,
  '23514', null, 'capacidades e condições vêm juntas');

-- ------------------------------------------------------------------ leitura e compromisso histórico
-- Assinatura antiga na versão 2 do Completo (antes das capacidades), registrada como o P15 registrava.
insert into public.subscriptions (tenant_id, offering_version_id, price_cents, scope_hash)
select (select tenant_a from ids), v.id, v.price_cents, v.scope_hash from public.offering_versions v
join public.platform_offerings o on o.id = v.offering_id where o.code = 'founder' and v.version_no = 2;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
create temp table cur as select public.service_plan_current((select tenant_a from ids)) as v;
select is((select v->'plan'->>'version_no' from cur), '2', 'quem assinou antes continua na versão que aceitou');
select is((select v->'plan'->'capabilities' from cur), 'null'::jsonb, 'versão antiga não ganha capacidades novas');
select is((select v->>'plan_is_latest' from cur), 'false', 'a tela sabe que existe versão mais nova');
select ok((select bool_and(c ? 'capabilities' and c ? 'terms') from cur, jsonb_array_elements(v->'catalog') c
  where c->>'kind' = 'plan'), 'o catálogo mostra capacidades e condições de cada plano');
reset role;

select * from finish();
rollback;

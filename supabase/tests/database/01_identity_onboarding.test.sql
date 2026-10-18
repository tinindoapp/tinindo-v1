-- P01 · business.create e onboarding: atomicidade, idempotência, isolamento A/B e negações.
-- Roda depois das migrations da fundação + 001_identity_onboarding.sql + seed sintético.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;
create temp table got (label text primary key, body jsonb);
grant select, insert on got to authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ------------------------------------------------------------------ estrutura e privilégios
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('tenant_onboarding', 'policy_acceptances')),
  'RLS ligada nas tabelas do P01'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'nenhuma tabela pública sem RLS'
);
select ok(not has_function_privilege('anon', 'public.business_create(text, text, text, text[], text, text)', 'execute'),
  'anon não cria negócio');
select ok(not has_function_privilege('anon',
  'public.onboarding_save(uuid, integer, text, integer, integer, boolean, text, text)', 'execute'),
  'anon não salva onboarding');
select ok(not has_function_privilege('authenticated', 'app.uuid_from_text(text)', 'execute'),
  'utilitário interno não exposto');
select ok(not has_table_privilege('authenticated', 'public.tenant_onboarding', 'insert')
  and not has_table_privilege('authenticated', 'public.tenant_onboarding', 'update'),
  'onboarding só muda por RPC');
select is(
  (select count(*)::int from public.tenants t where not exists
     (select 1 from public.tenant_onboarding o where o.tenant_id = t.id)
     and t.created_at < (select min(o.created_at) from public.tenant_onboarding o)),
  0, 'negócios anteriores à proposta ganham onboarding vazio (backfill)'
);
select is(app.uuid_from_text('x'), app.uuid_from_text('x'), 'id derivado é determinístico');
select matches(app.uuid_from_text('qualquer')::text,
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'id derivado tem formato v4');

-- ------------------------------------------------------------------ sem login
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok(
  $$ select public.business_create('X', 'barber', 'America/Sao_Paulo', array['termos-piloto-v0'],
       'chave-sem-login-000001', repeat('a', 64)) $$,
  'PT401', 'AUTH_REQUIRED', 'criar negócio exige login'
);
reset role;

-- ------------------------------------------------------------------ outsider cria o primeiro negócio
select pg_temp.login_as((select outsider from ids));
set local role authenticated;

insert into got select 'c1', public.business_create('  Salão Exemplo C  ', 'hairdresser', 'America/Sao_Paulo',
  array['termos-piloto-v0', 'privacidade-piloto-v0', 'termos-piloto-v0'], 'chave-criacao-0000000001', repeat('c', 64));

select is((select body ->> 'status_code' from got where label = 'c1'), '201', 'criação responde 201');
select is((select body #>> '{body,tenant,name}' from got where label = 'c1'), 'Salão Exemplo C', 'nome sem espaços nas pontas');
select is((select body #>> '{body,tenant,currency}' from got where label = 'c1'), 'BRL', 'moeda BRL');
select results_eq(
  $$ select id::text, profession from public.tenants $$,
  $$ select body #>> '{body,tenant,id}', 'hairdresser'::text from got where label = 'c1' $$,
  'dono novo enxerga só o próprio negócio'
);
select results_eq(
  $$ select role from public.tenant_memberships $$,
  $$ values ('owner'::text) $$,
  'membership de dono criada'
);
select results_eq(
  $$ select id::text from public.resources $$,
  $$ select body #>> '{body,resource_id}' from got where label = 'c1' $$,
  'recurso inicial criado e devolvido'
);
select is((select count(*)::int from public.tenant_onboarding), 1, 'onboarding vazio criado');
select is((select count(*)::int from public.policy_acceptances), 2, 'aceites gravados sem duplicar versão');
select is(
  (select role from public.resolve_context(((select body #>> '{body,tenant,id}' from got where label = 'c1'))::uuid)),
  'owner', 'contexto ativo resolve o novo negócio'
);

-- repetição com a mesma chave e o mesmo hash
insert into got select 'c1-replay', public.business_create('  Salão Exemplo C  ', 'hairdresser', 'America/Sao_Paulo',
  array['termos-piloto-v0', 'privacidade-piloto-v0', 'termos-piloto-v0'], 'chave-criacao-0000000001', repeat('c', 64));
select is(
  (select body from got where label = 'c1-replay'),
  (select body from got where label = 'c1'),
  'repetição devolve a resposta original'
);
select is((select count(*)::int from public.tenants), 1, 'repetição não cria segundo negócio');
select throws_ok(
  $$ select public.business_create('Outro nome', 'hairdresser', 'America/Sao_Paulo', array['termos-piloto-v0'],
       'chave-criacao-0000000001', repeat('d', 64)) $$,
  'PT409', 'IDEMPOTENCY_MISMATCH', 'mesma chave com outro payload → 409'
);

-- validações (nada fica gravado)
select throws_ok(
  $$ select public.business_create('X', 'dentist', 'America/Sao_Paulo', array['termos-piloto-v0'],
       'chave-invalida-00000001', repeat('e', 64)) $$,
  '23514', null, 'profissão fora da lista é rejeitada'
);
select throws_ok(
  $$ select public.business_create('X', 'barber', 'Marte/Base', array['termos-piloto-v0'],
       'chave-invalida-00000002', repeat('e', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'timezone inválido é rejeitado'
);
select throws_ok(
  $$ select public.business_create('X', 'barber', 'America/Sao_Paulo', array[]::text[],
       'chave-invalida-00000003', repeat('e', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'sem aceite de política não cria'
);
select throws_ok(
  $$ select public.business_create('X', 'barber', 'America/Sao_Paulo', array['Termos com espaço'],
       'chave-invalida-00000004', repeat('e', 64)) $$,
  '23514', null, 'versão de política malformada é rejeitada'
);
select is((select count(*)::int from public.tenants), 1, 'falhas não deixam negócio parcial (atomicidade)');
select is(
  (select count(*)::int from public.resources r where r.tenant_id not in (select t.id from public.tenants t)),
  0, 'nenhum recurso órfão visível'
);

-- limite de negócios por dono
select public.business_create('Negócio 2', 'other', 'America/Sao_Paulo', array['termos-piloto-v0'],
  'chave-criacao-0000000002', repeat('f', 64));
select public.business_create('Negócio 3', 'other', 'America/Manaus', array['termos-piloto-v0'],
  'chave-criacao-0000000003', repeat('f', 64));
select throws_ok(
  $$ select public.business_create('Negócio 4', 'other', 'America/Sao_Paulo', array['termos-piloto-v0'],
       'chave-criacao-0000000004', repeat('f', 64)) $$,
  'PT429', 'QUOTA_EXCEEDED', 'mais de 3 negócios por dono → 429'
);
reset role;

-- quem perdeu o acesso não relê a resposta guardada
update public.tenants set status = 'closed'
where id = (select t.id from public.tenants t where t.name = 'Negócio 3');
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select throws_ok(
  $$ select public.business_create('Negócio 3', 'other', 'America/Manaus', array['termos-piloto-v0'],
       'chave-criacao-0000000003', repeat('f', 64)) $$,
  'PT403', 'FORBIDDEN', 'repetição revalida acesso: negócio encerrado não devolve o resultado'
);
reset role;

-- ------------------------------------------------------------------ dono A: isolamento e repetição alheia
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is_empty(
  $$ select 1 from public.tenant_onboarding o where o.tenant_id <> (select tenant_a from ids) $$,
  'dono A não lê onboarding de outro negócio'
);
select is_empty(
  $$ select 1 from public.policy_acceptances $$,
  'dono A não lê aceites de outros'
);
-- A mesma chave usada por outro ator gera outro tenant (escopo inclui o ator).
insert into got select 'a-same-key', public.business_create('Segundo de A', 'barber', 'America/Sao_Paulo',
  array['termos-piloto-v0'], 'chave-criacao-0000000001', repeat('c', 64));
select isnt(
  (select body #>> '{body,tenant,id}' from got where label = 'a-same-key'),
  (select body #>> '{body,tenant,id}' from got where label = 'c1'),
  'mesma chave de outro ator não relê o negócio alheio'
);

-- onboarding.save
select throws_ok(
  $$ select public.onboarding_save((select tenant_b from ids), 1, 'fill_schedule', 2, null, false,
       'chave-onboarding-000001', repeat('1', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono A não salva onboarding de B'
);
select throws_ok(
  $$ select public.onboarding_save((select tenant_a from ids), 1, null, null, null, true,
       'chave-onboarding-000002', repeat('2', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'concluir exige objetivo e política'
);
insert into got select 'o1', public.onboarding_save((select tenant_a from ids), 1, 'fill_schedule', 2, 5000, true,
  'chave-onboarding-000003', repeat('3', 64));
select is((select body #>> '{body,onboarding,version}' from got where label = 'o1'), '2', 'onboarding salvo, versão 2');
select isnt((select body #>> '{body,onboarding,completed_at}' from got where label = 'o1'), null, 'onboarding concluído');
select is(
  public.onboarding_save((select tenant_a from ids), 1, 'fill_schedule', 2, 5000, true,
    'chave-onboarding-000003', repeat('3', 64)),
  (select body from got where label = 'o1'),
  'repetição do onboarding devolve a resposta original'
);
select throws_ok(
  $$ select public.onboarding_save((select tenant_a from ids), 1, 'organize_clients', 24, null, false,
       'chave-onboarding-000004', repeat('4', 64)) $$,
  'PT409', 'STALE_VERSION', 'versão antiga → 409 STALE_VERSION'
);
select throws_ok(
  $$ select public.onboarding_save((select tenant_a from ids), 2, 'organize_clients', 500, null, false,
       'chave-onboarding-000005', repeat('5', 64)) $$,
  '23514', null, 'antecedência acima de 168h é rejeitada'
);
insert into got select 'o2', public.onboarding_save((select tenant_a from ids), 2, 'organize_clients', 24, null, false,
  'chave-onboarding-000006', repeat('6', 64));
select is(
  (select body #>> '{body,onboarding,completed_at}' from got where label = 'o2'),
  (select body #>> '{body,onboarding,completed_at}' from got where label = 'o1'),
  'editar depois não "desconclui" o onboarding'
);
reset role;

-- ------------------------------------------------------------------ cliente sem membership
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select is_empty('select 1 from public.tenant_onboarding', 'cliente não lê onboarding de negócios');
select throws_ok(
  $$ select public.onboarding_save((select tenant_a from ids), 3, 'fill_schedule', 2, null, false,
       'chave-onboarding-000007', repeat('7', 64)) $$,
  'PT403', 'FORBIDDEN', 'cliente não altera onboarding'
);
reset role;

-- ------------------------------------------------------------------ auditoria e aceite append-only
select ok(
  exists (select 1 from public.audit_events where action = 'business.created'),
  'criação auditada'
);
select throws_ok('delete from public.policy_acceptances', 'PT403', 'FORBIDDEN', 'aceites são append-only');

select * from finish();
rollback;

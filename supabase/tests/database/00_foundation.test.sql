-- P00 · Fundação: isolamento por tenant (base de SEC-01/SEC-03), autorização do contexto,
-- idempotência, outbox e auditoria append-only. Roda contra banco com seed sintético.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Atalhos de identidade (ver fixtures.ts)
create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ------------------------------------------------------------------ estrutura
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in
   ('tenants', 'tenant_memberships', 'resources', 'idempotency_records', 'outbox_events', 'audit_events')),
  'RLS habilitada em todas as tabelas da fundação'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'nenhuma tabela pública sem RLS'
);
select ok(
  not has_function_privilege('anon', 'public.resolve_context(uuid)', 'execute'),
  'anon não executa resolve_context'
);
select ok(
  not has_function_privilege('authenticated', 'app.idempotency_claim(uuid, uuid, text, text, text)', 'execute'),
  'authenticated não executa funções internas de idempotência'
);
select ok(
  not has_function_privilege('authenticated', 'app.emit_event(uuid, text, uuid, integer, uuid, jsonb)', 'execute'),
  'authenticated não emite eventos direto'
);

-- ------------------------------------------------------------------ anon
set local role anon;
select throws_ok('select * from public.tenants', '42501', null, 'anon não lê tenants');
select throws_ok('select * from public.resources', '42501', null, 'anon não lê resources');
reset role;

-- ------------------------------------------------------------------ dono A
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;

select results_eq(
  'select id from public.tenants',
  $$ select tenant_a from ids $$,
  'dono A vê apenas o tenant A'
);
select is_empty(
  $$ select 1 from public.tenants where id = (select tenant_b from ids) $$,
  'dono A não encontra tenant B nem por ID'
);
select is(
  (select count(*)::int from public.tenant_memberships),
  1,
  'dono A vê só a própria membership'
);
select is(
  (select count(*)::int from public.resources),
  1,
  'dono A vê só o recurso de A'
);
select throws_ok(
  $$ insert into public.tenants (name, profession) values ('Intruso', 'other') $$,
  '42501', null, 'dono não cria tenant por INSERT direto'
);
select throws_ok(
  $$ update public.tenants set name = 'Outro' $$,
  '42501', null, 'dono não altera tenant por UPDATE direto'
);
select throws_ok(
  $$ insert into public.tenant_memberships (tenant_id, user_id, role)
     values ((select tenant_b from ids), (select owner_a from ids), 'owner') $$,
  '42501', null, 'dono A não se adiciona ao tenant B'
);
select throws_ok('select * from public.idempotency_records', '42501', null, 'idempotência é backend-only');
select throws_ok('select * from public.outbox_events', '42501', null, 'outbox é backend-only');

select results_eq(
  $$ select role, tenant_name from public.resolve_context((select tenant_a from ids)) $$,
  $$ values ('owner'::text, 'Barbearia Exemplo A'::text) $$,
  'resolve_context autoriza dono A no tenant A'
);
select throws_ok(
  $$ select * from public.resolve_context((select tenant_b from ids)) $$,
  'PT403', 'FORBIDDEN', 'resolve_context nega dono A no tenant B'
);
select throws_ok(
  $$ select * from public.resolve_context('99999999-0000-4000-8000-000000000000') $$,
  'PT403', 'FORBIDDEN', 'tenant inexistente responde igual a sem acesso'
);
reset role;

-- ------------------------------------------------------------------ outros atores
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select is_empty('select 1 from public.tenants', 'cliente sem membership não lê negócios');
select throws_ok(
  $$ select * from public.resolve_context((select tenant_a from ids)) $$,
  'PT403', 'FORBIDDEN', 'cliente não obtém contexto de dono'
);
reset role;

select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select is_empty('select 1 from public.resources', 'usuário sem vínculo não lê recursos');
reset role;

select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok(
  $$ select * from public.resolve_context((select tenant_a from ids)) $$,
  'PT401', 'AUTH_REQUIRED', 'sem sub no JWT exige login'
);
reset role;

-- ------------------------------------------------------------------ invariantes (superusuário)
select throws_ok(
  $$ insert into public.resources (tenant_id, name) values ((select tenant_a from ids), 'Segundo') $$,
  '23505', null, 'piloto: um recurso ativo por negócio'
);
select throws_ok(
  $$ insert into public.tenants (name, profession, timezone) values ('X', 'other', 'Marte/Base_Alfa') $$,
  'PT400', 'VALIDATION_ERROR', 'timezone inválido é rejeitado'
);
select throws_ok(
  $$ insert into public.tenants (name, profession, currency) values ('X', 'other', 'USD') $$,
  '23514', null, 'moeda diferente de BRL é rejeitada'
);
update public.tenants set name = 'Barbearia Exemplo A' where id = (select tenant_a from ids);
select is(
  (select version from public.tenants where id = (select tenant_a from ids)),
  2,
  'UPDATE incrementa version (concorrência otimista)'
);

-- ------------------------------------------------------------------ idempotência
select is(
  app.idempotency_claim((select tenant_a from ids), (select owner_a from ids), 'booking.create',
    'chave-teste-0000000001', repeat('a', 64)),
  null,
  'primeira chamada segue para a mutação'
);
select app.idempotency_complete((select tenant_a from ids), (select owner_a from ids), 'booking.create',
  'chave-teste-0000000001', 201, '{"data":{"ok":true}}'::jsonb);
select is(
  app.idempotency_claim((select tenant_a from ids), (select owner_a from ids), 'booking.create',
    'chave-teste-0000000001', repeat('a', 64)),
  '{"status_code":201,"body":{"data":{"ok":true}}}'::jsonb,
  'repetição com mesmo payload devolve a resposta original'
);
select throws_ok(
  $$ select app.idempotency_claim((select tenant_a from ids), (select owner_a from ids), 'booking.create',
       'chave-teste-0000000001', repeat('b', 64)) $$,
  'PT409', 'IDEMPOTENCY_MISMATCH', 'mesma chave com payload diferente → 409'
);

-- ------------------------------------------------------------------ outbox e auditoria
select isnt(
  app.emit_event((select tenant_a from ids), 'booking.confirmed.v1',
    '60000000-0000-4000-8000-000000000001', 1, gen_random_uuid(), '{"booking_id":"60000000-0000-4000-8000-000000000001"}'),
  null,
  'evento entra no outbox'
);
select app.audit((select tenant_a from ids), 'tenant.renamed', 'tenant', (select tenant_a from ids));
select throws_ok(
  'update public.audit_events set action = $$x$$',
  'PT403', 'FORBIDDEN', 'auditoria não aceita UPDATE'
);
select throws_ok(
  'delete from public.audit_events',
  'PT403', 'FORBIDDEN', 'auditoria não aceita DELETE'
);

select * from finish();
rollback;

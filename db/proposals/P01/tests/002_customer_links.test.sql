-- P01 · Vínculo cliente ↔ login: comprovação por código, cliente multi-profissional sem vazamento,
-- uso único, expiração, idempotência e negações. Usa o stub de customers (000_stub_p02_customers.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ab_in_a,
  '30000000-0000-4000-8000-0000000000b1'::uuid as ab_in_b,
  '30000000-0000-4000-8000-0000000000a2'::uuid as guest_in_a;
grant select on ids to anon, authenticated;
create temp table got (label text primary key, body jsonb);
grant select, insert on got to authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Cadastros das fixtures: a mesma pessoa tem registros DIFERENTES em A e B, com o mesmo telefone.
insert into public.customers (id, tenant_id, name, phone) values
  ((select ab_in_a from ids), (select tenant_a from ids), 'Cliente AB em A', '+5511900000001'),
  ((select ab_in_b from ids), (select tenant_b from ids), 'Cliente AB em B', '+5511900000001'),
  ((select guest_in_a from ids), (select tenant_a from ids), 'Convidado sem login', null);

-- ------------------------------------------------------------------ estrutura
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('customer_links', 'customer_link_invites')),
  'RLS ligada nas tabelas de vínculo'
);
select ok(not has_table_privilege('authenticated', 'public.customer_link_invites', 'select'),
  'códigos são backend-only');
select ok(not has_table_privilege('authenticated', 'public.customer_links', 'insert'),
  'vínculo só nasce por RPC');
select ok(not has_function_privilege('anon', 'public.customer_link_redeem(text, text, text)', 'execute'),
  'anon não resgata código');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'nenhuma tabela pública sem RLS'
);

-- ------------------------------------------------------------------ dono A emite código
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(
  $$ select public.customer_link_issue((select tenant_b from ids), (select ab_in_b from ids),
       'chave-issue-0000000001', repeat('1', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono A não emite código em B'
);
select throws_ok(
  $$ select public.customer_link_issue((select tenant_a from ids), (select ab_in_b from ids),
       'chave-issue-0000000002', repeat('2', 64)) $$,
  'PT404', 'NOT_FOUND', 'cadastro de B não serve para código de A (FK composta/escopo)'
);
insert into got select 'issue-a', public.customer_link_issue((select tenant_a from ids), (select ab_in_a from ids),
  'chave-issue-0000000003', repeat('3', 64));
select matches((select body #>> '{body,code}' from got where label = 'issue-a'), '^[A-Za-z0-9_-]{43}$',
  'código de 256 bits em base64url');
select is((select body ->> 'status_code' from got where label = 'issue-a'), '201', 'emissão responde 201');
insert into got select 'issue-a-replay', public.customer_link_issue((select tenant_a from ids), (select ab_in_a from ids),
  'chave-issue-0000000003', repeat('3', 64));
select is((select body #>> '{body,invite_id}' from got where label = 'issue-a-replay'),
  (select body #>> '{body,invite_id}' from got where label = 'issue-a'), 'repetição devolve o mesmo convite');
select is((select body #> '{body,code}' from got where label = 'issue-a-replay'), 'null'::jsonb,
  'repetição não devolve o código (só o hash fica guardado)');
-- Código para o convidado, que depois será substituído (só o último vale).
insert into got select 'issue-guest-old', public.customer_link_issue((select tenant_a from ids), (select guest_in_a from ids),
  'chave-issue-0000000004', repeat('4', 64));
insert into got select 'issue-guest-new', public.customer_link_issue((select tenant_a from ids), (select guest_in_a from ids),
  'chave-issue-0000000005', repeat('5', 64));
reset role;

select is(
  (select token_hash from public.customer_link_invites where id = ((select body #>> '{body,invite_id}' from got where label = 'issue-a'))::uuid),
  app.token_sha256((select body #>> '{body,code}' from got where label = 'issue-a')),
  'banco guarda só o sha256 do código'
);
select is_empty(
  $$ select 1 from public.idempotency_records where response::text like '%' || (select body #>> '{body,code}' from got where label = 'issue-a') || '%' $$,
  'código não aparece no registro de idempotência'
);

-- ------------------------------------------------------------------ dono B emite código para o cadastro dele
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
insert into got select 'issue-b', public.customer_link_issue((select tenant_b from ids), (select ab_in_b from ids),
  'chave-issue-0000000006', repeat('6', 64));
reset role;

-- ------------------------------------------------------------------ resgate
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok(
  format($$ select public.customer_link_redeem(%L, 'chave-redeem-0000000001', repeat('a', 64)) $$,
    (select body #>> '{body,code}' from got where label = 'issue-a')),
  'PT401', 'AUTH_REQUIRED', 'resgate exige login'
);
reset role;

select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select throws_ok(
  $$ select public.customer_link_redeem('codigo-inventado-que-nao-existe-00000000000', 'chave-redeem-0000000002', repeat('b', 64)) $$,
  'PT404', 'NOT_FOUND', 'código inexistente → 404 neutro'
);
insert into got select 'redeem-a', public.customer_link_redeem((select body #>> '{body,code}' from got where label = 'issue-a'),
  'chave-redeem-0000000003', repeat('c', 64));
select is((select body #>> '{body,tenant_name}' from got where label = 'redeem-a'), 'Barbearia Exemplo A',
  'resgate devolve o negócio');
select ok(not ((select body -> 'body' from got where label = 'redeem-a') ?| array['name', 'phone', 'email', 'customer_id']),
  'resgate não devolve dados do CRM');
select is(
  public.customer_link_redeem((select body #>> '{body,code}' from got where label = 'issue-a'),
    'chave-redeem-0000000003', repeat('c', 64)),
  (select body from got where label = 'redeem-a'),
  'repetição do resgate devolve a resposta original'
);
select throws_ok(
  format($$ select public.customer_link_redeem(%L, 'chave-redeem-0000000004', repeat('d', 64)) $$,
    (select body #>> '{body,code}' from got where label = 'issue-a')),
  'PT404', 'NOT_FOUND', 'código usado não vale de novo'
);
select throws_ok(
  format($$ select public.customer_link_redeem(%L, 'chave-redeem-0000000005', repeat('e', 64)) $$,
    (select body #>> '{body,code}' from got where label = 'issue-guest-old')),
  'PT404', 'NOT_FOUND', 'código substituído não vale'
);
select throws_ok(
  format($$ select public.customer_link_redeem(%L, 'chave-redeem-0000000006', repeat('f', 64)) $$,
    (select body #>> '{body,code}' from got where label = 'issue-guest-new')),
  'PT422', 'POLICY_REJECTED', 'um login não se liga a dois cadastros no mesmo negócio'
);
insert into got select 'redeem-b', public.customer_link_redeem((select body #>> '{body,code}' from got where label = 'issue-b'),
  'chave-redeem-0000000007', repeat('7', 64));

-- cliente multi-profissional: vê os dois vínculos e nada além
select results_eq(
  $$ select tenant_name from public.my_customer_links() $$,
  $$ values ('Barbearia Exemplo A'::text), ('Personal Exemplo B'::text) $$,
  'cliente vê só os próprios vínculos, um por negócio'
);
select is(app.linked_customer_id((select tenant_a from ids)), (select ab_in_a from ids), 'em A, o cadastro de A');
select is(app.linked_customer_id((select tenant_b from ids)), (select ab_in_b from ids), 'em B, o cadastro de B');
select is_empty('select 1 from public.customers', 'cliente vinculado não lê o CRM de nenhum negócio');
select is_empty('select 1 from public.tenants', 'cliente vinculado não vira membro');
select is((select count(*)::int from public.customer_links), 2, 'cliente lê só as próprias linhas de vínculo');
reset role;

-- ------------------------------------------------------------------ donos: isolamento
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select results_eq(
  $$ select customer_id from public.customer_links $$,
  $$ select ab_in_a from ids $$,
  'dono A vê só os vínculos de A'
);
select throws_ok(
  $$ select public.customer_link_issue((select tenant_a from ids), (select ab_in_a from ids),
       'chave-issue-0000000008', repeat('8', 64)) $$,
  'PT422', 'POLICY_REJECTED', 'cadastro já vinculado não recebe novo código'
);
reset role;

-- outsider tenta código vencido
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into got select 'issue-exp', public.customer_link_issue((select tenant_a from ids), (select guest_in_a from ids),
  'chave-issue-0000000009', repeat('9', 64));
reset role;
update public.customer_link_invites set created_at = now() - interval '4 days', expires_at = now() - interval '1 day'
where id = ((select body #>> '{body,invite_id}' from got where label = 'issue-exp'))::uuid;
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select throws_ok(
  format($$ select public.customer_link_redeem(%L, 'chave-redeem-0000000010', repeat('a', 64)) $$,
    (select body #>> '{body,code}' from got where label = 'issue-exp')),
  'PT404', 'NOT_FOUND', 'código vencido → 404 neutro'
);
select is(app.linked_customer_id((select tenant_a from ids)), null, 'sem vínculo, sem cadastro');
reset role;

-- dono não se vincula como cliente do próprio negócio
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into got select 'issue-self', public.customer_link_issue((select tenant_a from ids), (select guest_in_a from ids),
  'chave-issue-0000000011', repeat('b', 64));
select throws_ok(
  format($$ select public.customer_link_redeem(%L, 'chave-redeem-0000000012', repeat('b', 64)) $$,
    (select body #>> '{body,code}' from got where label = 'issue-self')),
  'PT422', 'POLICY_REJECTED', 'dono não resgata código do próprio negócio'
);
reset role;

-- ------------------------------------------------------------------ revogação
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select throws_ok(
  format($$ select public.customer_link_revoke((select tenant_a from ids), %L::uuid, 1, 'chave-revoke-0000000001', repeat('1', 64)) $$,
    (select body #>> '{body,link_id}' from got where label = 'redeem-a')),
  'PT404', 'NOT_FOUND', 'terceiro não revoga vínculo alheio'
);
reset role;
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select throws_ok(
  format($$ select public.customer_link_revoke((select tenant_a from ids), %L::uuid, 9, 'chave-revoke-0000000002', repeat('2', 64)) $$,
    (select body #>> '{body,link_id}' from got where label = 'redeem-a')),
  'PT409', 'STALE_VERSION', 'revogar com versão antiga → 409'
);
select is(
  (public.customer_link_revoke((select tenant_a from ids), ((select body #>> '{body,link_id}' from got where label = 'redeem-a'))::uuid,
    1, 'chave-revoke-0000000003', repeat('3', 64)) ->> 'status_code'),
  '200', 'cliente se desvincula'
);
select is(app.linked_customer_id((select tenant_a from ids)), null, 'vínculo revogado deixa de valer');
select throws_ok(
  format($$ select public.customer_link_redeem(%L, 'chave-redeem-0000000003', repeat('c', 64)) $$,
    (select body #>> '{body,code}' from got where label = 'issue-a')),
  'PT403', 'FORBIDDEN', 'repetição após revogação não relê o resultado'
);
reset role;

select * from finish();
rollback;

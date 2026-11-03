-- Recado #89, pedido 3: o dono pede a verificação de identidade pelo app. Um pedido aberto por negócio, idempotente,
-- isolado por negócio, sem documento; já verificado → POLICY_REJECTED; ao verificar (backend), o pedido fecha.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;
create temp table got (k text primary key, v jsonb);
grant select, insert, update on got to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select ok(not has_function_privilege('anon', 'public.identity_request(uuid, text, text, text, uuid)', 'execute'), 'anon não pede');
select ok(not has_table_privilege('authenticated', 'public.identity_verification_requests', 'select'), 'pedidos fora da Data API');

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(public.review_owner_list((select tenant_a from ids)) -> 'identity_request', 'null'::jsonb, 'sem pedido: null');
select throws_ok($$ select public.identity_request((select tenant_a from ids), 'selfie', 'idr-000000000001', repeat('a', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'meio fora da lista é recusado');
insert into got values ('r1', public.identity_request((select tenant_a from ids), 'gov_br', 'idr-000000000002', repeat('b', 64)));
select is((select v -> 'body' -> 'identity_request' ->> 'preferred_method' from got where k = 'r1'), 'gov_br', 'pedido aberto com o meio escolhido');
select is(public.identity_request((select tenant_a from ids), 'gov_br', 'idr-000000000002', repeat('b', 64)),
  (select v from got where k = 'r1'), 'mesma chave: mesma resposta');
insert into got values ('r2', public.identity_request((select tenant_a from ids), 'document_video_call', 'idr-000000000003', repeat('c', 64)));
select is((select v -> 'body' -> 'identity_request' from got where k = 'r2'), (select v -> 'body' -> 'identity_request' from got where k = 'r1'),
  'pedir de novo devolve o mesmo pedido aberto, sem trocar o meio');
select is(public.review_owner_list((select tenant_a from ids)) -> 'identity_request', (select v -> 'body' -> 'identity_request' from got where k = 'r1'),
  'a lista do dono mostra o pedido aberto');
select throws_ok($$ select public.identity_request((select tenant_b from ids), 'gov_br', 'idr-000000000004', repeat('d', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono de A não pede por B');
reset role;

select is((select count(*)::int from public.audit_events a where a.tenant_id = (select tenant_a from ids) and a.action = 'identity.request'),
  1, 'auditoria registra o pedido uma vez');

-- Equipe verifica pelo backend: o pedido fecha.
select lives_ok($$ select public.identity_verify_set((select tenant_a from ids), 'verify', 'gov_br', 'Equipe Tinindo') $$, 'equipe verifica');
select is((select status from public.identity_verification_requests where tenant_id = (select tenant_a from ids)), 'done', 'pedido atendido fecha');

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok($$ select public.identity_request((select tenant_a from ids), 'gov_br', 'idr-000000000005', repeat('e', 64)) $$,
  'PT422', 'POLICY_REJECTED', 'já verificado: não pede de novo');
reset role;

select * from finish();
rollback;

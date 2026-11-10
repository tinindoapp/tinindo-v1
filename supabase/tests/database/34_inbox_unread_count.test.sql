-- Recado #89, pedido 2: inbox.unread_count soma as não lidas do negócio, só para o dono, sem dados do contato.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select ok(not has_function_privilege('anon', 'public.channel_unread_count(uuid)', 'execute'), 'anon não chama');
select ok(has_function_privilege('authenticated', 'public.channel_unread_count(uuid)', 'execute'), 'authenticated chama');

-- Sem canal: zero, não erro.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(public.channel_unread_count((select tenant_a from ids)), '{"unread": 0, "contacts": 0}'::jsonb, 'sem contatos: zero');
reset role;

with c as (
  insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
  values ((select tenant_a from ids), 'simulated', '+5511944445555', '+5511944445555', 'active', now()) returning id
)
insert into public.channel_contacts (tenant_id, connection_id, phone_e164, unread_count)
select (select tenant_a from ids), c.id, v.phone, v.n from c,
  (values ('+5511911110001', 3), ('+5511911110002', 0), ('+5511911110003', 2)) v(phone, n);

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(public.channel_unread_count((select tenant_a from ids)), '{"unread": 5, "contacts": 2}'::jsonb,
  'dono de A: 5 não lidas em 2 contatos (o contato sem não lidas não conta)');
select is((select array_agg(k order by k) from jsonb_object_keys(public.channel_unread_count((select tenant_a from ids))) k),
  array['contacts', 'unread'], 'só os dois números: sem nome, telefone nem texto');
select throws_ok($$ select public.channel_unread_count((select tenant_b from ids)) $$, 'PT403', 'FORBIDDEN',
  'dono de A não lê o contador de B');
reset role;

select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is(public.channel_unread_count((select tenant_b from ids)), '{"unread": 0, "contacts": 0}'::jsonb,
  'dono de B não vê as não lidas de A');
reset role;

select * from finish();
rollback;

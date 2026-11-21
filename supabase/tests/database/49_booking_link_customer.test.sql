-- Recado #160 (A11): atendimento sem cliente (pedido pelo link) passa a apontar para um cliente do negócio. Só o dono,
-- só uma vez, só cliente ativo do mesmo negócio, com versão e chave de idempotência.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as customer_a,
  '30000000-0000-4000-8000-0000000000a2'::uuid as customer_a2,
  '30000000-0000-4000-8000-0000000000b1'::uuid as customer_b,
  'c1600000-0000-4000-8000-000000000001'::uuid as booking,
  'c1600000-0000-4000-8000-000000000002'::uuid as booking2;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Dois atendimentos sem cliente, como os do link público (um com guest_ref), longe de tudo do seed.
insert into public.bookings (id, tenant_id, resource_id, customer_id, guest_ref, service_id, starts_at, ends_at,
  occupied_range, blocks_capacity, status, source)
select b.id, '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a', null, b.guest,
  '40000000-0000-4000-8000-0000000000a1', b.s, b.s + interval '30 minutes',
  tstzrange(b.s, b.s + interval '40 minutes', '[)'), true, 'completed', 'public_link'
from (values
  ('c1600000-0000-4000-8000-000000000001'::uuid, 'visitante-1', '2031-03-03 13:00:00+00'::timestamptz),
  ('c1600000-0000-4000-8000-000000000002'::uuid, null, '2031-03-03 15:00:00+00'::timestamptz)
) as b(id, guest, s);
update public.customers set archived_at = now() where id = (select customer_a2 from ids);

select ok(not has_function_privilege('anon', 'public.scheduling_booking_link_customer(uuid, uuid, integer, uuid, text, text, uuid)', 'execute'),
  'anon não liga cliente');

select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_booking_link_customer(%L, %L, 1, %L, 'chave-link-cliente-b-000000', repeat('a', 64)) $$,
  (select tenant_a from ids), (select booking from ids), (select customer_a from ids)), 'PT403', null, 'dono de outro negócio não liga');
reset role;

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_booking_link_customer(%L, %L, 1, %L, 'chave-link-cliente-x-000000', repeat('a', 64)) $$,
  (select tenant_a from ids), (select booking from ids), (select customer_b from ids)), 'PT404', null, 'cliente de outro negócio = inexistente');
select throws_ok(format($$ select public.scheduling_booking_link_customer(%L, %L, 1, %L, 'chave-link-cliente-arq-000000', repeat('a', 64)) $$,
  (select tenant_a from ids), (select booking from ids), (select customer_a2 from ids)), 'PT404', null, 'cliente arquivado não serve');
select throws_ok(format($$ select public.scheduling_booking_link_customer(%L, %L, 7, %L, 'chave-link-cliente-v-000000', repeat('a', 64)) $$,
  (select tenant_a from ids), (select booking from ids), (select customer_a from ids)), 'PT409', null, 'versão velha é recusada');

select is(
  public.scheduling_booking_link_customer((select tenant_a from ids), (select booking from ids), 1, (select customer_a from ids), 'chave-link-cliente-1-000000', repeat('a', 64))
    #>> '{body,booking,customer_id}',
  (select customer_a from ids)::text, 'liga o cliente e devolve o atendimento');
select is(
  public.scheduling_booking_link_customer((select tenant_a from ids), (select booking from ids), 1, (select customer_a from ids), 'chave-link-cliente-1-000000', repeat('a', 64))
    #>> '{body,booking,version}',
  '2', 'repetir com a mesma chave devolve a mesma resposta');
select throws_ok(format($$ select public.scheduling_booking_link_customer(%L, %L, 2, %L, 'chave-link-cliente-2-000000', repeat('a', 64)) $$,
  (select tenant_a from ids), (select booking from ids), (select customer_a from ids)), 'PT422', null, 'atendimento que já tem cliente não troca');
select is(
  public.scheduling_booking_link_customer((select tenant_a from ids), (select booking2 from ids), 1, (select customer_a from ids), 'chave-link-cliente-3-000000', repeat('a', 64))
    #>> '{body,booking,customer_id}',
  (select customer_a from ids)::text, 'atendimento sem guest_ref também liga');
reset role;

select is((select guest_ref from public.bookings where id = (select booking from ids)), null, 'a referência do visitante sai no lugar do cadastro');
select is((select count(*)::int from public.bookings where id = (select booking from ids) and customer_id = (select customer_a from ids) and version = 2),
  1, 'gravou o cliente e subiu a versão');
select is((select count(*)::int from public.audit_events where action = 'booking.link_customer' and object_id = (select booking from ids)),
  1, 'uma linha de auditoria, sem repetir no replay');

select * from finish();
rollback;

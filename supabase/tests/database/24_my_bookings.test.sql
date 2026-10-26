-- Minhas reservas: o cliente vinculado vê só as próprias reservas, nos dois negócios; projeção sem CRM; vínculo revogado,
-- negócio encerrado e reserva provisória vencida somem; anon não executa; dono sem vínculo não vê nada.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '20000000-0000-4000-8000-00000000000b'::uuid as res_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ab_in_a,
  '30000000-0000-4000-8000-0000000000a2'::uuid as guest_in_a,
  '30000000-0000-4000-8000-0000000000b1'::uuid as ab_in_b,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000b1'::uuid as sessao_b;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert on r to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Vínculos comprovados da cliente AB em A e em B (o fluxo por código é provado no 03).
insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at)
select tenant_a, ab_in_a, customer_ab, 'owner_invite_code', now() from ids
union all select tenant_b, ab_in_b, customer_ab, 'owner_invite_code', now() from ids;

-- Reservas: duas dela em A (uma concluída, uma cancelada com motivo), uma dela em B, uma de outro cliente em A e um
-- hold vencido dela em A.
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range,
  blocks_capacity, status, agreed_price_cents, source, status_reason, hold_expires_at)
select v.id::uuid, v.tenant, v.res, v.customer, v.service, v.s::timestamptz, v.e::timestamptz,
  tstzrange(v.s::timestamptz, v.e::timestamptz, '[)'), v.status in ('held', 'confirmed', 'completed'), v.status, v.price, 'owner', v.reason, v.hold
from ids, lateral (values
  ('6a000000-0000-4000-8000-000000000001', tenant_a, res_a, ab_in_a, corte_a, '2026-11-03 10:00-03', '2026-11-03 10:30-03', 'completed', 6000, null, null::timestamptz),
  ('6a000000-0000-4000-8000-000000000002', tenant_a, res_a, ab_in_a, corte_a, '2026-11-04 10:00-03', '2026-11-04 10:30-03', 'cancelled', 6000, 'Motivo privado do profissional', null),
  ('6a000000-0000-4000-8000-000000000003', tenant_b, res_b, ab_in_b, sessao_b, '2026-11-05 07:00-03', '2026-11-05 08:00-03', 'confirmed', 12000, null, null),
  ('6a000000-0000-4000-8000-000000000004', tenant_a, res_a, guest_in_a, corte_a, '2026-11-03 11:00-03', '2026-11-03 11:30-03', 'confirmed', 6000, null, null),
  ('6a000000-0000-4000-8000-000000000005', tenant_a, res_a, ab_in_a, corte_a, '2026-11-06 10:00-03', '2026-11-06 10:30-03', 'expired', null, null, null)
) as v(id, tenant, res, customer, service, s, e, status, price, reason, hold);

-- ------------------------------------------------------------------ estrutura
select ok(not has_function_privilege('anon', 'public.my_bookings()', 'execute'), 'anon não executa');
select ok(has_function_privilege('authenticated', 'public.my_bookings()', 'execute'), 'cliente logado executa');

-- ------------------------------------------------------------------ cliente vinculada
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
insert into r select 'ab', coalesce(jsonb_agg(to_jsonb(b) order by b.starts_at), '[]') from public.my_bookings() b;
select is((select jsonb_array_length(v) from r where k = 'ab'), 3, 'vê as três reservas dela (hold vencido fica de fora)');
select is((select count(distinct x->>'tenant_id')::int from r, jsonb_array_elements(v) x where k = 'ab'), 2, 'nos dois negócios');
select ok(not exists (select 1 from r, jsonb_array_elements(v) x where k = 'ab' and x->>'booking_id' = '6a000000-0000-4000-8000-000000000004'),
  'reserva de outro cliente não aparece');
select is((select array_agg(x->>'service_name' order by x->>'starts_at') from r, jsonb_array_elements(v) x where k = 'ab'),
  array['Corte', 'Corte', 'Sessão de treino'], 'nome do serviço vem do catálogo do negócio');
select ok((select v::text from r where k = 'ab') !~ '(Motivo privado|Visitante|cliente\.ab@|status_reason|customer_id)',
  'sem motivo, contatos, outros clientes ou ids do CRM');
select is((select x->>'timezone' from r, jsonb_array_elements(v) x where k = 'ab' limit 1), 'America/Sao_Paulo', 'fuso do negócio para exibir');
reset role;

-- ------------------------------------------------------------------ revogação e negócio encerrado
update public.customer_links set revoked_at = now() where tenant_id = (select tenant_b from ids) and user_id = (select customer_ab from ids);
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select is((select count(*)::int from public.my_bookings()), 2, 'vínculo revogado em B: reservas de B somem');
reset role;
update public.tenants set status = 'closed' where id = (select tenant_a from ids);
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select is((select count(*)::int from public.my_bookings()), 0, 'negócio encerrado: some da lista');
reset role;
update public.tenants set status = 'active' where id = (select tenant_a from ids);

-- ------------------------------------------------------------------ sem vínculo
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is((select count(*)::int from public.my_bookings()), 0, 'dono sem vínculo de cliente não vê reservas por aqui');
reset role;
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select is((select count(*)::int from public.my_bookings()), 0, 'login sem vínculo: lista vazia');
reset role;

select * from finish();
rollback;

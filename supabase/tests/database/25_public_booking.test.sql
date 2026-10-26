-- P43 · Reserva pelo link público: quem executa, que perfil aceita, canal obrigatório, visitante anônimo × cliente com
-- vínculo, limite por perfil, pedido sem dados de contato na resposta e na auditoria. A corrida pelo horário, as
-- repetições e as tentativas do código são provadas com conexões simultâneas em tests/db-concurrency/24_public_booking.sh.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ab_in_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000b1'::uuid as sessao_b,
  -- Segunda-feira da próxima semana, 10:00 em São Paulo.
  ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7) + time '10:00') at time zone 'America/Sao_Paulo' as monday_10;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- Expediente de segunda em A; perfil de A publicado com o link; perfil de B publicado SEM o link.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  '[{"weekday":1,"local_start":"09:00","local_end":"19:00"}]', 'chave-expediente-p43-001', repeat('e', 64));
reset role;
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
select tenant_a, 'barbearia-link-a', 'barber', 'Centro', array['display_name', 'booking_link'], now() from ids
union all select tenant_b, 'personal-sem-link-b', 'personal_trainer', 'Zona Sul', array['display_name'], now() from ids;

-- ------------------------------------------------------------------ estrutura
select ok(has_function_privilege('anon', 'public.public_booking_request(text, uuid, timestamptz, text, text, text, text, uuid)', 'execute'),
  'anon pede horário');
select ok(has_function_privilege('anon', 'public.public_booking_confirm(uuid, text, uuid)', 'execute'), 'anon confirma');
select ok(has_function_privilege('anon', 'public.public_booking_services(text)', 'execute'), 'anon lista serviços');
select ok(not has_table_privilege('anon', 'public.public_booking_requests', 'select')
  and not has_table_privilege('authenticated', 'public.public_booking_requests', 'select'),
  'pedidos (contato e código) sem acesso pela Data API');

-- ------------------------------------------------------------------ serviços
select pg_temp.as_anon();
set local role anon;
insert into r select 'svc', public.public_booking_services('barbearia-link-a');
select is((select jsonb_array_length(v->'services') from r where k = 'svc'), 2, 'serviços ativos do perfil com link');
select ok((select v::text from r where k = 'svc') !~ '(price|cents|floor|cost)', 'sem preço, piso nem custo');
select throws_ok($$ select public.public_booking_services('personal-sem-link-b') $$, 'PT404', 'NOT_FOUND',
  'perfil sem o link de reserva não aceita reserva');
select throws_ok($$ select public.public_booking_services('nao-existe') $$, 'PT404', 'NOT_FOUND', 'slug inexistente: mesma resposta');

-- ------------------------------------------------------------------ canal obrigatório e validação
select throws_ok($$ select public.public_booking_request('barbearia-link-a', (select corte_a from ids), (select monday_10 from ids),
    'Visitante', '+5511955550001', 'pedido-sem-canal-0001', repeat('a', 64)) $$,
  'PT422', 'POLICY_REJECTED', 'sem canal ativo no negócio não há como mandar o código');
reset role;
insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
select tenant_a, 'simulated', '+5511900000043', '+5511900000043', 'active', now() from ids;
select ok(not exists (select 1 from public.bookings where source = 'public_link' and starts_at = (select monday_10 from ids)),
  'a recusa não deixou horário segurado');
select pg_temp.as_anon();
set local role anon;
select throws_ok($$ select public.public_booking_request('barbearia-link-a', (select corte_a from ids), (select monday_10 from ids),
    'Visitante', '11955550001', 'pedido-tel-invalido-1', repeat('a', 64)) $$,
  'PT400', 'VALIDATION_ERROR', 'telefone fora do E.164');
select throws_ok($$ select public.public_booking_request('barbearia-link-a', (select sessao_b from ids), (select monday_10 from ids),
    'Visitante', '+5511955550001', 'pedido-servico-de-b-1', repeat('a', 64)) $$,
  'PT404', 'NOT_FOUND', 'serviço de outro negócio não serve');

-- ------------------------------------------------------------------ visitante anônimo
insert into r select 'anon', public.public_booking_request('barbearia-link-a', (select corte_a from ids), (select monday_10 from ids),
  'Maria Visitante', '+5511955550001', 'pedido-anonimo-00001', repeat('b', 64));
select is((select (v->>'status_code')::int from r where k = 'anon'), 201, 'pedido aceito');
select ok((select v::text from r where k = 'anon') !~ '(5511955550001|Maria|"code")', 'resposta sem telefone, nome nem código');
reset role;
select is((select b.status || ':' || b.source || ':' || coalesce(b.customer_id::text, '-') || ':' || b.guest_ref
  from public.bookings b join public.public_booking_requests q on q.booking_id = b.id
  where q.id = (select (v->'body'->>'request_id')::uuid from r where k = 'anon')),
  'held:public_link:-:Maria Visitante', 'provisória do link, sem cliente do CRM, com o nome informado para o dono');
select ok(not exists (select 1 from public.audit_events a where a.action like 'public.%'
  and (a.after::text ~ '(5511955550001|Maria)' or a.before::text ~ '(5511955550001|Maria)')),
  'auditoria sem nome nem telefone');

-- ------------------------------------------------------------------ dono vê quem pediu
select ok(not has_function_privilege('anon', 'public.public_booking_contact(uuid, uuid)', 'execute'), 'anon não lê o contato do pedido');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is((select public.public_booking_contact((select tenant_a from ids), b.id)->>'phone_e164'
  from public.bookings b where b.starts_at = (select monday_10 from ids) and b.source = 'public_link'),
  '+5511955550001', 'dono de A vê o WhatsApp informado no pedido');
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok($$ select public.public_booking_contact((select tenant_a from ids),
    (select b.id from public.bookings b where b.starts_at = (select monday_10 from ids) and b.source = 'public_link')) $$,
  'PT403', 'FORBIDDEN', 'dono de outro negócio não lê o contato');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok($$ select public.public_booking_contact((select tenant_a from ids), '6f000000-0000-4000-8000-000000000001') $$,
  'PT404', 'NOT_FOUND', 'atendimento sem pedido pelo link: nada a mostrar');
reset role;

-- ------------------------------------------------------------------ cliente com vínculo
insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at)
select tenant_a, ab_in_a, customer_ab, 'owner_invite_code', now() from ids;
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
insert into r select 'linked', public.public_booking_request('barbearia-link-a', (select corte_a from ids),
  (select monday_10 from ids) + interval '2 hours', 'Ana', '+5511955550002', 'pedido-com-vinculo-01', repeat('c', 64));
select is((select count(*)::int from public.my_bookings() b where b.starts_at = (select monday_10 from ids) + interval '2 hours'
  and b.status = 'held'), 1, 'cliente com vínculo vê a provisória em Minhas reservas');
reset role;
select is((select coalesce(b.customer_id::text, '-') || ':' || coalesce(b.guest_ref, '-') from public.bookings b
  where b.starts_at = (select monday_10 from ids) + interval '2 hours'),
  (select ab_in_a::text || ':-' from ids), 'reserva no próprio cadastro do cliente, sem nome solto');

-- ------------------------------------------------------------------ limite por perfil
insert into public.public_booking_requests (tenant_id, booking_id, connection_id, contact_name, contact_phone_e164, code, code_hash,
  expires_at, idem_key, request_hash)
select q.tenant_id, q.booking_id, q.connection_id, 'Spam', '+55119666' || lpad(g::text, 5, '0'), '000000', repeat('0', 64),
  q.expires_at, 'spam-limite-perfil-' || lpad(g::text, 5, '0'), repeat('d', 64)
from public.public_booking_requests q, generate_series(1, 28) g
where q.idem_key = 'pedido-anonimo-00001';
select pg_temp.as_anon();
set local role anon;
select throws_ok($$ select public.public_booking_request('barbearia-link-a', (select corte_a from ids),
    (select monday_10 from ids) + interval '4 hours', 'Visitante', '+5511955550003', 'pedido-acima-limite-1', repeat('e', 64)) $$,
  'PT429', 'QUOTA_EXCEEDED', 'mais de 30 pedidos por hora no perfil: recusado');
select is((select (public.public_booking_request('barbearia-link-a', (select corte_a from ids), (select monday_10 from ids),
    'Maria Visitante', '+5511955550001', 'pedido-anonimo-00001', repeat('b', 64))->>'status_code')::int), 201,
  'repetição de um pedido já feito ainda responde (não conta como novo)');
reset role;

select * from finish();
rollback;

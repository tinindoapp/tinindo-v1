-- P56 · Privilégios do schema app (be-banco-04), FKs compostas nos estornos (be-banco-10) e índices do núcleo
-- (be-banco-11). A primeira parte é trava para as próximas migrations: função nova em `app` sem
-- `revoke all … from public` faz este arquivo falhar.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as cust_a,
  '30000000-0000-4000-8000-0000000000b1'::uuid as cust_b;
grant select on ids to authenticated;

-- Privilégios
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute') order by 1 $$,
  'nenhuma função de app é executável por anon (nem por PUBLIC)');
select is(
  (select array_agg(distinct p.proname::text order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['crm_name_key', 'crm_search_key', 'is_member', 'linked_customer_id', 'member_role', 'profile_photo_tenant', 'profile_photo_writer'],
  'authenticated só executa os auxiliares de RLS, storage e coluna gerada');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proacl is null order by 1 $$,
  'nenhuma função de public ficou com a permissão padrão (PUBLIC)');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_a from ids), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select app.rc_sub_json(s) from public.recurrence_subscriptions s where s.tenant_id = %L $$, (select tenant_b from ids)),
  '42501', null, 'auxiliar SECURITY DEFINER que lia sem conferir o negócio: permission denied');
select throws_ok($$ select app.fsc_terms_hash() $$, '42501', null, 'auxiliar comum de app: permission denied');
select ok(app.is_member((select tenant_a from ids), array['owner']), 'auxiliar de RLS continua funcionando');
select ok((select count(*) from public.customers) > 0, 'leitura por RLS continua funcionando');
select ok((public.finance_summary((select tenant_a from ids), now() - interval '7 days', now())) is not null,
  'RPC SECURITY DEFINER continua chamando os auxiliares de app');
reset role;

-- FKs compostas: estorno não aponta para lançamento de outro negócio
insert into public.expense_entries (id, tenant_id, amount_cents, paid_at, category)
select '63000000-0000-4000-8000-0000000000b1', tenant_b, 1000, now(), 'other' from ids;
select throws_ok(
  $$ insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, reversal_of)
     select tenant_a, 1000, now(), 'other', '63000000-0000-4000-8000-0000000000b1' from ids $$,
  '23503', null, 'despesa: estorno de lançamento de outro negócio é recusado pelo banco');
select lives_ok(
  $$ insert into public.expense_entries (tenant_id, amount_cents, paid_at, category, reversal_of)
     select tenant_b, 1000, now(), 'other', '63000000-0000-4000-8000-0000000000b1' from ids $$,
  'despesa: estorno dentro do mesmo negócio continua valendo');
insert into public.receivables (id, tenant_id, customer_id, description, amount_cents) values
  ('63000000-0000-4000-8000-0000000000a2', (select tenant_a from ids), (select cust_a from ids), 'A', 1000),
  ('63000000-0000-4000-8000-0000000000b2', (select tenant_b from ids), (select cust_b from ids), 'B', 1000);
insert into public.payment_entries (id, tenant_id, receivable_id, amount_cents, method, received_at)
select '63000000-0000-4000-8000-0000000000b3', tenant_b, '63000000-0000-4000-8000-0000000000b2', 1000, 'pix', now() from ids;
select throws_ok(
  $$ insert into public.payment_entries (tenant_id, receivable_id, amount_cents, method, received_at, reversal_of)
     select tenant_a, '63000000-0000-4000-8000-0000000000a2', 1000, 'pix', now(), '63000000-0000-4000-8000-0000000000b3' from ids $$,
  '23503', null, 'recebimento: estorno de lançamento de outro negócio é recusado pelo banco');
select is(
  (select array_agg(c.conname::text order by c.conname::text) from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.conname ~ '_(reversal|replaced)_same_tenant$' and c.convalidated),
  array['expense_entries_reversal_same_tenant', 'material_movements_reversal_same_tenant', 'payment_entries_reversal_same_tenant',
        'public_booking_requests_replaced_same_tenant', 'session_entries_reversal_same_tenant', 'team_commission_entries_reversal_same_tenant'],
  'as seis FKs compostas existem e estão validadas');

-- Índices
select has_index('public', 'payment_entries', 'payment_entries_tenant_receivable', array['tenant_id', 'receivable_id'], 'índice dos recebimentos de um recebível');
select has_index('public', 'receivables', 'receivables_tenant_customer', array['tenant_id', 'customer_id', 'created_at'], 'índice dos recebíveis de um cliente');
select hasnt_index('public', 'bookings', 'bookings_customer', 'índice redundante removido');
select has_index('public', 'bookings', 'bookings_customer_starts', 'o índice que cobre o histórico do cliente fica');

select * from finish();
rollback;

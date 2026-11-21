-- P56 · Aviso de corte nas listas com teto (be-banco-06, D31 (a)): o teto fica, e a função diz quando cortou.
-- `truncated.<lista>` é false até o teto exato e true a partir de teto + 1; a lista continua com no máximo o teto.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as cust_a;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.ledger() returns jsonb language sql as $$
  select public.finance_ledger((select tenant_a from ids), now() - interval '20 days', now() + interval '1 day')
$$;
grant execute on function pg_temp.ledger() to authenticated;

-- Trava para as próximas migrations: lista com teto de 200 em `public` tem de avisar o corte.
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ 'limit 200' and p.prosrc !~ '''truncated'''),
  array['my_bookings'],
  'toda função de public com "limit 200" devolve truncated (my_bookings devolve TABLE e fica para a mudança de contrato)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~ '''truncated'''),
  17, 'dezessete leituras avisam o corte (pricing_list_rules no recado #169; pilot_funnel no P32)');

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.ledger()->'truncated', '{"receivables": false, "payments": false, "expenses": false}'::jsonb,
  'caixa pequeno: nada cortado, as três listas declaradas');
select is(public.package_list((select tenant_a from ids))->'truncated', '{"packages": false}'::jsonb, 'pacotes: nada cortado');
reset role;

-- Exatamente no teto: 200 despesas no período não são corte.
insert into public.expense_entries (tenant_id, amount_cents, paid_at, category)
select tenant_a, 1000 + g, now() - make_interval(mins => g), 'other' from ids, generate_series(1, 200) g;
-- Despesa de outro negócio e fora do período não contam.
insert into public.expense_entries (tenant_id, amount_cents, paid_at, category)
select tenant_b, 500, now() - interval '1 hour', 'other' from ids;
insert into public.expense_entries (tenant_id, amount_cents, paid_at, category)
select tenant_a, 500, now() - interval '60 days', 'other' from ids;
set local role authenticated;
select is(jsonb_array_length(pg_temp.ledger()->'expenses'), 200, '200 despesas: todas na lista');
select is(pg_temp.ledger()->'truncated'->'expenses', 'false'::jsonb, '200 despesas no período: sem corte (outro negócio e fora do período não contam)');
reset role;

insert into public.expense_entries (tenant_id, amount_cents, paid_at, category)
select tenant_a, 999, now() - interval '5 days', 'other' from ids;
set local role authenticated;
select is(jsonb_array_length(pg_temp.ledger()->'expenses'), 200, '201 despesas: a lista continua em 200 (contrato .max(200))');
select is(pg_temp.ledger()->'truncated'->'expenses', 'true'::jsonb, '201 despesas: corte avisado');
select is(pg_temp.ledger()->'truncated'->'payments', 'false'::jsonb, 'o aviso é por lista: recebimentos sem corte');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.ledger()->'expenses') e where (e->>'amount_cents')::int = 999),
  'quem ficou de fora foi a despesa mais antiga do período');
reset role;

-- Recebíveis: em aberto de qualquer data + criados no período, o mesmo filtro da lista.
insert into public.receivables (tenant_id, customer_id, description, amount_cents, due_at, created_at)
select tenant_a, cust_a, 'Atendimento ' || g, 5000, now() + make_interval(days => g), now() - interval '90 days' from ids, generate_series(1, 201) g;
insert into public.payment_entries (tenant_id, receivable_id, customer_id, amount_cents, method, received_at)
select r.tenant_id, r.id, r.customer_id, 100, 'pix', now() - interval '2 days'
from public.receivables r where r.tenant_id = (select tenant_a from ids) and r.description like 'Atendimento %';
set local role authenticated;
select is(jsonb_array_length(pg_temp.ledger()->'receivables'), 200, '201 recebíveis em aberto: lista em 200');
select is(pg_temp.ledger()->'truncated'->'receivables', 'true'::jsonb, 'recebíveis em aberto antigos contam para o corte');
select is(pg_temp.ledger()->'truncated'->'payments', 'true'::jsonb, '201 recebimentos no período: corte avisado');
reset role;

-- Pacotes: teto exato e teto + 1.
insert into public.session_packages (tenant_id, customer_id, service_id, purchased_credits, total_price_cents)
select tenant_a, cust_a, corte_a, 5, 10000 from ids, generate_series(1, 200) g;
set local role authenticated;
select is(public.package_list((select tenant_a from ids))->'truncated'->'packages', 'false'::jsonb, '200 pacotes: sem corte');
reset role;
insert into public.session_packages (tenant_id, customer_id, service_id, purchased_credits, total_price_cents)
select tenant_a, cust_a, corte_a, 5, 10000 from ids;
set local role authenticated;
select is(public.package_list((select tenant_a from ids))->'truncated'->'packages', 'true'::jsonb, '201 pacotes: corte avisado');
select is(jsonb_array_length(public.package_list((select tenant_a from ids))->'packages'), 200, 'lista de pacotes continua em 200');
-- Lista com teto menor (50 ofertas) declara o corte no mesmo objeto.
select is(public.waitlist_list((select tenant_a from ids))->'truncated', '{"entries": false, "offers": false}'::jsonb,
  'lista de espera: entradas (200) e ofertas (50) declaradas');
reset role;

select * from finish();
rollback;

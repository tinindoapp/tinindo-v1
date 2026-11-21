-- Recado #169, item 3: pricing_list_rules avisa o corte; sales_quote_list filtra por estado antes do teto de 200.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Um rascunho antigo e 200 cancelados mais novos no negócio A.
insert into public.sales_quotes (tenant_id, customer_id, status, created_at)
values ('10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-0000000000a1', 'draft', '2030-01-01 12:00:00+00');
insert into public.sales_quotes (tenant_id, customer_id, status, created_at)
select '10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-0000000000a1', 'cancelled',
  '2030-02-01 12:00:00+00'::timestamptz + make_interval(mins => g)
from generate_series(1, 200) g;
-- Cada orçamento precisa da versão atual (o JSON do orçamento vem dela).
insert into public.sales_quote_versions (tenant_id, quote_id, version_no, title, items, total_cents, valid_until, snapshot_hash)
select q.tenant_id, q.id, 1, 'Orçamento', '[{"description": "Corte", "quantity": 1, "unit_price_cents": 6000, "line_total_cents": 6000}]'::jsonb,
  6000, '2031-01-01 00:00:00+00', repeat('b', 64)
from public.sales_quotes q where q.tenant_id = '10000000-0000-4000-8000-00000000000a' and q.created_at >= '2030-01-01';

select pg_temp.login_as('a0000000-0000-4000-8000-00000000000a');
set local role authenticated;
select ok(
  (select count(*) from jsonb_array_elements(public.sales_quote_list('10000000-0000-4000-8000-00000000000a', 'draft') -> 'quotes')
     e where e ->> 'status' = 'draft') >= 1,
  'filtro por estado acha o rascunho mesmo atrás de 200 orçamentos mais novos');
select is(public.sales_quote_list('10000000-0000-4000-8000-00000000000a', 'draft') #>> '{truncated,quotes}', 'false',
  'com o filtro, a lista de rascunhos não está cortada');
select is(public.sales_quote_list('10000000-0000-4000-8000-00000000000a', null) #>> '{truncated,quotes}', 'true',
  'sem filtro, mais de 200: avisa o corte');
select is(public.pricing_list_rules('10000000-0000-4000-8000-00000000000a') #>> '{truncated,rules}', 'false',
  'regras de preço dizem se cortaram');
select is(public.pricing_list_rules('10000000-0000-4000-8000-00000000000a') #>> '{truncated,proposals}', 'false',
  'prévias dizem se cortaram');
reset role;

select * from finish();
rollback;

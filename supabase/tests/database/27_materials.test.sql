-- P30 · Materiais e custos: itens com custo médio; compra com despesa no Caixa; ficha de uso; consumo por atendimento
-- concluído tudo ou nada; consumo e estorno sem duplicar estoque; estorno de compra; ajuste com motivo; margem real com
-- cobertura; custo do orçamento (P11); isolamento, RLS e auditoria sem texto livre.
-- Corridas de várias conexões em tests/db-concurrency/26_materials.sh.
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '77000000-0000-4000-8000-000000000001'::uuid as b1,
  '77000000-0000-4000-8000-000000000002'::uuid as b2,
  '77000000-0000-4000-8000-000000000003'::uuid as b3,
  '78000000-0000-4000-8000-000000000001'::uuid as quote;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.id(p_k text, p_path text[]) returns uuid language sql as $$ select (v #>> p_path)::uuid from r where k = p_k $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return v_state || '/' || v_msg || '/' || coalesce(nullif(v_hint, ''), '-');
end $$;
create function pg_temp.item(p_k text) returns jsonb language sql as $$
  select app.mt_item_json(i) from public.material_items i where i.id = pg_temp.id(p_k, '{body,item,id}')
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.id(text, text[]), pg_temp.err(text) to anon, authenticated;

-- Atendimentos de A: dois concluídos (b1, b2) e um confirmado (b3), todos ontem.
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
select x.id, (select tenant_a from ids), (select res_a from ids), (select ana from ids), (select corte_a from ids), now() - x.ago, now() - x.ago + interval '30 minutes',
  tstzrange(now() - x.ago, now() - x.ago + interval '40 minutes', '[)'), true, x.st, 6000, 'owner'
from (values ((select b1 from ids), interval '26 hours', 'completed'), ((select b2 from ids), interval '25 hours', 'completed'),
  ((select b3 from ids), interval '24 hours', 'confirmed')) x(id, ago, st);

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'material\_%'), 'RLS ligada em materiais');
select ok(not has_table_privilege('authenticated', 'public.material_movements', 'insert')
  and not has_table_privilege('authenticated', 'public.material_items', 'update'), 'estoque só muda por RPC');
select ok(not has_column_privilege('authenticated', 'public.material_movements', 'note', 'select'), 'motivo do ajuste fora da leitura direta');
select ok(not has_function_privilege('authenticated', 'app.mt_move(uuid, uuid, text, numeric, bigint, uuid, uuid, uuid, text)', 'execute'), 'movimento só por dentro das RPCs');
select ok(not has_function_privilege('anon', 'public.materials_consume(uuid, uuid, jsonb, text, text, uuid)', 'execute'), 'anon não consome');

-- ------------------------------------------------------------------ itens e ficha
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'sh', public.materials_item_save((select tenant_a from ids), null, null, 'Shampoo', 'consumable', 'ml', true, 200, 'idem-mt-item-sh-0001', pg_temp.h('sh'));
insert into r select 'po', public.materials_item_save((select tenant_a from ids), null, null, 'Pomada', 'product', 'un', true, null, 'idem-mt-item-po-0001', pg_temp.h('po'));
select is((pg_temp.got('sh')->>'status_code')::int, 201, 'item criado');
select is(pg_temp.got('sh')->'body'->'item'->>'unit_cost_cents', null, 'sem estoque, sem custo médio');
select is(public.materials_item_save((select tenant_a from ids), null, null, 'Shampoo', 'consumable', 'ml', true, 200, 'idem-mt-item-sh-0001', pg_temp.h('sh')),
  pg_temp.got('sh'), 'repetir devolve o mesmo item');
select is(pg_temp.err(format($$ select public.materials_item_save(%L, null, null, 'shampoo', 'consumable', 'ml', true, null, 'idem-mt-item-x-00001', %L) $$,
  (select tenant_a from ids), pg_temp.h('x1'))), 'PT422/POLICY_REJECTED/name', 'nome repetido');
select is(pg_temp.err(format($$ select public.materials_item_save(%L, null, null, 'Gel', 'consumable', 'kg', true, null, 'idem-mt-item-x-00002', %L) $$,
  (select tenant_a from ids), pg_temp.h('x2'))), 'PT400/VALIDATION_ERROR/item', 'unidade fora da lista');
insert into r select 'u1', public.materials_usage_save((select tenant_a from ids), (select corte_a from ids), pg_temp.id('sh', '{body,item,id}'), 20, 'idem-mt-usage-000001', pg_temp.h('u1'));
insert into r select 'u2', public.materials_usage_save((select tenant_a from ids), (select corte_a from ids), pg_temp.id('po', '{body,item,id}'), 1, 'idem-mt-usage-000002', pg_temp.h('u2'));
select is(jsonb_array_length(pg_temp.got('u2')->'body'->'usage'), 2, 'ficha do corte com dois itens');

-- ------------------------------------------------------------------ compras e custo médio
insert into r select 'p1', public.materials_purchase((select tenant_a from ids), 'Distribuidora X', now() - interval '2 days',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 1000, 'total_cents', 5000),
    jsonb_build_object('item_id', pg_temp.id('po', '{body,item,id}'), 'quantity', 10, 'total_cents', 3000)), true, 'idem-mt-buy-00000001', pg_temp.h('p1'));
select is((pg_temp.got('p1')->'body'->'purchase'->>'total_cents')::bigint, 8000::bigint, 'total da compra calculado no servidor');
select isnt(pg_temp.got('p1')->'body'->'purchase'->>'expense_id', null, 'despesa registrada no Caixa');
select is(pg_temp.err(format($$ select public.materials_purchase(%L, null, now(), %L, false, 'idem-mt-buy-00000002', %L) $$, (select tenant_a from ids),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 1, 'total_cents', 1),
    jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 1, 'total_cents', 1)), pg_temp.h('p2'))), 'PT400/VALIDATION_ERROR/lines', 'item repetido na compra');
select is(pg_temp.err(format($$ select public.materials_purchase(%L, null, now(), %L, false, 'idem-mt-buy-00000003', %L) $$, (select tenant_a from ids),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 0.0001, 'total_cents', 1)), pg_temp.h('p3'))), 'PT400/VALIDATION_ERROR/lines',
  'quantidade com mais de 3 casas');
insert into r select 'p4', public.materials_purchase((select tenant_a from ids), null, now() - interval '1 day',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 1000, 'total_cents', 7000)), false, 'idem-mt-buy-00000004', pg_temp.h('p4'));
reset role;
select is((select on_hand || '/' || stock_value_cents from public.material_items where name = 'Shampoo'), '2000.000/12000', 'shampoo: 2000 ml por R$ 120');
select is((pg_temp.item('sh')->>'unit_cost_cents')::int, 6, 'custo médio de 6 centavos por ml');
select is((select amount_cents || '/' || category from public.expense_entries where id = pg_temp.id('p1', '{body,purchase,expense_id}')), '8000/supplies', 'despesa de materiais no Caixa');

-- ------------------------------------------------------------------ consumo por atendimento: único, tudo ou nada
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.materials_consume(%L, %L, null, 'idem-mt-cons-0000000', %L) $$, (select tenant_a from ids), (select b3 from ids), pg_temp.h('c0'))),
  'PT422/POLICY_REJECTED/status', 'só atendimento concluído');
insert into r select 'c1', public.materials_consume((select tenant_a from ids), (select b1 from ids), null, 'idem-mt-cons-0000001', pg_temp.h('c1'));
select is((pg_temp.got('c1')->'body'->'consumption'->>'cost_cents')::bigint, 420::bigint, 'custo: 20 ml × 6 + 1 pomada × 300');
select is(pg_temp.got('c1')->'body'->'consumption'->>'source', 'usage', 'pela ficha do serviço');
select is(public.materials_consume((select tenant_a from ids), (select b1 from ids), null, 'idem-mt-cons-0000001', pg_temp.h('c1')), pg_temp.got('c1'),
  'repetir devolve o mesmo consumo');
select is(pg_temp.err(format($$ select public.materials_consume(%L, %L, null, 'idem-mt-cons-0000002', %L) $$, (select tenant_a from ids), (select b1 from ids), pg_temp.h('c2'))),
  'PT422/POLICY_REJECTED/consumed', 'outro consumo no mesmo atendimento é recusado');
select is(pg_temp.err(format($$ select public.materials_consume(%L, %L, %L, 'idem-mt-cons-0000003', %L) $$, (select tenant_a from ids), (select b2 from ids),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 30), jsonb_build_object('item_id', pg_temp.id('po', '{body,item,id}'), 'quantity', 50)),
  pg_temp.h('c3'))), 'PT422/POLICY_REJECTED/stock', 'falta de pomada recusa o consumo inteiro');
reset role;
select is((select on_hand || '/' || stock_value_cents from public.material_items where name = 'Shampoo'), '1980.000/11880', 'o shampoo da linha recusada não saiu');
select is((select count(*)::int from public.material_consumptions where booking_id = (select b2 from ids)), 0, 'nenhum consumo parcial');
select is((select on_hand::text from public.material_items where name = 'Pomada'), '9.000', 'pomada: 9');

-- ------------------------------------------------------------------ estorno do consumo: uma vez, valor exato de volta
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rv', public.materials_consume_reverse((select tenant_a from ids), pg_temp.id('c1', '{body,consumption,id}'), (pg_temp.got('c1')->'body'->'consumption'->>'version')::int, 'idem-mt-rev-00000001', pg_temp.h('rv'));
select is(pg_temp.got('rv')->'body'->'consumption'->>'status', 'reversed', 'consumo estornado');
select is(pg_temp.err(format($$ select public.materials_consume_reverse(%L, %L, 3, 'idem-mt-rev-00000002', %L) $$, (select tenant_a from ids),
  pg_temp.id('c1', '{body,consumption,id}'), pg_temp.h('rv2'))), 'PT422/POLICY_REJECTED/reversed', 'estorno uma vez só');
reset role;
select is((select on_hand || '/' || stock_value_cents from public.material_items where name = 'Shampoo'), '2000.000/12000', 'shampoo volta exato');
select is((select on_hand || '/' || stock_value_cents from public.material_items where name = 'Pomada'), '10.000/3000', 'pomada volta exata');
select is((select count(*)::int from public.material_movements where kind = 'reversal'), 2, 'uma linha de estorno por item');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'c4', public.materials_consume((select tenant_a from ids), (select b1 from ids),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 25.5)), 'idem-mt-cons-0000004', pg_temp.h('c4'));
select is((pg_temp.got('c4')->'body'->'consumption'->>'cost_cents')::bigint, 153::bigint, 'depois do estorno, registra de novo (manual: 25,5 ml)');
select is((pg_temp.got('c4')->'body'->'consumption'->'lines'->0->>'quantity')::numeric, 25.5, 'quantidade com casas decimais');

-- ------------------------------------------------------------------ margem real com cobertura
insert into r select 'mg', public.materials_margin((select tenant_a from ids), now() - interval '7 days', now());
select is((pg_temp.got('mg')->'services'->0) - 'service_id'::text,
  '{"service_name": "Corte", "completed": 2, "with_materials": 1, "revenue_cents": 12000, "covered_revenue_cents": 6000, "material_cost_cents": 153, "margin_cents": 5847, "margin_bps": 9745}'::jsonb,
  'margem real só sobre o atendimento com consumo; cobertura 1 de 2');
select is((pg_temp.got('mg')->'totals'->>'completed')::int, 2, 'total de concluídos');
insert into r select 'bk', public.materials_bookings((select tenant_a from ids), now() - interval '7 days', now());
select is(jsonb_array_length(pg_temp.got('bk')->'bookings'), 2, 'atendimentos concluídos para registrar');
select ok((select bool_or(x->'consumption' is null or x->'consumption' = 'null'::jsonb) from jsonb_array_elements(pg_temp.got('bk')->'bookings') x), 'um ainda sem consumo');

-- ------------------------------------------------------------------ estorno da compra e ajuste
select is(pg_temp.err(format($$ select public.materials_purchase_reverse(%L, %L, 9, 'idem-mt-prev-0000000', %L) $$, (select tenant_a from ids),
  pg_temp.id('p1', '{body,purchase,id}'), pg_temp.h('pr0'))), 'PT409/STALE_VERSION/-', 'estorno da compra exige a versão vista');
insert into r select 'pr', public.materials_purchase_reverse((select tenant_a from ids), pg_temp.id('p1', '{body,purchase,id}'), 1, 'idem-mt-prev-0000001', pg_temp.h('pr'));
select is(pg_temp.got('pr')->'body'->'purchase'->>'status', 'reversed', 'compra estornada');
select is(pg_temp.err(format($$ select public.materials_purchase_reverse(%L, %L, 2, 'idem-mt-prev-0000002', %L) $$, (select tenant_a from ids),
  pg_temp.id('p1', '{body,purchase,id}'), pg_temp.h('pr2'))), 'PT422/POLICY_REJECTED/status', 'uma vez só');
reset role;
select is((select on_hand::text from public.material_items where name = 'Shampoo'), '974.500', 'shampoo: 1974,5 − 1000');
select is((select on_hand || '/' || stock_value_cents from public.material_items where name = 'Pomada'), '0.000/0', 'pomada zerada com valor zerado');
select is((select count(*)::int from public.expense_entries where reversal_of = pg_temp.id('p1', '{body,purchase,expense_id}')), 1, 'despesa estornada no Caixa');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.materials_consume(%L, %L, null, 'idem-mt-cons-0000005', %L) $$, (select tenant_a from ids), (select b2 from ids), pg_temp.h('c5'))),
  'PT422/POLICY_REJECTED/stock', 'sem pomada, o consumo pela ficha é recusado');
select is(pg_temp.err(format($$ select public.materials_adjust(%L, %L, %s, 900, '  ', 'idem-mt-adj-00000000', %L) $$, (select tenant_a from ids),
  pg_temp.id('sh', '{body,item,id}'), (select version from public.material_items where name = 'Shampoo'), pg_temp.h('a0'))), 'PT400/VALIDATION_ERROR/reason', 'ajuste exige motivo');
insert into r select 'adj', public.materials_adjust((select tenant_a from ids), pg_temp.id('sh', '{body,item,id}'), (select version from public.material_items where name = 'Shampoo'),
  900, 'Frasco vazou', 'idem-mt-adj-00000001', pg_temp.h('adj'));
select is((pg_temp.got('adj')->'body'->'item'->>'on_hand')::numeric, 900::numeric, 'contagem vira o saldo');
select is((pg_temp.got('adj')->'body'->'item'->>'unit_cost_cents')::int, (select round(stock_value_cents / on_hand)::int from public.material_items where name = 'Shampoo'),
  'custo médio preservado na falta');
select is(pg_temp.err(format($$ select public.materials_item_save(%L, %L, %s, 'Shampoo', 'consumable', 'g', true, 200, 'idem-mt-item-x-00003', %L) $$,
  (select tenant_a from ids), pg_temp.id('sh', '{body,item,id}'), (select version from public.material_items where name = 'Shampoo'), pg_temp.h('x3'))),
  'PT422/POLICY_REJECTED/unit', 'unidade fixa depois do primeiro movimento');
insert into r select 'mv', public.materials_movements((select tenant_a from ids), pg_temp.id('sh', '{body,item,id}'), now() - interval '7 days', now() + interval '1 minute');
select ok(jsonb_array_length(pg_temp.got('mv')->'movements') >= 6, 'razão do item');
select ok(pg_temp.got('mv')::text !~ 'vazou', 'motivo do ajuste não sai na leitura');

-- ------------------------------------------------------------------ custo do orçamento (P11)
reset role;
insert into public.sales_quotes (id, tenant_id, customer_id, status, current_version) select quote, tenant_a, ana, 'draft', 1 from ids;
insert into public.sales_quote_versions (tenant_id, quote_id, version_no, title, items, total_cents, valid_until, snapshot_hash)
select tenant_a, quote, 1, 'Pacote noiva', jsonb_build_array(
  jsonb_build_object('service_id', corte_a, 'description', 'Corte', 'quantity', 2, 'unit_price_cents', 6000, 'line_total_cents', 12000),
  jsonb_build_object('service_id', null, 'description', 'Deslocamento', 'quantity', 1, 'unit_price_cents', 3000, 'line_total_cents', 3000)),
  15000, now() + interval '7 days', repeat('a', 64) from ids;
-- Pomada volta ao estoque para o custo ser conhecido.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'p5', public.materials_purchase((select tenant_a from ids), null, now(),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('po', '{body,item,id}'), 'quantity', 4, 'total_cents', 1600)), false, 'idem-mt-buy-00000005', pg_temp.h('p5'));
insert into r select 'qc', public.materials_quote_cost((select tenant_a from ids), (select quote from ids));
select is((pg_temp.got('qc')->>'material_cost_cents')::bigint,
  (select (2 * round(20 * stock_value_cents / on_hand))::bigint from public.material_items where name = 'Shampoo') + 800, 'custo: 2 × (20 ml de shampoo + 1 pomada a R$ 4)');
select is((pg_temp.got('qc')->>'margin_cents')::bigint, 15000 - (pg_temp.got('qc')->>'material_cost_cents')::bigint, 'margem estimada = total − materiais');
select is((pg_temp.got('qc')->'lines'->1->>'covered')::boolean, false, 'linha sem serviço não é coberta');
select is((pg_temp.got('qc')->>'covered')::boolean, false, 'orçamento com cobertura parcial');

-- ------------------------------------------------------------------ isolamento e privacidade
select pg_temp.login_as((select owner_b from ids));
select throws_ok(format($$ select public.materials_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não lista materiais de A');
select throws_ok(format($$ select public.materials_consume(%L, %L, null, 'idem-mt-b-0000000001', %L) $$, (select tenant_a from ids), (select b2 from ids), pg_temp.h('b')),
  'PT403', 'FORBIDDEN', 'B não consome em A');
select is(pg_temp.err(format($$ select public.materials_purchase(%L, null, now(), %L, false, 'idem-mt-b-0000000002', %L) $$, (select tenant_b from ids),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('sh', '{body,item,id}'), 'quantity', 1, 'total_cents', 1)), pg_temp.h('b2'))), 'PT404/NOT_FOUND/item_id',
  'B não compra item de A no próprio negócio');
select is(pg_temp.err(format($$ select public.materials_quote_cost(%L, %L) $$, (select tenant_b from ids), (select quote from ids))), 'PT404/NOT_FOUND/-', 'nem lê orçamento de A');
select is((select count(*)::int from public.material_items) + (select count(*)::int from public.material_movements), 0, 'RLS: B não vê nada');
select pg_temp.login_as((select customer_ab from ids));
select is((select count(*)::int from public.material_consumptions) + (select count(*)::int from public.material_items), 0, 'cliente com login não lê materiais');
reset role;
select is((select count(*)::int from public.audit_events where action like 'materials.%' and coalesce(after::text, '') ~ 'vazou|Distribuidora'), 0,
  'auditoria sem texto livre');

select * from finish();
rollback;

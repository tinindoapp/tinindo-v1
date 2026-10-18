-- P07 · Caixa registrado: pacote de R$1.000 em 10 sessões não repete caixa; consumo, retry e estorno;
-- recebimento parcial, excesso negado e estorno; despesas; resumo com cobertura; acesso só do dono.
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '20000000-0000-4000-8000-00000000000b'::uuid as res_b,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000b1'::uuid as treino_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as cust_a,
  '30000000-0000-4000-8000-0000000000b1'::uuid as cust_b;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.ev(p_booking uuid) returns uuid language sql security definer as $$
  select o.event_id from public.outbox_events o where o.aggregate_id = p_booking and o.event_type = 'booking.completed.v1'
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text) to anon, authenticated;
grant execute on function pg_temp.ev(uuid) to authenticated;

-- Reservas passadas confirmadas (fora das RPCs, como histórico), concluídas depois pela RPC do P03.
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range,
  blocks_capacity, status, agreed_price_cents, source)
select v.id, (select tenant_b from ids), (select res_b from ids), v.cust, (select treino_b from ids),
  now() - v.ago, now() - v.ago + interval '60 minutes',
  tstzrange(now() - v.ago - interval '15 minutes', now() - v.ago + interval '75 minutes', '[)'),
  true, 'confirmed', 12000, 'owner'
from (values
  ('61000000-0000-4000-8000-0000000000b1'::uuid, interval '10 days', (select cust_b from ids)),
  ('61000000-0000-4000-8000-0000000000b2'::uuid, interval '8 days', (select cust_b from ids)),
  ('61000000-0000-4000-8000-0000000000b3'::uuid, interval '6 days', null::uuid),
  ('61000000-0000-4000-8000-0000000000b4'::uuid, interval '4 days', (select cust_b from ids)),
  ('61000000-0000-4000-8000-0000000000b5'::uuid, interval '3 days', (select cust_b from ids))
) as v(id, ago, cust);
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range,
  blocks_capacity, status, agreed_price_cents, source)
values ('61000000-0000-4000-8000-0000000000a1', (select tenant_a from ids), (select res_a from ids), (select cust_a from ids),
  (select corte_a from ids), now() - interval '2 days', now() - interval '2 days' + interval '30 minutes',
  tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '40 minutes', '[)'), true, 'confirmed', 6000, 'owner');

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('receivables', 'payment_entries', 'expense_entries', 'session_packages', 'session_entries')),
  'RLS ligada no caixa');
select ok(not has_table_privilege('authenticated', 'public.payment_entries', 'insert'), 'authenticated não grava recebimento direto');
select ok(not has_function_privilege('anon',
  'public.finance_record_payment(uuid, uuid, bigint, text, timestamptz, text, text, uuid)', 'execute'), 'anon não registra recebimento');

-- ------------------------------------------------------------------ dono B: concluir atendimentos (P03) e vender pacote
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
insert into r select 'done-' || b.id, public.scheduling_booking_complete((select tenant_b from ids), b.id, 1, 'idem-complete-' || right(b.id::text, 4) || '-0001',
  pg_temp.h(b.id::text))
from (values ('61000000-0000-4000-8000-0000000000b1'::uuid), ('61000000-0000-4000-8000-0000000000b2'),
  ('61000000-0000-4000-8000-0000000000b3'), ('61000000-0000-4000-8000-0000000000b4'),
  ('61000000-0000-4000-8000-0000000000b5')) b(id);

insert into r select 'sell', public.package_sell((select tenant_b from ids), (select cust_b from ids), (select treino_b from ids),
  10, 100000, now() + interval '90 days', 'idem-sell-000000001', pg_temp.h('sell'));
select is((pg_temp.got('sell')->>'status_code')::int, 201, 'pacote vendido');
select is((pg_temp.got('sell')->'body'->'package'->>'remaining_credits')::int, 10, '10 créditos');
select is((pg_temp.got('sell')->'body'->'receivable'->>'amount_cents')::bigint, 100000::bigint, 'um recebível de R$1.000');
select is((select count(*)::int from public.receivables where package_id = (pg_temp.got('sell')->'body'->'package'->>'package_id')::uuid),
  1, 'exatamente um recebível para o pacote');

insert into r select 'pay_pkg', public.finance_record_payment((select tenant_b from ids),
  (pg_temp.got('sell')->'body'->'receivable'->>'id')::uuid, 100000, 'pix', now(), 'idem-pay-pkg-000001', pg_temp.h('pay_pkg'));
select is(pg_temp.got('pay_pkg')->'body'->>'source', 'manual', 'recebimento identificado como manual');

-- Consumo por evento de conclusão
insert into r select 'c1', public.package_consume((select tenant_b from ids),
  (pg_temp.got('sell')->'body'->'package'->>'package_id')::uuid, '61000000-0000-4000-8000-0000000000b1',
  pg_temp.ev('61000000-0000-4000-8000-0000000000b1'), 'idem-consume-b1-001', pg_temp.h('c1'));
select is((pg_temp.got('c1')->'body'->>'remaining_credits')::int, 9, 'consumo debita 1 crédito');
select is(public.package_consume((select tenant_b from ids),
  (pg_temp.got('sell')->'body'->'package'->>'package_id')::uuid, '61000000-0000-4000-8000-0000000000b1',
  pg_temp.ev('61000000-0000-4000-8000-0000000000b1'), 'idem-consume-b1-001', pg_temp.h('c1')), pg_temp.got('c1'),
  'mesma chave → mesma resposta');
select is((public.package_consume((select tenant_b from ids),
  (pg_temp.got('sell')->'body'->'package'->>'package_id')::uuid, '61000000-0000-4000-8000-0000000000b1',
  pg_temp.ev('61000000-0000-4000-8000-0000000000b1'), 'idem-consume-b1-retry', pg_temp.h('c1-retry'))->'body'->>'remaining_credits')::int,
  9, 'mesmo evento com outra chave (retry do worker) não debita de novo');
select throws_ok(format($$ select public.package_consume(%L, %L, '61000000-0000-4000-8000-0000000000b2', %L,
  'idem-consume-wrong-ev', %L) $$, (select tenant_b from ids), (pg_temp.got('sell')->'body'->'package'->>'package_id'),
  pg_temp.ev('61000000-0000-4000-8000-0000000000b4'), pg_temp.h('wrongev')),
  'PT422', 'POLICY_REJECTED', 'evento de outra reserva não serve');
select throws_ok(format($$ select public.package_consume(%L, %L, '61000000-0000-4000-8000-0000000000b3', %L,
  'idem-consume-other-c', %L) $$, (select tenant_b from ids), (pg_temp.got('sell')->'body'->'package'->>'package_id'),
  pg_temp.ev('61000000-0000-4000-8000-0000000000b3'), pg_temp.h('otherc')),
  'PT422', 'POLICY_REJECTED', 'reserva de outro cliente não consome o pacote');
select throws_ok(format($$ select public.finance_charge_booking(%L, '61000000-0000-4000-8000-0000000000b1', null,
  'idem-charge-consumed', %L) $$, (select tenant_b from ids), pg_temp.h('chc')),
  'PT422', 'POLICY_REJECTED', 'atendimento pago com crédito não vira cobrança (sem receita repetida)');

insert into r select 'c2', public.package_consume((select tenant_b from ids),
  (pg_temp.got('sell')->'body'->'package'->>'package_id')::uuid, '61000000-0000-4000-8000-0000000000b2',
  pg_temp.ev('61000000-0000-4000-8000-0000000000b2'), 'idem-consume-b2-001', pg_temp.h('c2'));
select is((pg_temp.got('c2')->'body'->>'remaining_credits')::int, 8, 'segundo consumo → 8');
select is((select coalesce(sum(amount_cents), 0)::bigint from public.payment_entries
  where tenant_id = (select tenant_b from ids)), 100000::bigint, 'consumir sessões não gera caixa');

-- Estorno do consumo
insert into r select 'rev', public.package_reverse((select tenant_b from ids),
  (select id from public.session_entries where booking_id = '61000000-0000-4000-8000-0000000000b2' and reason = 'consume'),
  'Aula cancelada pelo professor', 'idem-pkg-reverse-01', pg_temp.h('rev'));
select is((pg_temp.got('rev')->'body'->>'remaining_credits')::int, 9, 'estorno devolve o crédito');
select throws_ok(format($$ select public.package_reverse(%L, %L, 'De novo', 'idem-pkg-reverse-02', %L) $$,
  (select tenant_b from ids),
  (select id from public.session_entries where booking_id = '61000000-0000-4000-8000-0000000000b2' and reason = 'consume'),
  pg_temp.h('rev2')), 'PT422', 'POLICY_REJECTED', 'estorno é único');

-- Pacote de 1 crédito: o segundo consumo é negado (sem saldo negativo)
insert into r select 'small', public.package_sell((select tenant_b from ids), (select cust_b from ids), (select treino_b from ids),
  1, 12000, null, 'idem-sell-small-001', pg_temp.h('small'));
insert into r select 'small_c', public.package_consume((select tenant_b from ids),
  (pg_temp.got('small')->'body'->'package'->>'package_id')::uuid, '61000000-0000-4000-8000-0000000000b4',
  pg_temp.ev('61000000-0000-4000-8000-0000000000b4'), 'idem-consume-small-1', pg_temp.h('small_c'));
select is((pg_temp.got('small_c')->'body'->>'remaining_credits')::int, 0, 'último crédito usado');
select throws_ok(format($$ select public.package_consume(%L, %L, '61000000-0000-4000-8000-0000000000b5', %L,
  'idem-consume-small-2', %L) $$, (select tenant_b from ids), (pg_temp.got('small')->'body'->'package'->>'package_id'),
  pg_temp.ev('61000000-0000-4000-8000-0000000000b5'), pg_temp.h('small2')),
  'PT422', 'POLICY_REJECTED', 'sem crédito → negado, saldo nunca negativo');
select throws_ok(format($$ select public.package_consume(%L, %L, '61000000-0000-4000-8000-0000000000b1', %L,
  'idem-consume-other-pk', %L) $$, (select tenant_b from ids), (pg_temp.got('small')->'body'->'package'->>'package_id'),
  pg_temp.ev('61000000-0000-4000-8000-0000000000b1'), pg_temp.h('otherpk')),
  'PT422', 'POLICY_REJECTED', 'evento que já debitou outro pacote não debita este');

insert into r select 'uncharged', public.finance_uncharged((select tenant_b from ids), now() - interval '30 days', now());
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('uncharged')->'bookings')), 3,
  'sem cobrança: concluídos sem crédito ativo nem cobrança (inclui o consumo estornado)');
select ok((select bool_and(x->>'completed_event_id' is not null) from jsonb_array_elements(pg_temp.got('uncharged')->'bookings') x),
  'cada concluído traz o evento de conclusão');
select is((select jsonb_array_length(x->'package_ids') from jsonb_array_elements(pg_temp.got('uncharged')->'bookings') x
  where x->>'booking_id' = '61000000-0000-4000-8000-0000000000b5'), 1, 'sugere o pacote com saldo do mesmo cliente e serviço');
reset role;

-- ------------------------------------------------------------------ recebível, parcial, excesso, estorno (A)
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'done-a1', public.scheduling_booking_complete((select tenant_a from ids), '61000000-0000-4000-8000-0000000000a1', 1,
  'idem-complete-a1-0001', pg_temp.h('ca1'));
insert into r select 'charge', public.finance_charge_booking((select tenant_a from ids), '61000000-0000-4000-8000-0000000000a1',
  null, 'idem-charge-a1-0001', pg_temp.h('charge'));
select is((pg_temp.got('charge')->'body'->'receivable'->>'amount_cents')::int, 6000, 'cobrança usa o preço combinado');
select is(pg_temp.got('charge')->'body'->'receivable'->>'status', 'open', 'recebível aberto: agendar ≠ receber');
select throws_ok(format($$ select public.finance_charge_booking(%L, '61000000-0000-4000-8000-0000000000a1', null,
  'idem-charge-a1-0002', %L) $$, (select tenant_a from ids), pg_temp.h('charge2')),
  'PT422', 'POLICY_REJECTED', 'um recebível ativo por atendimento');

insert into r select 'p1', public.finance_record_payment((select tenant_a from ids),
  (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid, 2500, 'cash', now(), 'idem-pay-a1-000001', pg_temp.h('p1'));
select is((select status from public.receivables where id = (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid),
  'partially_paid', 'pagamento parcial');
select is(public.finance_record_payment((select tenant_a from ids),
  (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid, 2500, 'cash', (pg_temp.got('p1')->>'received_at')::timestamptz,
  'idem-pay-a1-000001', pg_temp.h('p1')), jsonb_build_object('status_code', 201, 'body', pg_temp.got('p1')->'body'),
  'repetir o recebimento devolve o mesmo registro') ;
select is((select count(*)::int from public.payment_entries where receivable_id = (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid),
  1, 'retry não duplica recebimento');
select throws_ok(format($$ select public.finance_record_payment(%L, %L, 4000, 'pix', now(), 'idem-pay-a1-over01', %L) $$,
  (select tenant_a from ids), pg_temp.got('charge')->'body'->'receivable'->>'id', pg_temp.h('over')),
  'PT422', 'POLICY_REJECTED', 'recebimento acima do saldo em aberto negado');
select throws_ok(format($$ select public.finance_record_payment(%L, %L, 100, 'pix', now() + interval '1 day', 'idem-pay-future01', %L) $$,
  (select tenant_a from ids), pg_temp.got('charge')->'body'->'receivable'->>'id', pg_temp.h('fut')),
  'PT400', 'VALIDATION_ERROR', 'recebimento no futuro negado');
insert into r select 'p2', public.finance_record_payment((select tenant_a from ids),
  (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid, 3500, 'pix', now(), 'idem-pay-a1-000002', pg_temp.h('p2'));
select is((select status from public.receivables where id = (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid),
  'paid', 'quitado');
select throws_ok(format($$ select public.finance_receivable_cancel(%L, %L, %s, 'idem-cancel-paid-01', %L) $$,
  (select tenant_a from ids), pg_temp.got('charge')->'body'->'receivable'->>'id',
  (select version from public.receivables where id = (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid), pg_temp.h('cp')),
  'PT422', 'POLICY_REJECTED', 'recebível com recebimento não é cancelado (estornar antes)');

insert into r select 'rv', public.finance_reverse_payment((select tenant_a from ids), (pg_temp.got('p1')->'body'->>'id')::uuid,
  'Pix devolvido', 'idem-rev-pay-00001', pg_temp.h('rv'));
select is((pg_temp.got('rv')->'body'->>'reversal_of')::uuid, (pg_temp.got('p1')->'body'->>'id')::uuid, 'estorno referencia o original');
select is((select paid_cents::int from public.receivables where id = (pg_temp.got('charge')->'body'->'receivable'->>'id')::uuid),
  3500, 'estorno reduz o recebido do recebível');
select throws_ok(format($$ select public.finance_reverse_payment(%L, %L, 'De novo', 'idem-rev-pay-00002', %L) $$,
  (select tenant_a from ids), pg_temp.got('p1')->'body'->>'id', pg_temp.h('rv2')),
  'PT422', 'POLICY_REJECTED', 'estorno é único');
select throws_ok(format($$ select public.finance_reverse_payment(%L, %L, 'Estornar o estorno', 'idem-rev-pay-00003', %L) $$,
  (select tenant_a from ids), pg_temp.got('rv')->'body'->>'id', pg_temp.h('rv3')),
  'PT422', 'POLICY_REJECTED', 'estorno não é estornável');

-- Despesas
insert into r select 'e1', public.finance_record_expense((select tenant_a from ids), 1500, now(), 'supplies', 'Lâminas',
  'idem-expense-00001', pg_temp.h('e1'));
insert into r select 'e2', public.finance_record_expense((select tenant_a from ids), 900, now(), 'other', null,
  'idem-expense-00002', pg_temp.h('e2'));
insert into r select 'e2r', public.finance_reverse_expense((select tenant_a from ids), (pg_temp.got('e2')->'body'->>'id')::uuid,
  'idem-expense-rev-01', pg_temp.h('e2r'));
select throws_ok(format($$ select public.finance_record_expense(%L, 100, now(), 'impostos', null, 'idem-expense-bad01', %L) $$,
  (select tenant_a from ids), pg_temp.h('bad')), '23514', null, 'categoria fora da lista negada');

-- Recebível avulso e cancelamento
insert into r select 'avulso', public.finance_receivable_create((select tenant_a from ids), (select cust_a from ids),
  'Produto: pomada', 3000, now() + interval '7 days', 'idem-receivable-001', pg_temp.h('avulso'));
insert into r select 'avulso_c', public.finance_receivable_cancel((select tenant_a from ids),
  (pg_temp.got('avulso')->'body'->'receivable'->>'id')::uuid, 1, 'idem-receivable-c01', pg_temp.h('avc'));
select is(pg_temp.got('avulso_c')->'body'->'receivable'->>'status', 'cancelled', 'recebível sem recebimento é cancelado');
insert into r select 'avulso2', public.finance_receivable_create((select tenant_a from ids), null,
  'Sinal de evento', 10000, null, 'idem-receivable-002', pg_temp.h('avulso2'));

-- Resumo do caixa registrado
insert into r select 'sum', public.finance_summary((select tenant_a from ids), now() - interval '1 day', now() + interval '1 day');
select is((pg_temp.got('sum')->>'received_cents')::int, 3500, 'recebido exclui o recebimento estornado');
select is((pg_temp.got('sum')->>'spent_cents')::int, 1500, 'gasto exclui a despesa estornada');
select is((pg_temp.got('sum')->>'receivable_open_cents')::int, 2500 + 10000, 'a receber = saldo aberto (cancelado não conta)');
select is((pg_temp.got('sum')->>'records_count')::int, 2, 'cobertura: quantos registros sustentam o número');
select ok(pg_temp.got('sum')->>'coverage_note' ~ 'Não é lucro', 'resumo avisa que não é lucro');
select is(pg_temp.got('sum')->>'timezone', 'America/Sao_Paulo', 'resumo informa o fuso do negócio');
select throws_ok(format($$ select public.finance_summary(%L, now(), now() - interval '1 day') $$, (select tenant_a from ids)),
  'PT400', 'VALIDATION_ERROR', 'período invertido negado');
reset role;

select ok((select count(*) = 2 from public.outbox_events where tenant_id = (select tenant_a from ids)
  and event_type = 'payment.recorded.v1'), 'cada recebimento emite payment.recorded.v1 (retry não duplica)');
select throws_ok($$ update public.payment_entries set amount_cents = 1 $$, 'PT403', 'FORBIDDEN', 'recebimento é append-only');
select throws_ok($$ delete from public.expense_entries $$, 'PT403', 'FORBIDDEN', 'despesa é append-only');
select throws_ok($$ update public.session_entries set delta = -1 where reason = 'reversal' $$, 'PT403', 'FORBIDDEN',
  'ledger de créditos é append-only');

-- ------------------------------------------------------------------ isolamento e acesso restrito
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is((select count(*)::int from public.receivables where tenant_id = (select tenant_a from ids)), 0, 'dono B não lê recebíveis de A');
select is((select count(*)::int from public.payment_entries where tenant_id = (select tenant_a from ids)), 0, 'dono B não lê recebimentos de A');
select throws_ok(format($$ select public.finance_summary(%L, now() - interval '1 day', now()) $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'dono B não vê o caixa de A');
select throws_ok(format($$ select public.finance_charge_booking(%L, '61000000-0000-4000-8000-0000000000a1', null,
  'idem-charge-cross-01', %L) $$, (select tenant_b from ids), pg_temp.h('cross')),
  'PT404', 'NOT_FOUND', 'reserva de A não é cobrada pelo tenant B');
select throws_ok(format($$ select public.finance_record_payment(%L, %L, 100, 'pix', now(), 'idem-pay-cross-0001', %L) $$,
  (select tenant_b from ids), pg_temp.got('avulso2')->'body'->'receivable'->>'id', pg_temp.h('pc')),
  'PT404', 'NOT_FOUND', 'recebível de A não aceita recebimento via B');
reset role;

-- Cliente com login nos dois negócios (não vinculado) e cliente vinculado: nenhum acesso ao caixa.
insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at)
values ((select tenant_b from ids), (select cust_b from ids), (select customer_ab from ids), 'owner_invite_code', now());
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select is((select count(*)::int from public.session_packages), 0, 'cliente vinculado não lê pacotes pela tabela');
select is((select count(*)::int from public.receivables), 0, 'cliente vinculado não lê recebíveis');
select throws_ok(format($$ select public.package_list(%L) $$, (select tenant_b from ids)), 'PT403', 'FORBIDDEN',
  'cliente não chama leituras do caixa');
reset role;
set local role anon;
select throws_ok('select * from public.payment_entries', '42501', null, 'anon não lê recebimentos');
reset role;

select * from finish();
rollback;

-- P31 · Financeiro ampliado: categorias próprias; contas a pagar (única e mensal), pagar cria UMA despesa no Caixa,
-- pagar de novo não baixa de novo, estorno uma vez, pagar de novo depois do estorno; cancelar e encerrar série;
-- conciliação por meio e origem (manual e PSP) com diferença; demonstrativo de caixa do mês com período, categorias e
-- cobertura; isolamento, RLS e auditoria sem texto livre. Corridas em tests/db-concurrency/27_finance_advanced.sh.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  (now() at time zone 'America/Sao_Paulo')::date as today,
  date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as month1;
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
create function pg_temp.ver(p_id uuid) returns integer language sql as $$ select version from public.fin_payables where id = p_id $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.id(text, text[]), pg_temp.err(text), pg_temp.ver(uuid) to anon, authenticated;

-- Recebimentos de hoje em A: Pix manual 60, dinheiro 40 e Pix pelo PSP simulado 50 (com a cobrança paga do P14).
insert into public.receivables (id, tenant_id, customer_id, description, amount_cents, paid_cents, status)
select x.id, tenant_a, ana, x.d, x.c, x.c, 'paid' from ids, (values ('79000000-0000-4000-8000-000000000001'::uuid, 'Corte', 6000),
  ('79000000-0000-4000-8000-000000000002'::uuid, 'Barba', 4000), ('79000000-0000-4000-8000-000000000003'::uuid, 'Corte e barba', 5000)) x(id, d, c);
insert into public.payment_entries (id, tenant_id, receivable_id, customer_id, amount_cents, method, source, received_at)
select x.id, tenant_a, x.rec, ana, x.c, x.m, 'manual', now() from ids, (values
  ('7a000000-0000-4000-8000-000000000001'::uuid, '79000000-0000-4000-8000-000000000001'::uuid, 6000, 'pix'),
  ('7a000000-0000-4000-8000-000000000002'::uuid, '79000000-0000-4000-8000-000000000002'::uuid, 4000, 'cash')) x(id, rec, c, m);
insert into public.payment_charges (id, tenant_id, receivable_id, customer_id, provider, external_id, amount_cents, description, status, link_token_hash, paid_at, paid_cents)
select '7b000000-0000-4000-8000-000000000001', tenant_a, '79000000-0000-4000-8000-000000000003', ana, 'simulated', 'sim-p31-1', 5000, 'Corte e barba', 'paid', repeat('c', 64), now(), 5000 from ids;
insert into public.payment_entries (id, tenant_id, receivable_id, customer_id, amount_cents, method, source, received_at, charge_id)
select '7a000000-0000-4000-8000-000000000003', tenant_a, '79000000-0000-4000-8000-000000000003', ana, 5000, 'pix', 'provider', now(), '7b000000-0000-4000-8000-000000000001' from ids;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'fin\_%'), 'RLS ligada no financeiro ampliado');
select ok(not has_table_privilege('authenticated', 'public.fin_payable_payments', 'insert')
  and not has_table_privilege('authenticated', 'public.fin_payables', 'update'), 'escrita só por RPC');
select ok(not has_function_privilege('anon', 'public.accounts_payable_pay(uuid, uuid, integer, timestamptz, text, text, uuid)', 'execute'), 'anon não paga');
select ok(not has_function_privilege('authenticated', 'app.fa_materialize(public.fin_payable_series, date)', 'execute'), 'geração da série só por dentro');

-- ------------------------------------------------------------------ categorias
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cr', public.accounts_category_save((select tenant_a from ids), null, null, 'expense', 'Aluguel do salão', 'rent', true, 'idem-fa-cat-00000001', pg_temp.h('cr'));
insert into r select 'ci', public.accounts_category_save((select tenant_a from ids), null, null, 'income', 'Cursos', null, true, 'idem-fa-cat-00000002', pg_temp.h('ci'));
select is(pg_temp.got('cr')->'body'->'category'->>'base', 'rent', 'categoria de despesa lança no Aluguel do Caixa');
select is(pg_temp.got('ci')->'body'->'category'->>'base', null, 'receita sem categoria do Caixa');
select is(public.accounts_category_save((select tenant_a from ids), null, null, 'expense', 'Aluguel do salão', 'rent', true, 'idem-fa-cat-00000001', pg_temp.h('cr')),
  pg_temp.got('cr'), 'repetir devolve a mesma categoria');
select is(pg_temp.err(format($$ select public.accounts_category_save(%L, null, null, 'expense', 'aluguel do salão', 'rent', true, 'idem-fa-cat-00000003', %L) $$,
  (select tenant_a from ids), pg_temp.h('c3'))), 'PT422/POLICY_REJECTED/name', 'nome repetido no mesmo tipo');
select is(pg_temp.err(format($$ select public.accounts_category_save(%L, null, null, 'expense', 'Outra', 'rent', true, 'idem-fa-cat-00000001', %L) $$,
  (select tenant_a from ids), pg_temp.h('outra'))), 'PT409/IDEMPOTENCY_MISMATCH/-', 'mesma chave com outro conteúdo');

-- ------------------------------------------------------------------ contas a pagar: única e mensal
insert into r select 'p1', public.accounts_payable_save((select tenant_a from ids), null, null, 'Aluguel de novembro', 150000, (select today from ids),
  'other', pg_temp.id('cr', '{body,category,id}'), 'Imobiliária', false, 'idem-fa-pay-00000001', pg_temp.h('p1'));
select is(pg_temp.got('p1')->'body'->'payable'->>'base_category', 'rent', 'a categoria própria decide a do Caixa');
select is(pg_temp.got('p1')->'body'->'payable'->>'status', 'open', 'vence hoje: em aberto');
insert into r select 'sr', public.accounts_payable_save((select tenant_a from ids), null, null, 'Internet', 12000, ((select month1 from ids) + 9),
  'utilities', null, null, true, 'idem-fa-pay-00000002', pg_temp.h('sr'));
select is((pg_temp.got('sr')->'body'->>'created')::int, 12, 'mensal: 12 contas, uma por mês');
select is(pg_temp.err(format($$ select public.accounts_payable_save(%L, null, null, 'Luz', 9000, %L, 'utilities', null, null, true, 'idem-fa-pay-00000003', %L) $$,
  (select tenant_a from ids), (select month1 from ids) + 29, pg_temp.h('p3'))), 'PT400/VALIDATION_ERROR/due_on', 'recorrente vence até o dia 28');
insert into r select 'p1e', public.accounts_payable_save((select tenant_a from ids), pg_temp.id('p1', '{body,payable,id}'), 1, 'Aluguel de novembro', 160000,
  (select today from ids), 'other', pg_temp.id('cr', '{body,category,id}'), 'Imobiliária', false, 'idem-fa-pay-00000004', pg_temp.h('p1e'));
select is((pg_temp.got('p1e')->'body'->'payable'->>'amount_cents')::bigint, 160000::bigint, 'conta em aberto pode ser corrigida');

-- ------------------------------------------------------------------ pagar: uma despesa; pagar de novo não baixa de novo
insert into r select 'pay', public.accounts_payable_pay((select tenant_a from ids), pg_temp.id('p1', '{body,payable,id}'), 2, now(), 'idem-fa-paid-0000001', pg_temp.h('pay'));
select is(pg_temp.got('pay')->'body'->'payable'->>'status', 'paid', 'conta paga');
select is(public.accounts_payable_pay((select tenant_a from ids), pg_temp.id('p1', '{body,payable,id}'), 2, now(), 'idem-fa-paid-0000001', pg_temp.h('pay')),
  pg_temp.got('pay'), 'repetir o pagamento devolve a mesma resposta');
select is(pg_temp.err(format($$ select public.accounts_payable_pay(%L, %L, %s, now(), 'idem-fa-paid-0000002', %L) $$, (select tenant_a from ids),
  pg_temp.id('p1', '{body,payable,id}'), pg_temp.ver(pg_temp.id('p1', '{body,payable,id}')), pg_temp.h('pay2'))), 'PT422/POLICY_REJECTED/paid', 'pagar de novo é recusado');
select is(pg_temp.err(format($$ select public.accounts_payable_pay(%L, %L, 2, now(), 'idem-fa-paid-0000003', %L) $$, (select tenant_a from ids),
  pg_temp.id('p1', '{body,payable,id}'), pg_temp.h('pay3'))), 'PT409/STALE_VERSION/-', 'quem viu "em aberto" não paga com a versão antiga');
select is(pg_temp.err(format($$ select public.accounts_payable_save(%L, %L, %s, 'x', 1, %L, 'rent', null, null, false, 'idem-fa-pay-00000005', %L) $$,
  (select tenant_a from ids), pg_temp.id('p1', '{body,payable,id}'), pg_temp.ver(pg_temp.id('p1', '{body,payable,id}')), (select today from ids), pg_temp.h('p5'))),
  'PT422/POLICY_REJECTED/status', 'conta paga não muda');
reset role;
select is((select count(*)::int from public.expense_entries where description = 'Aluguel de novembro' and reversal_of is null), 1, 'uma despesa no Caixa');
select is((select amount_cents || '/' || category from public.expense_entries where description = 'Aluguel de novembro'), '160000/rent', 'pelo valor e na categoria do Caixa');
select is((select count(*)::int from public.fin_classifications where expense_entry_id = (select expense_entry_id from public.fin_payable_payments)), 1,
  'despesa já classificada na categoria própria');

-- ------------------------------------------------------------------ estorno uma vez; pagar de novo depois do estorno
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rev', public.accounts_payable_reverse((select tenant_a from ids), pg_temp.id('p1', '{body,payable,id}'),
  pg_temp.ver(pg_temp.id('p1', '{body,payable,id}')), 'idem-fa-rev-00000001', pg_temp.h('rev'));
select is(pg_temp.got('rev')->'body'->'payable'->>'status', 'open', 'estornada: volta a ficar em aberto');
select is((pg_temp.got('rev')->'body'->'payable'->>'reversals')::int, 1, 'um estorno registrado');
select is(pg_temp.err(format($$ select public.accounts_payable_reverse(%L, %L, %s, 'idem-fa-rev-00000002', %L) $$, (select tenant_a from ids),
  pg_temp.id('p1', '{body,payable,id}'), pg_temp.ver(pg_temp.id('p1', '{body,payable,id}')), pg_temp.h('rev2'))), 'PT422/POLICY_REJECTED/not_paid', 'sem pagamento vivo, nada a estornar');
insert into r select 'pay4', public.accounts_payable_pay((select tenant_a from ids), pg_temp.id('p1', '{body,payable,id}'),
  pg_temp.ver(pg_temp.id('p1', '{body,payable,id}')), now(), 'idem-fa-paid-0000004', pg_temp.h('pay4'));
select is(pg_temp.got('pay4')->'body'->'payable'->>'status', 'paid', 'depois do estorno pode pagar de novo');
reset role;
select is((select count(*)::int from public.expense_entries e where e.description = 'Aluguel de novembro' and e.reversal_of is null
  and not exists (select 1 from public.expense_entries x where x.reversal_of = e.id)), 1, 'uma despesa viva no Caixa (a outra foi estornada)');
select is((select count(*)::int from public.fin_payable_payments where reversal_expense_id is null), 1, 'um pagamento vivo');
select throws_ok($$ update public.fin_payable_payments set amount_cents = 1 $$, 'PT403', 'FORBIDDEN', 'pagamento não se edita');

-- ------------------------------------------------------------------ cancelar e encerrar série
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.accounts_payable_cancel(%L, %L, %s, 'idem-fa-can-00000001', %L) $$, (select tenant_a from ids),
  pg_temp.id('p1', '{body,payable,id}'), pg_temp.ver(pg_temp.id('p1', '{body,payable,id}')), pg_temp.h('can1'))), 'PT422/POLICY_REJECTED/status', 'paga não cancela');
insert into r select 'end', public.accounts_series_update((select tenant_a from ids), pg_temp.id('sr', '{body,series,id}'), (pg_temp.got('sr')->'body'->'series'->>'version')::int, 'end', 'idem-fa-ser-00000001', pg_temp.h('end'));
select is((pg_temp.got('end')->'body'->>'affected')::int,
  (select count(*)::int from public.fin_payables where series_id = pg_temp.id('sr', '{body,series,id}') and status = 'cancelled'), 'contas futuras canceladas');
select is(pg_temp.got('end')->'body'->'series'->>'active', 'false', 'série encerrada');
select is(pg_temp.err(format($$ select public.accounts_series_update(%L, %L, %s, 'extend', 'idem-fa-ser-00000002', %L) $$, (select tenant_a from ids),
  pg_temp.id('sr', '{body,series,id}'), (pg_temp.got('end')->'body'->'series'->>'version')::int, pg_temp.h('ext'))), 'PT422/POLICY_REJECTED/status', 'encerrada não estende');
insert into r select 'pl', public.accounts_payables((select tenant_a from ids), (select month1 from ids), (select month1 from ids) + 400);
select ok(jsonb_array_length(pg_temp.got('pl')->'payables') >= 13, 'lista com a conta única e as da série');

-- ------------------------------------------------------------------ classificação de recebimento
insert into r select 'cl', public.accounts_classify((select tenant_a from ids), 'payment', '7a000000-0000-4000-8000-000000000001', pg_temp.id('ci', '{body,category,id}'),
  'idem-fa-cls-00000001', pg_temp.h('cl'));
select is(pg_temp.got('cl')->'body'->>'category_id', pg_temp.id('ci', '{body,category,id}')::text, 'recebimento classificado em Cursos');
select is(pg_temp.err(format($$ select public.accounts_classify(%L, 'payment', '7a000000-0000-4000-8000-000000000002', %L, 'idem-fa-cls-00000002', %L) $$,
  (select tenant_a from ids), pg_temp.id('cr', '{body,category,id}'), pg_temp.h('cl2'))), 'PT404/NOT_FOUND/category_id', 'receita não usa categoria de despesa');

insert into r select 'en', public.accounts_entries((select tenant_a from ids), (select today from ids));
select is((select x->>'category_id' from jsonb_array_elements(pg_temp.got('en')->'entries') x where x->>'entry_id' = '7a000000-0000-4000-8000-000000000001'),
  pg_temp.id('ci', '{body,category,id}')::text, 'lançamentos do mês com a categoria própria');

-- ------------------------------------------------------------------ conciliação por meio e origem
insert into r select 'rc', public.accounts_reconciliation((select tenant_a from ids), (select today from ids));
select is((select jsonb_agg(jsonb_build_object('m', x->>'method', 's', x->>'source', 'l', (x->>'ledger_cents')::int) order by x->>'source', x->>'method')
  from jsonb_array_elements(pg_temp.got('rc')->'rows') x),
  '[{"m": "cash", "s": "manual", "l": 4000}, {"m": "pix", "s": "manual", "l": 6000}, {"m": "pix", "s": "provider", "l": 5000}]'::jsonb, 'registrado por meio e origem');
select is((select (x->>'partner_paid_cents')::int from jsonb_array_elements(pg_temp.got('rc')->'rows') x where x->>'source' = 'provider'), 5000,
  'parceiro (PSP simulado): pago segundo o provedor');
insert into r select 'rs', public.accounts_reconcile_save((select tenant_a from ids), (select today from ids), 'pix', 'manual', 5500, 'idem-fa-rec-00000001', pg_temp.h('rs'));
select is((pg_temp.got('rs')->'body'->'reconciliation'->>'difference_cents')::int, -500, 'extrato com R$ 5 a menos: diferença');
select is(pg_temp.err(format($$ select public.accounts_reconcile_save(%L, %L, 'pix', 'manual', 1, 'idem-fa-rec-00000002', %L) $$, (select tenant_a from ids),
  (select today from ids) + 1, pg_temp.h('rs2'))), 'PT400/VALIDATION_ERROR/day', 'não confere dia futuro');
insert into r select 'rs3', public.accounts_reconcile_save((select tenant_a from ids), (select today from ids), 'pix', 'manual', 6000, 'idem-fa-rec-00000003', pg_temp.h('rs3'));
insert into r select 'rc2', public.accounts_reconciliation((select tenant_a from ids), (select today from ids));
select is((select (x->'statement'->>'difference_cents')::int from jsonb_array_elements(pg_temp.got('rc2')->'rows') x where x->>'method' = 'pix' and x->>'source' = 'manual'), 0,
  'a última conferência vale');

-- ------------------------------------------------------------------ demonstrativo do mês (caixa)
insert into r select 'st', public.accounts_statement((select tenant_a from ids), (select today from ids));
select is(pg_temp.got('st')->>'basis', 'cash', 'regime de caixa');
select is(pg_temp.got('st')->'period'->>'first_day', to_char((select month1 from ids), 'YYYY-MM-DD'), 'período escrito: primeiro dia');
select is(pg_temp.got('st')->'period'->>'timezone', 'America/Sao_Paulo', 'no fuso do negócio');
select is((pg_temp.got('st')->>'in_cents')::bigint, 15000::bigint, 'entrou: 60 + 40 + 50');
select is((pg_temp.got('st')->>'out_cents')::bigint, 160000::bigint, 'saiu: o aluguel uma vez (o estornado não conta)');
select is((pg_temp.got('st')->>'net_cents')::bigint, -145000::bigint, 'sobrou: entrou − saiu');
select is((select jsonb_object_agg(x->>'label', (x->>'cents')::int) from jsonb_array_elements(pg_temp.got('st')->'income') x),
  '{"Cursos": 6000, "Outras receitas": 9000}'::jsonb, 'receitas por categoria (própria e por origem)');
select is((select jsonb_object_agg(x->>'label', (x->>'cents')::int) from jsonb_array_elements(pg_temp.got('st')->'expenses') x),
  '{"Aluguel do salão": 160000}'::jsonb, 'despesas por categoria própria');
select is((pg_temp.got('st')->'coverage'->>'days_unreconciled')::int, 1, 'cobertura: hoje ainda tem meio sem conferência');
select ok((pg_temp.got('st')->'coverage'->>'unclassified_entries')::int >= 2, 'cobertura: lançamentos sem categoria própria');
select ok((pg_temp.got('st')->'coverage') ? 'uncharged_bookings' and (pg_temp.got('st')->'coverage') ? 'fiscal_authorized', 'cobertura com atendimentos sem cobrança e notas');
select ok(pg_temp.got('st')->>'note' ~ 'Não é DRE', 'diz que não é DRE');

-- ------------------------------------------------------------------ isolamento e privacidade
select pg_temp.login_as((select owner_b from ids));
select throws_ok(format($$ select public.accounts_statement(%L, now()::date) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não vê o demonstrativo de A');
select throws_ok(format($$ select public.accounts_payable_pay(%L, %L, 9, now(), 'idem-fa-b-0000000001', %L) $$, (select tenant_a from ids),
  pg_temp.id('p1', '{body,payable,id}'), pg_temp.h('b')), 'PT403', 'FORBIDDEN', 'B não paga conta de A');
select is(pg_temp.err(format($$ select public.accounts_payable_pay(%L, %L, 9, now(), 'idem-fa-b-0000000002', %L) $$, (select tenant_b from ids),
  pg_temp.id('p1', '{body,payable,id}'), pg_temp.h('b2'))), 'PT404/NOT_FOUND/-', 'nem pelo próprio negócio');
select is(pg_temp.err(format($$ select public.accounts_classify(%L, 'payment', '7a000000-0000-4000-8000-000000000001', null, 'idem-fa-b-0000000003', %L) $$,
  (select tenant_b from ids), pg_temp.h('b3'))), 'PT404/NOT_FOUND/entry_id', 'nem classifica lançamento de A');
select is((select count(*)::int from public.fin_payables) + (select count(*)::int from public.fin_categories) + (select count(*)::int from public.fin_reconciliations), 0,
  'RLS: B não vê nada');
select pg_temp.login_as((select customer_ab from ids));
select is((select count(*)::int from public.fin_payables) + (select count(*)::int from public.fin_payable_payments), 0, 'cliente com login não lê');
reset role;
select is((select count(*)::int from public.audit_events where action like 'accounts.%' and coalesce(after::text, '') ~ 'Imobiliária|Aluguel de novembro'), 0,
  'auditoria sem fornecedor nem descrição');

select * from finish();
rollback;

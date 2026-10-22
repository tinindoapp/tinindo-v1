-- P14 · Pagamento conectado: cobrança pelo saldo do recebível (uma viva por recebível), baixa só com evidência do
-- provedor (webhook ou consulta), notificação repetida não dá baixa duas vezes, resultado desconhecido consultado,
-- estorno vinculado ao recebimento, conciliação com diferenças listadas, link público por token, isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.ev(p_id text, p_kind text, p_ext text, p_cents bigint) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('external_event_id', p_id, 'kind', p_kind, 'external_id', p_ext, 'amount_cents', p_cents, 'paid_at', now())) $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.ev(text, text, text, bigint) to anon, authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'payment_%'), 'RLS ligada em pagamentos');
select ok(not has_table_privilege('authenticated', 'public.payment_webhook_events', 'select'), 'eventos de webhook fora da Data API');
select ok(not has_table_privilege('authenticated', 'public.payment_sim_ledger', 'select'), 'livro do PSP simulado fora da Data API');
select ok(not has_function_privilege('authenticated', 'public.payment_webhook_ingest(text, jsonb)', 'execute'), 'ingestão só do backend');
select ok(not has_function_privilege('authenticated', 'public.payment_charge_result(uuid, text, text, text, text, timestamptz, text)', 'execute'), 'resultado do provedor só do backend');
select ok(not has_table_privilege('authenticated', 'public.payment_entries', 'insert'), 'dono não grava recebimento direto');

-- ------------------------------------------------------------------ recebível e cobrança
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rec', public.finance_receivable_create((select tenant_a from ids), (select ana from ids), 'Corte', 6000, null, 'idem-pay-rec-000001', pg_temp.h('rec'));
insert into r select 'c1', public.payment_charge_create((select tenant_a from ids), (pg_temp.got('rec')->'body'->'receivable'->>'id')::uuid, 'simulated', 'idem-pay-charge-00001', pg_temp.h('c1'));
select is(pg_temp.got('c1')->'body'->'charge'->>'status', 'creating', 'cobrança nasce em creating (o provedor ainda não respondeu)');
select is((pg_temp.got('c1')->'body'->'charge'->>'amount_cents')::bigint, 6000::bigint, 'valor = saldo em aberto');
select ok(pg_temp.got('c1')->'body'->>'link_token' ~ '^[A-Za-z0-9_-]{43}$', 'token do link devolvido uma vez');
select is(public.payment_charge_create((select tenant_a from ids), (pg_temp.got('rec')->'body'->'receivable'->>'id')::uuid, 'simulated', 'idem-pay-charge-00001', pg_temp.h('c1')),
  pg_temp.got('c1'), 'repetir devolve a mesma cobrança e o mesmo token');
select throws_ok(format($$ select public.payment_charge_create(%L, %L, 'simulated', 'idem-pay-charge-00002', %L) $$,
  (select tenant_a from ids), pg_temp.got('rec')->'body'->'receivable'->>'id', pg_temp.h('c2')), 'PT422', 'POLICY_REJECTED', 'uma cobrança viva por recebível');
select throws_ok(format($$ select public.payment_charge_create(%L, %L, 'bitcoin', 'idem-pay-charge-00003', %L) $$,
  (select tenant_a from ids), pg_temp.got('rec')->'body'->'receivable'->>'id', pg_temp.h('c3')), 'PT400', 'VALIDATION_ERROR', 'provedor desconhecido');
select is((select count(*) from public.payment_charges where link_token_hash = pg_temp.got('c1')->'body'->>'link_token'), 0::bigint, 'token em claro não fica no banco');
reset role;

-- Provedor respondeu: pendente, com Pix e validade.
insert into r select 'cr', public.payment_charge_result((pg_temp.got('c1')->'body'->'charge'->>'id')::uuid, 'pending', 'sim-ch-1', '00020126pix-simulado', null, now() + interval '1 hour', null);
select is(pg_temp.got('cr')->'charge'->>'status', 'pending', 'pendente com id do provedor');
select is(public.payment_charge_result((pg_temp.got('c1')->'body'->'charge'->>'id')::uuid, 'failed', null, null, null, null, 'x')->>'status', 'ignored',
  'resultado tardio sobre cobrança já pendente é ignorado');
select is(public.payment_charge_result((pg_temp.got('c1')->'body'->'charge'->>'id')::uuid, 'failed', null, null, null, null, 'x')->'charge'->>'status', 'pending',
  'e devolve o estado atual');

-- Link público
set local role anon;
insert into r select 'lv', public.payment_link_view(pg_temp.got('c1')->'body'->>'link_token');
select is(pg_temp.got('lv')->>'pix_code', '00020126pix-simulado', 'link público mostra o Pix');
select is(pg_temp.got('lv')->>'status', 'pending', 'e o estado');
select ok(pg_temp.got('lv') ? 'business_name', 'e o nome do negócio');
select throws_ok(format($$ select public.payment_link_view(%L) $$, repeat('x', 43)), 'PT404', 'NOT_FOUND', 'token errado = não existe');
reset role;

-- ------------------------------------------------------------------ webhook: baixa única
reset role;
insert into r select 'w1', public.payment_webhook_ingest('simulated', pg_temp.ev('evt-1', 'charge.paid', 'sim-ch-1', 6000));
select is(pg_temp.got('w1'), '{"applied": 1, "duplicates": 0}'::jsonb, 'pago aplicado');
insert into r select 'w2', public.payment_webhook_ingest('simulated', pg_temp.ev('evt-1', 'charge.paid', 'sim-ch-1', 6000));
select is(pg_temp.got('w2'), '{"applied": 0, "duplicates": 1}'::jsonb, 'mesma notificação = duplicada');
insert into r select 'w3', public.payment_webhook_ingest('simulated', pg_temp.ev('evt-2', 'charge.paid', 'sim-ch-1', 6000));
select is(pg_temp.got('w3'), '{"applied": 0, "duplicates": 0}'::jsonb, 'segundo "pago" com outro id não aplica de novo');
select is((select outcome from public.payment_webhook_events where external_event_id = 'evt-2'), 'already_settled', 'registrado como já baixado');
reset role;
select is((select count(*) from public.payment_entries where charge_id = (pg_temp.got('c1')->'body'->'charge'->>'id')::uuid), 1::bigint, 'UM recebimento');
select is((select source from public.payment_entries where charge_id = (pg_temp.got('c1')->'body'->'charge'->>'id')::uuid), 'provider', 'com origem no provedor');
select is((select status from public.receivables where id = (pg_temp.got('rec')->'body'->'receivable'->>'id')::uuid), 'paid', 'recebível pago');
select is((select paid_cents from public.receivables where id = (pg_temp.got('rec')->'body'->'receivable'->>'id')::uuid), 6000::bigint, 'sem dobrar o valor');
select is((select count(*) from public.outbox_events where event_type = 'payment.recorded.v1' and (payload->>'charge_id') is not null), 1::bigint, 'um evento payment.recorded.v1');
select is((select status from public.payment_charges where external_id = 'sim-ch-1'), 'paid', 'cobrança paga');
reset role;
select is(public.payment_webhook_ingest('simulated', pg_temp.ev('evt-3', 'charge.expired', 'sim-ch-1', null))->>'applied', '0', 'expirado depois de pago não volta');
select is(public.payment_webhook_ingest('simulated', pg_temp.ev('evt-4', 'charge.paid', 'sim-ch-nao-existe', 100))->>'applied', '0', 'cobrança desconhecida não cria nada');
select is((select outcome from public.payment_webhook_events where external_event_id = 'evt-4'), 'unmatched_charge', 'registrada como sem correspondência');
reset role;

-- ------------------------------------------------------------------ desconhecido e consulta
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rec2', public.finance_receivable_create((select tenant_a from ids), null, 'Barba', 4000, null, 'idem-pay-rec-000002', pg_temp.h('rec2'));
insert into r select 'c2', public.payment_charge_create((select tenant_a from ids), (pg_temp.got('rec2')->'body'->'receivable'->>'id')::uuid, 'simulated', 'idem-pay-charge-00004', pg_temp.h('c2'));
reset role;
reset role;
select is(public.payment_charge_result((pg_temp.got('c2')->'body'->'charge'->>'id')::uuid, 'unknown', null, null, null, null, null)->'charge'->>'status', 'unknown',
  'sem resposta do provedor: desconhecido, não presumido pago nem falho');
select is(jsonb_array_length(public.payment_sync_claim(50)->'items'), 0, 'desconhecido recente ainda não entra na consulta');
update public.payment_charges set unknown_since = now() - interval '2 minutes' where id = (pg_temp.got('c2')->'body'->'charge'->>'id')::uuid;
select is(jsonb_array_length(public.payment_sync_claim(50)->'items'), 1, 'depois de 1 min entra na consulta');
select is(public.payment_sync_result((pg_temp.got('c2')->'body'->'charge'->>'id')::uuid, null, null, null, null)->>'outcome', 'still_unknown', 'consulta sem resposta: continua desconhecido');
select is(public.payment_sync_result((pg_temp.got('c2')->'body'->'charge'->>'id')::uuid, 'paid', 4000, now(), 'sim-ch-2')->>'outcome', 'entry', 'consulta diz pago: baixa');
select is(public.payment_sync_result((pg_temp.got('c2')->'body'->'charge'->>'id')::uuid, 'paid', 4000, now(), 'sim-ch-2')->>'outcome', 'already_settled', 'consulta repetida não dobra');
reset role;
select is((select count(*) from public.payment_entries where charge_id = (pg_temp.got('c2')->'body'->'charge'->>'id')::uuid), 1::bigint, 'um recebimento pela consulta');
select is((select status from public.receivables where id = (pg_temp.got('rec2')->'body'->'receivable'->>'id')::uuid), 'paid', 'recebível 2 pago');

-- ------------------------------------------------------------------ estorno vinculado
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.payment_refund_request(%L, gen_random_uuid(), 'x', 'idem-pay-refund-00000', %L) $$,
  (select tenant_a from ids), pg_temp.h('f0')), 'PT404', 'NOT_FOUND', 'estorno de cobrança inexistente');
insert into r select 'f1', public.payment_refund_request((select tenant_a from ids), (pg_temp.got('c2')->'body'->'charge'->>'id')::uuid, 'cliente desistiu', 'idem-pay-refund-00001', pg_temp.h('f1'));
select is(pg_temp.got('f1')->'body'->'refund'->>'status', 'requested', 'estorno pedido, não concluído');
select is((pg_temp.got('f1')->'body'->'refund'->>'amount_cents')::bigint, 4000::bigint, 'estorno total');
select throws_ok(format($$ select public.payment_refund_request(%L, %L, 'de novo', 'idem-pay-refund-00002', %L) $$,
  (select tenant_a from ids), pg_temp.got('c2')->'body'->'charge'->>'id', pg_temp.h('f2')), 'PT422', 'POLICY_REJECTED', 'um estorno por cobrança');
reset role;
select is((select status from public.receivables where id = (pg_temp.got('rec2')->'body'->'receivable'->>'id')::uuid), 'paid', 'pedido de estorno não mexe no caixa');
reset role;
select is(public.payment_refund_result((pg_temp.got('f1')->'body'->'refund'->>'id')::uuid, 'done', 'sim-rf-1', null)->>'outcome', 'done', 'PSP confirmou o estorno');
select is(public.payment_refund_result((pg_temp.got('f1')->'body'->'refund'->>'id')::uuid, 'done', 'sim-rf-1', null)->>'outcome', 'already_done', 'confirmação repetida não dobra');
select is(public.payment_webhook_ingest('simulated', pg_temp.ev('evt-5', 'refund.done', 'sim-ch-2', 4000))->>'applied', '0', 'webhook de estorno já concluído não aplica de novo');
reset role;
select is((select count(*) from public.payment_entries where charge_id = (pg_temp.got('c2')->'body'->'charge'->>'id')::uuid and reversal_of is not null), 1::bigint,
  'uma linha de reversão vinculada ao recebimento');
select is((select status from public.receivables where id = (pg_temp.got('rec2')->'body'->'receivable'->>'id')::uuid), 'open', 'recebível volta a aberto');
select is((select refund_status from public.payment_charges where id = (pg_temp.got('c2')->'body'->'charge'->>'id')::uuid), 'done', 'cobrança marca estorno concluído');

-- ------------------------------------------------------------------ cancelar, pago depois de cancelado, conciliação
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rec3', public.finance_receivable_create((select tenant_a from ids), null, 'Produto', 2500, null, 'idem-pay-rec-000003', pg_temp.h('rec3'));
insert into r select 'c3', public.payment_charge_create((select tenant_a from ids), (pg_temp.got('rec3')->'body'->'receivable'->>'id')::uuid, 'simulated', 'idem-pay-charge-00005', pg_temp.h('c3'));
reset role;
reset role;
insert into r select 'cr3', public.payment_charge_result((pg_temp.got('c3')->'body'->'charge'->>'id')::uuid, 'pending', 'sim-ch-3', 'pix3', null, now() + interval '1 hour', null);
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.payment_charge_cancel(%L, %L, 99, 'idem-pay-cancel-00001', %L) $$,
  (select tenant_a from ids), pg_temp.got('c3')->'body'->'charge'->>'id', pg_temp.h('x1')), 'PT409', 'STALE_VERSION', 'cancelar exige a versão vista');
insert into r select 'x1', public.payment_charge_cancel((select tenant_a from ids), (pg_temp.got('c3')->'body'->'charge'->>'id')::uuid, 2, 'idem-pay-cancel-00002', pg_temp.h('x1'));
select is(pg_temp.got('x1')->'body'->'charge'->>'status', 'cancelled', 'cobrança cancelada');
-- Cancela também o recebível; o PSP ainda avisa "pago" (cliente pagou antes de ver o cancelamento).
insert into r select 'rcx', public.finance_receivable_cancel((select tenant_a from ids), (pg_temp.got('rec3')->'body'->'receivable'->>'id')::uuid, 1, 'idem-pay-reccancel-0001', pg_temp.h('rcx'));
reset role;
reset role;
select is(public.payment_webhook_ingest('simulated', pg_temp.ev('evt-6', 'charge.paid', 'sim-ch-3', 2500))->>'applied', '1', 'pagamento depois do cancelamento é registrado na cobrança');
reset role;
select is((select settlement from public.payment_charges where external_id = 'sim-ch-3'), 'receivable_cancelled', 'mas sem baixa: recebível cancelado');
select is((select count(*) from public.payment_entries where charge_id = (pg_temp.got('c3')->'body'->'charge'->>'id')::uuid), 0::bigint, 'nenhum recebimento criado');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rc', public.payment_reconcile((select tenant_a from ids), 'simulated', (now() at time zone 'America/Sao_Paulo')::date,
  jsonb_build_array(
    jsonb_build_object('external_id', 'sim-ch-1', 'status', 'paid', 'amount_cents', 6000, 'paid_at', now()),
    jsonb_build_object('external_id', 'sim-ch-3', 'status', 'paid', 'amount_cents', 2500, 'paid_at', now()),
    jsonb_build_object('external_id', 'sim-ch-fantasma', 'status', 'paid', 'amount_cents', 100, 'paid_at', now())),
  'idem-pay-reconcile-0001', pg_temp.h('rc'));
select is((pg_temp.got('rc')->'body'->'reconciliation'->>'report_paid_cents')::bigint, 8600::bigint, 'PSP diz 8.600');
select is((pg_temp.got('rc')->'body'->'reconciliation'->>'ledger_paid_cents')::bigint, 6000::bigint, 'banco tem 6.000 do provedor no dia (o recebimento estornado de sim-ch-2 fica fora)');
select is((select jsonb_agg(d->>'kind' order by d->>'kind') from jsonb_array_elements(pg_temp.got('rc')->'body'->'reconciliation'->'differences') d),
  '["paid_without_entry", "unknown_charge"]'::jsonb, 'diferenças listadas: sim-ch-3 paga sem baixa e cobrança fantasma; o estorno de sim-ch-2 não é diferença');
select is(jsonb_array_length(public.payment_reconciliations_list((select tenant_a from ids))->'reconciliations'), 1, 'conciliação listada');
select is(jsonb_array_length(public.payment_charges_list((select tenant_a from ids))->'charges'), 3, 'três cobranças do negócio');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.payment_charges_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não lista cobranças de A');
select throws_ok(format($$ select public.payment_refund_request(%L, %L, 'x', 'idem-pay-refund-b-0001', %L) $$,
  (select tenant_a from ids), pg_temp.got('c1')->'body'->'charge'->>'id', pg_temp.h('fb')), 'PT403', 'FORBIDDEN', 'B não estorna cobrança de A');
select is((select count(*) from public.payment_charges), 0::bigint, 'RLS: B não vê cobranças de A');
select is((select count(*) from public.payment_reconciliations), 0::bigint, 'RLS: B não vê conciliações de A');
reset role;
select is((select count(*) from public.audit_events where action like 'payment.%' and (coalesce(after::text, '') like '%pix-simulado%' or coalesce(after::text, '') like '%Corte%')), 0::bigint,
  'auditoria sem Pix nem descrição');

select * from finish();
rollback;

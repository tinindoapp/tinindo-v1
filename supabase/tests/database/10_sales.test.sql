-- P11 · Orçamentos e aceite: snapshot versionado com hash, total do servidor, link por token (ver ≠ aceitar),
-- aceite idempotente vinculado a versão + hash + validade, revalidação do horário pela agenda, aceito ≠ pago,
-- recusa, cancelamento, expiração e isolamento entre negócios.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000a2'::uuid as barba_a,
  '40000000-0000-4000-8000-0000000000b1'::uuid as treino_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '30000000-0000-4000-8000-0000000000a2'::uuid as bruno,
  '30000000-0000-4000-8000-0000000000b1'::uuid as cust_b;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.at(p_days integer, p_hhmm text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + p_days) + p_hhmm::time)
         at time zone 'America/Sao_Paulo'
$$;
/** Corte (R$60) + barba (R$40). */
create function pg_temp.items() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('service_id', (select corte_a from ids), 'description', 'Corte', 'quantity', 1, 'unit_price_cents', 6000,
      'line_total_cents', 1),
    jsonb_build_object('service_id', (select barba_a from ids), 'description', 'Barba', 'quantity', 1, 'unit_price_cents', 4000))
$$;
create function pg_temp.q(p_k text) returns uuid language sql as $$ select (v->'body'->'quote'->>'id')::uuid from r where k = p_k $$;
create function pg_temp.cur(p_k text) returns jsonb language sql as $$ select v->'body'->'quote'->'current' from r where k = p_k $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.at(integer, text), pg_temp.items(), pg_temp.q(text),
  pg_temp.cur(text) to anon, authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('sales_quotes', 'sales_quote_versions', 'sales_quote_decisions')),
  'RLS ligada nos orçamentos');
select ok(not has_column_privilege('authenticated', 'public.sales_quotes', 'token_hash', 'select'), 'hash do token não é legível');
select ok(not has_table_privilege('authenticated', 'public.sales_quote_versions', 'insert'), 'authenticated não grava versão direto');
select ok(not has_function_privilege('anon',
  'public.sales_quote_create(uuid, uuid, text, jsonb, timestamptz, uuid, timestamptz, text, text, text, uuid)', 'execute'),
  'anon não cria orçamento');
select ok(has_function_privilege('anon', 'public.sales_quote_accept(text, integer, text)', 'execute'), 'aceite pelo link é anônimo');

-- ------------------------------------------------------------------ dono A: expediente e criação
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rules', public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  (select jsonb_agg(jsonb_build_object('weekday', d, 'local_start', '09:00', 'local_end', '19:00')) from generate_series(1, 5) d),
  'idem-qt-rules-0001', pg_temp.h('rules'));

insert into r select 'q1', public.sales_quote_create((select tenant_a from ids), (select ana from ids), 'Corte e barba',
  pg_temp.items(), now() + interval '7 days', (select corte_a from ids), pg_temp.at(1, '10:00'), 'Inclui lavagem',
  'idem-qt-create-q1-01', pg_temp.h('q1'));
select is((pg_temp.got('q1')->>'status_code')::int, 201, 'orçamento criado');
select is(pg_temp.got('q1')->'body'->'quote'->>'status', 'draft', 'começa como rascunho');
select is((pg_temp.cur('q1')->>'total_cents')::bigint, 10000::bigint, 'total calculado pelo servidor (R$100)');
select is((pg_temp.cur('q1')->'items'->0->>'line_total_cents')::bigint, 6000::bigint, 'total da linha ignora o valor enviado');
select ok(pg_temp.cur('q1')->>'snapshot_hash' ~ '^[0-9a-f]{64}$', 'versão tem hash do snapshot');
select is(pg_temp.cur('q1')->'slot'->>'ends_at', to_char(pg_temp.at(1, '10:30') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'fim do horário = início + duração do serviço');
select is(public.sales_quote_create((select tenant_a from ids), (select ana from ids), 'Corte e barba',
  pg_temp.items(), (pg_temp.cur('q1')->>'valid_until')::timestamptz, (select corte_a from ids), pg_temp.at(1, '10:00'),
  'Inclui lavagem', 'idem-qt-create-q1-01', pg_temp.h('q1')), pg_temp.got('q1'), 'repetição devolve o mesmo orçamento');
select is((select count(*)::int from public.sales_quotes), 1, 'repetir não cria outro');
select throws_ok(format($$ select public.sales_quote_create(%L, %L, 'Outro', %L, now() + interval '7 days', null, null, null,
  'idem-qt-create-q1-01', %L) $$, (select tenant_a from ids), (select ana from ids), pg_temp.items(), pg_temp.h('outro')),
  'PT409', 'IDEMPOTENCY_MISMATCH', 'mesma chave com outro conteúdo → 409');

select throws_ok(format($$ select public.sales_quote_create(%L, %L, 'X', %L, now() + interval '7 days', null, null, null,
  'idem-qt-cust-b-0001', %L) $$, (select tenant_a from ids), (select cust_b from ids), pg_temp.items(), pg_temp.h('cb')),
  'PT404', 'NOT_FOUND', 'cliente de outro negócio não entra no orçamento');
select throws_ok(format($$ select public.sales_quote_create(%L, %L, 'X', %L, now() + interval '7 days', null, null, null,
  'idem-qt-svc-b-00001', %L) $$, (select tenant_a from ids), (select ana from ids),
  jsonb_build_array(jsonb_build_object('service_id', (select treino_b from ids), 'description', 'Treino', 'quantity', 1,
    'unit_price_cents', 100)), pg_temp.h('sb')),
  'PT404', 'NOT_FOUND', 'serviço de outro negócio não entra no orçamento');
select throws_ok(format($$ select public.sales_quote_create(%L, %L, 'X', %L, now() + interval '7 days', %L, %L, null,
  'idem-qt-slot-svc-01', %L) $$, (select tenant_a from ids), (select ana from ids),
  jsonb_build_array(jsonb_build_object('service_id', (select barba_a from ids), 'description', 'Barba', 'quantity', 1,
    'unit_price_cents', 4000)), (select corte_a from ids), pg_temp.at(1, '11:00'), pg_temp.h('ss')),
  'PT400', 'VALIDATION_ERROR', 'horário só de serviço que está no orçamento');
select throws_ok(format($$ select public.sales_quote_create(%L, %L, 'X', %L, now() + interval '7 days', %L, %L, null,
  'idem-qt-sunday-001', %L) $$, (select tenant_a from ids), (select ana from ids), pg_temp.items(), (select corte_a from ids),
  pg_temp.at(6, '10:00'), pg_temp.h('sun')),
  'PT409', 'SLOT_CONFLICT', 'não propõe horário fora do expediente');
select throws_ok(format($$ select public.sales_quote_create(%L, %L, 'X', %L, now() + interval '120 days', null, null, null,
  'idem-qt-valid-0001', %L) $$, (select tenant_a from ids), (select ana from ids), pg_temp.items(), pg_temp.h('v120')),
  'PT400', 'VALIDATION_ERROR', 'validade máxima de 90 dias');
select throws_ok(format($$ select public.sales_quote_create(%L, %L, 'X', '[{"description":"Serviço","quantity":0,"unit_price_cents":10}]',
  now() + interval '7 days', null, null, null, 'idem-qt-qty0-00001', %L) $$, (select tenant_a from ids), (select ana from ids),
  pg_temp.h('q0')), 'PT400', 'VALIDATION_ERROR', 'quantidade inválida');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
select throws_ok(format($$ select public.sales_quote_get(%L, %L) $$, (select tenant_a from ids), pg_temp.q('q1')),
  'PT403', 'FORBIDDEN', 'dono de B não lê orçamento de A pelo tenant de A');
select throws_ok(format($$ select public.sales_quote_get(%L, %L) $$, (select tenant_b from ids), pg_temp.q('q1')),
  'PT404', 'NOT_FOUND', 'id de A no tenant de B: não encontrado');
select throws_ok(format($$ select public.sales_quote_send(%L, %L, 1, 'idem-qt-send-b-0001', %L) $$, (select tenant_b from ids),
  pg_temp.q('q1'), pg_temp.h('sb')), 'PT404', 'NOT_FOUND', 'dono de B não gera link do orçamento de A');
select is((select count(*)::int from public.sales_quotes), 0, 'RLS: dono de B não vê orçamentos de A');
select is((select count(*)::int from public.sales_quote_versions), 0, 'RLS: nem as versões');
select pg_temp.login_as((select customer_ab from ids));
select throws_ok(format($$ select public.sales_quote_list(%L, null) $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'cliente com login não lista orçamentos do negócio');

-- ------------------------------------------------------------------ link
select pg_temp.login_as((select owner_a from ids));
insert into r select 's1', public.sales_quote_send((select tenant_a from ids), pg_temp.q('q1'), 1, 'idem-qt-send-q1-001', pg_temp.h('s1'));
select ok(pg_temp.got('s1')->'body'->>'token' ~ '^[A-Za-z0-9_-]{43}$', 'link com token opaco de 256 bits');
select is(pg_temp.got('s1')->'body'->'quote'->>'status', 'sent', 'enviado');
select is(public.sales_quote_send((select tenant_a from ids), pg_temp.q('q1'), 1, 'idem-qt-send-q1-001', pg_temp.h('s1'))
  ->'body'->'token', 'null'::jsonb, 'repetição não reexibe o token');
reset role;
select throws_ok(format($$ update public.sales_quote_versions set total_cents = 1 where quote_id = %L $$, pg_temp.q('q1')),
  'PT403', 'FORBIDDEN', 'versão é imutável');

set local role anon;
insert into r select 'view1', public.sales_quote_view(pg_temp.got('s1')->'body'->>'token');
select is(pg_temp.got('view1')->>'status', 'sent', 'abrir o link mostra o orçamento');
select is((pg_temp.got('view1')->>'total_cents')::bigint, 10000::bigint, 'link mostra o total da versão');
select ok(pg_temp.got('view1')::text !~ '10000000-0000-4000-8000-00000000000a', 'link não expõe o tenant');
select ok(pg_temp.got('view1')::text !~ 'Cliente AB', 'link não expõe o cadastro do cliente');
select throws_ok(format($$ select public.sales_quote_accept(%L, 1, %L) $$, pg_temp.got('s1')->'body'->>'token', repeat('0', 64)),
  'PT409', 'STALE_VERSION', 'aceite com hash diferente do visto é negado');
select throws_ok($$ select public.sales_quote_view('nao-existe-token-nao-existe-token-nao-exist') $$, 'PT404', 'NOT_FOUND',
  'token desconhecido: não encontrado');
reset role;
select is((select status from public.sales_quotes where id = pg_temp.q('q1')), 'sent', 'abrir o link não aceita');

-- O profissional revisa depois que o cliente abriu: o aceite da versão antiga é negado.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'q1v2', public.sales_quote_revise((select tenant_a from ids), pg_temp.q('q1'), 1, 'Corte e barba',
  jsonb_set(pg_temp.items(), '{1,unit_price_cents}', '3500'), now() + interval '7 days', (select corte_a from ids),
  pg_temp.at(1, '10:00'), 'Inclui lavagem', 'idem-qt-revise-q1-1', pg_temp.h('q1v2'));
select is((pg_temp.cur('q1v2')->>'version_no')::int, 2, 'revisão cria a versão 2');
select is((pg_temp.cur('q1v2')->>'total_cents')::bigint, 9500::bigint, 'novo total');
select isnt(pg_temp.cur('q1v2')->>'snapshot_hash', pg_temp.cur('q1')->>'snapshot_hash', 'novo hash');
select throws_ok(format($$ select public.sales_quote_revise(%L, %L, 1, 'X', %L, now() + interval '7 days', null, null, null,
  'idem-qt-revise-q1-2', %L) $$, (select tenant_a from ids), pg_temp.q('q1'), pg_temp.items(), pg_temp.h('stale')),
  'PT409', 'STALE_VERSION', 'revisar a partir de versão antiga → 409');
set local role anon;
select throws_ok(format($$ select public.sales_quote_accept(%L, 1, %L) $$, pg_temp.got('s1')->'body'->>'token',
  pg_temp.cur('q1')->>'snapshot_hash'), 'PT409', 'STALE_VERSION', 'aceitar a versão 1 depois da revisão é negado');

-- ------------------------------------------------------------------ aceite
insert into r select 'acc1', public.sales_quote_accept(pg_temp.got('s1')->'body'->>'token', 2, pg_temp.cur('q1v2')->>'snapshot_hash');
select is(pg_temp.got('acc1')->>'status', 'accepted', 'aceite da versão vista');
select is(pg_temp.got('acc1')->'booking'->>'status', 'confirmed', 'horário reservado na mesma transação');
select is(pg_temp.got('acc1')->'booking'->>'source', 'quote', 'reserva com origem orçamento');
select is((pg_temp.got('acc1')->'booking'->>'agreed_price_cents')::bigint, 9500::bigint, 'preço combinado = total aceito');
select is(public.sales_quote_accept(pg_temp.got('s1')->'body'->>'token', 2, pg_temp.cur('q1v2')->>'snapshot_hash'),
  pg_temp.got('acc1'), 'aceite repetido devolve a mesma decisão e reserva');
select throws_ok(format($$ select public.sales_quote_decline(%L, 2, %L) $$, pg_temp.got('s1')->'body'->>'token',
  pg_temp.cur('q1v2')->>'snapshot_hash'), 'PT422', 'POLICY_REJECTED', 'aceito não vira recusado');
reset role;
select is((select count(*)::int from public.sales_quote_decisions where quote_id = pg_temp.q('q1')), 1, 'uma decisão');
select is((select count(*)::int from public.bookings where source = 'quote'), 1, 'uma reserva');
select is((select count(*)::int from public.receivables) + (select count(*)::int from public.payment_entries), 0,
  'orçamento aceito não marca pagamento nem cria cobrança');
select is((select count(*)::int from public.outbox_events where event_type = 'sales.quote.accepted.v1'
  and aggregate_id = pg_temp.q('q1')), 1, 'um evento de aceite');
select ok((select bool_and(a.after::text !~ 'Corte e barba' and a.after::text !~ 'lavagem') from public.audit_events a
  where a.object_id = pg_temp.q('q1')), 'auditoria sem título nem observações');

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.sales_quote_revise(%L, %L, 2, 'X', %L, now() + interval '7 days', null, null, null,
  'idem-qt-revise-q1-3', %L) $$, (select tenant_a from ids), pg_temp.q('q1'), pg_temp.items(), pg_temp.h('after')),
  'PT422', 'POLICY_REJECTED', 'versão aceita não muda');
select is(public.sales_quote_get((select tenant_a from ids), pg_temp.q('q1'))->'decision'->>'snapshot_hash',
  pg_temp.cur('q1v2')->>'snapshot_hash', 'decisão guarda o hash aceito');

-- ------------------------------------------------------------------ aceite sem vaga não cria horário
insert into r select 'q2', public.sales_quote_create((select tenant_a from ids), (select bruno from ids), 'Corte',
  jsonb_build_array(jsonb_build_object('service_id', (select corte_a from ids), 'description', 'Corte', 'quantity', 1,
    'unit_price_cents', 6000)), now() + interval '7 days', (select corte_a from ids), pg_temp.at(1, '11:00'), null,
  'idem-qt-create-q2-01', pg_temp.h('q2'));
insert into r select 's2', public.sales_quote_send((select tenant_a from ids), pg_temp.q('q2'), 1, 'idem-qt-send-q2-001', pg_temp.h('s2'));
-- Outra pessoa reserva 11h direto na agenda antes do aceite.
insert into r select 'b11', public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  null, 'Visitante', pg_temp.at(1, '11:00'), pg_temp.at(1, '11:30'), null, 'confirm', 'idem-qt-book-11-001', pg_temp.h('b11'));
set local role anon;
select throws_ok(format($$ select public.sales_quote_accept(%L, 1, %L) $$, pg_temp.got('s2')->'body'->>'token',
  pg_temp.cur('q2')->>'snapshot_hash'), 'PT409', 'SLOT_CONFLICT', 'sem vaga, o aceite é negado');
reset role;
select is((select status from public.sales_quotes where id = pg_temp.q('q2')), 'sent', 'orçamento continua aberto');
select is((select count(*)::int from public.sales_quote_decisions where quote_id = pg_temp.q('q2')), 0, 'nenhuma decisão gravada');
select is((select count(*)::int from public.bookings where source = 'quote'), 1, 'nenhuma reserva extra');

-- ------------------------------------------------------------------ sem horário, recusa, cancelamento, novo link, expiração
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'q3', public.sales_quote_create((select tenant_a from ids), (select ana from ids), 'Pacote noivo',
  pg_temp.items(), now() + interval '7 days', null, null, null, 'idem-qt-create-q3-01', pg_temp.h('q3'));
insert into r select 's3', public.sales_quote_send((select tenant_a from ids), pg_temp.q('q3'), 1, 'idem-qt-send-q3-001', pg_temp.h('s3'));
set local role anon;
insert into r select 'acc3', public.sales_quote_accept(pg_temp.got('s3')->'body'->>'token', 1, pg_temp.cur('q3')->>'snapshot_hash');
select ok(pg_temp.got('acc3')->>'status' = 'accepted' and pg_temp.got('acc3')->'booking' = 'null'::jsonb,
  'orçamento sem horário é aceito sem criar reserva');

reset role;
set local role authenticated;
insert into r select 'q4', public.sales_quote_create((select tenant_a from ids), (select ana from ids), 'Hidratação',
  pg_temp.items(), now() + interval '7 days', null, null, null, 'idem-qt-create-q4-01', pg_temp.h('q4'));
insert into r select 's4', public.sales_quote_send((select tenant_a from ids), pg_temp.q('q4'), 1, 'idem-qt-send-q4-001', pg_temp.h('s4'));
set local role anon;
insert into r select 'dec4', public.sales_quote_decline(pg_temp.got('s4')->'body'->>'token', 1, pg_temp.cur('q4')->>'snapshot_hash');
select is(pg_temp.got('dec4')->>'status', 'declined', 'cliente recusa');
select is(public.sales_quote_decline(pg_temp.got('s4')->'body'->>'token', 1, pg_temp.cur('q4')->>'snapshot_hash'),
  pg_temp.got('dec4'), 'recusa repetida devolve a mesma decisão');
select throws_ok(format($$ select public.sales_quote_accept(%L, 1, %L) $$, pg_temp.got('s4')->'body'->>'token',
  pg_temp.cur('q4')->>'snapshot_hash'), 'PT422', 'POLICY_REJECTED', 'recusado não vira aceito');

reset role;
set local role authenticated;
insert into r select 'q5', public.sales_quote_create((select tenant_a from ids), (select ana from ids), 'Luzes',
  pg_temp.items(), now() + interval '7 days', null, null, null, 'idem-qt-create-q5-01', pg_temp.h('q5'));
insert into r select 's5a', public.sales_quote_send((select tenant_a from ids), pg_temp.q('q5'), 1, 'idem-qt-send-q5-001', pg_temp.h('s5a'));
insert into r select 's5b', public.sales_quote_send((select tenant_a from ids), pg_temp.q('q5'), 1, 'idem-qt-send-q5-002', pg_temp.h('s5b'));
set local role anon;
select throws_ok(format($$ select public.sales_quote_view(%L) $$, pg_temp.got('s5a')->'body'->>'token'), 'PT404', 'NOT_FOUND',
  'novo link invalida o anterior');
select is(public.sales_quote_view(pg_temp.got('s5b')->'body'->>'token')->>'status', 'sent', 'novo link funciona');
reset role;
set local role authenticated;
insert into r select 'c5', public.sales_quote_cancel((select tenant_a from ids), pg_temp.q('q5'), 'idem-qt-cancel-q5-1', pg_temp.h('c5'));
select is(pg_temp.got('c5')->'body'->'quote'->>'status', 'cancelled', 'dono cancela');
set local role anon;
select throws_ok(format($$ select public.sales_quote_view(%L) $$, pg_temp.got('s5b')->'body'->>'token'), 'PT404', 'NOT_FOUND',
  'link de orçamento cancelado deixa de existir');

reset role;
set local role authenticated;
insert into r select 'q6', public.sales_quote_create((select tenant_a from ids), (select ana from ids), 'Relâmpago',
  pg_temp.items(), clock_timestamp() + interval '1 second', null, null, null, 'idem-qt-create-q6-01', pg_temp.h('q6'));
insert into r select 's6', public.sales_quote_send((select tenant_a from ids), pg_temp.q('q6'), 1, 'idem-qt-send-q6-001', pg_temp.h('s6'));
select pg_sleep(1.2);
set local role anon;
select is(public.sales_quote_view(pg_temp.got('s6')->'body'->>'token')->>'status', 'expired', 'validade vencida aparece como vencido');
select throws_ok(format($$ select public.sales_quote_accept(%L, 1, %L) $$, pg_temp.got('s6')->'body'->>'token',
  pg_temp.cur('q6')->>'snapshot_hash'), 'PT422', 'POLICY_REJECTED', 'vencido não é aceito');
reset role;
set local role authenticated;
select is(jsonb_array_length(public.sales_quote_list((select tenant_a from ids), 'expired')->'quotes'), 1, 'filtro por vencidos');
select throws_ok(format($$ select public.sales_quote_send(%L, %L, 1, 'idem-qt-send-q6-002', %L) $$, (select tenant_a from ids),
  pg_temp.q('q6'), pg_temp.h('s6b')), 'PT422', 'POLICY_REJECTED', 'link novo de vencido exige revisar a validade');

select * from finish();
rollback;

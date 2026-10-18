-- P05 · Preço por regras: fixtures do doc06 na função SQL, piso > base bloqueia, aprovação vinculada a
-- hash/versão/validade, publicação única, cotação com prazo e uso único, preço confirmado preservado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as cust_a;
grant select on ids to authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.at(p_days integer, p_hhmm text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + p_days) + p_hhmm::time)
         at time zone 'America/Sao_Paulo'
$$;
create function pg_temp.quote(p_days integer, p_hhmm text) returns jsonb language sql as $$
  select public.pricing_quote((select tenant_a from ids), (select corte_a from ids), (select res_a from ids),
    pg_temp.at(p_days, p_hhmm), pg_temp.at(p_days, p_hhmm) + interval '30 minutes')
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.at(integer, text), pg_temp.quote(integer, text)
  to authenticated;

-- ------------------------------------------------------------------ fixtures do doc06 (mesmas do domínio TS)
select is((app.price_compute(10000, 8000, 4000, 500, 2500, 3000, 1500)->>'final_cents')::int, 8500,
  'doc06: piso manual R$80, teto 15% de 30% → R$85');
select is((app.price_compute(10000, 0, 4000, 500, 2500, 5000, 5000)->>'final_cents')::int, 5715,
  'piso econômico R$57,15 com ceil prevalece');
select is(app.price_compute(10000, 0, 4000, 500, 2500, 5000, 5000)->>'reason', 'FLOOR_APPLIED', 'motivo: piso aplicado');
select is((app.price_compute(6001, 4500, null, null, 0, 1500, 1500)->>'final_cents')::int, 5101, 'half-up: 5100,85 → 5101');
select is((app.price_compute(6000, 4500, 1500, 500, 0, 1500, 1500)->>'final_cents')::int, 5100, 'regra de terça: R$51');
select is(app.price_compute(6000, 4500, null, null, 0, 0, 1500)->>'reason', 'BASE_PRICE', 'sem desconto → preço base');
select is(app.price_compute(5000, 0, 4000, 500, 2500, 1000, 1000)->>'error', 'FLOOR_ABOVE_BASE', 'piso > base bloqueia');
select is(app.price_compute(10000, 0, 100, 5000, 5000, 1000, 1000)->>'error', 'MARGIN_DENOMINATOR', 'taxa+margem ≥ 100% inválido');

-- ------------------------------------------------------------------ privilégios
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('pricing_rules', 'pricing_rule_proposals', 'pricing_rule_approvals', 'price_quotes')),
  'RLS ligada nas tabelas de preço');
select ok(not has_table_privilege('authenticated', 'public.pricing_rule_approvals', 'select'), 'aprovações são backend-only');
select ok(not has_table_privilege('authenticated', 'public.pricing_rules', 'insert'), 'regra só entra por publicação');

-- ------------------------------------------------------------------ expediente para reservar (P03)
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rules', public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  (select jsonb_agg(jsonb_build_object('weekday', d, 'local_start', '09:00', 'local_end', '19:00')) from generate_series(1, 5) d),
  'idem-pr-rules-00001', pg_temp.h('rules'));

-- ------------------------------------------------------------------ sem regra: preço base
insert into r select 'q0', pg_temp.quote(1, '15:00');
select is((pg_temp.got('q0')->>'final_price_cents')::int, 6000, 'sem regra ativa → preço base');
select ok(pg_temp.got('q0')->'rule_version' = 'null'::jsonb, 'sem regra → rule_version null');

-- ------------------------------------------------------------------ proposta → aprovação → publicação
insert into r select 'p1', public.pricing_propose_rule((select tenant_a from ids), (select corte_a from ids),
  '[{"weekday":2,"local_start":"13:00","local_end":"17:00"}]', 1500, 1500, 0, now(), now() + interval '90 days',
  'idem-pr-propose-001', pg_temp.h('p1'));
select is((pg_temp.got('p1')->>'status_code')::int, 201, 'proposta criada');
select is((pg_temp.got('p1')->'body'->'preview'->>'example_final_cents')::int, 5100, 'prévia mostra o valor final');
select is(pg_temp.got('p1')->'body'->>'status', 'proposed', 'proposta ainda inativa');
select is((select count(*)::int from public.pricing_rules), 0, 'propor não publica');
select is((pg_temp.quote(1, '15:00')->>'final_price_cents')::int, 6000, 'proposta não muda cotação');
select throws_ok(format($$ select public.pricing_propose_rule(%L, %L, '[{"weekday":2,"local_start":"13:00","local_end":"17:00"}]',
  1500, 1500, 9000, now(), now() + interval '1 day', 'idem-pr-floor-0001', %L) $$,
  (select tenant_a from ids), (select corte_a from ids), pg_temp.h('floor')),
  'PT422', 'POLICY_REJECTED', 'piso econômico acima da base bloqueia a proposta');
select throws_ok(format($$ select public.pricing_propose_rule(%L, %L, '[{"weekday":2,"local_start":"17:00","local_end":"13:00"}]',
  1500, 1500, 0, now(), now() + interval '1 day', 'idem-pr-window-001', %L) $$,
  (select tenant_a from ids), (select corte_a from ids), pg_temp.h('win')),
  'PT400', 'VALIDATION_ERROR', 'janela invertida negada');

select throws_ok(format($$ select public.pricing_approve_rule(%L, %L, %L, 1, 'idem-pr-appr-bad01', %L) $$,
  (select tenant_a from ids), pg_temp.got('p1')->'body'->>'proposal_id', repeat('0', 64), pg_temp.h('bad')),
  'PT422', 'POLICY_REJECTED', 'aprovação de outro conteúdo (hash) negada');
select throws_ok(format($$ select public.pricing_approve_rule(%L, %L, %L, 2, 'idem-pr-appr-ver01', %L) $$,
  (select tenant_a from ids), pg_temp.got('p1')->'body'->>'proposal_id', pg_temp.got('p1')->'body'->>'payload_hash', pg_temp.h('ver')),
  'PT409', 'STALE_VERSION', 'aprovação de versão diferente negada');
insert into r select 'a1', public.pricing_approve_rule((select tenant_a from ids), (pg_temp.got('p1')->'body'->>'proposal_id')::uuid,
  pg_temp.got('p1')->'body'->>'payload_hash', 1, 'idem-pr-approve-001', pg_temp.h('a1'));
select ok((pg_temp.got('a1')->'body'->>'expires_at')::timestamptz <= clock_timestamp() + interval '15 minutes', 'aprovação tem prazo curto');
select is((select count(*)::int from public.pricing_rules), 0, 'aprovar não publica');

insert into r select 'pub1', public.pricing_publish_rule((select tenant_a from ids), (pg_temp.got('p1')->'body'->>'proposal_id')::uuid,
  (pg_temp.got('a1')->'body'->>'approval_id')::uuid, 1, 'idem-pr-publish-001', pg_temp.h('pub1'));
select is((pg_temp.got('pub1')->'body'->'rule'->>'rule_version')::int, 1, 'regra publicada na versão 1');
select is(public.pricing_publish_rule((select tenant_a from ids), (pg_temp.got('p1')->'body'->>'proposal_id')::uuid,
  (pg_temp.got('a1')->'body'->>'approval_id')::uuid, 1, 'idem-pr-publish-001', pg_temp.h('pub1')), pg_temp.got('pub1'),
  'publicar de novo com a mesma chave → mesma resposta');
select throws_ok(format($$ select public.pricing_publish_rule(%L, %L, %L, 2, 'idem-pr-publish-002', %L) $$,
  (select tenant_a from ids), pg_temp.got('p1')->'body'->>'proposal_id', pg_temp.got('a1')->'body'->>'approval_id', pg_temp.h('pub2')),
  'PT422', 'POLICY_REJECTED', 'aprovação é de uso único');

-- ------------------------------------------------------------------ cotação e reserva
insert into r select 'q1', pg_temp.quote(1, '15:00');
select is((pg_temp.got('q1')->>'final_price_cents')::int, 5100, 'terça 15h → R$51 pela regra');
select is(pg_temp.got('q1')->>'reason_code', 'OFF_PEAK_APPROVED', 'motivo: desconto de horário aprovado');
select is((pg_temp.got('q1')->>'rule_version')::int, 1, 'cotação guarda a versão da regra');
select ok((pg_temp.got('q1')->>'expires_at')::timestamptz <= clock_timestamp() + interval '10 minutes', 'cotação expira em até 10 min');
select is((pg_temp.quote(0, '15:00')->>'final_price_cents')::int, 6000, 'segunda fora da janela → preço base');
select is((pg_temp.quote(1, '17:00')->>'final_price_cents')::int, 6000, 'fim da janela é exclusivo');

insert into r select 'b1', public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  (select cust_a from ids), null, pg_temp.at(1, '15:00'), pg_temp.at(1, '15:30'), (pg_temp.got('q1')->>'quote_id')::uuid, 'confirm',
  'idem-pr-book-00001', pg_temp.h('b1'));
select is((pg_temp.got('b1')->'body'->'booking'->>'agreed_price_cents')::int, 5100, 'reserva congela o preço da cotação');
select is(pg_temp.got('b1')->'body'->'booking'->>'price_quote_id', pg_temp.got('q1')->>'quote_id', 'reserva aponta a cotação');
select throws_ok(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, %L, %L, %L, 'confirm', 'idem-pr-book-00002', %L) $$,
  (select tenant_a from ids), (select res_a from ids), (select corte_a from ids), pg_temp.at(2, '15:00'), pg_temp.at(2, '15:30'),
  pg_temp.got('q1')->>'quote_id', pg_temp.h('b2')), 'PT422', 'POLICY_REJECTED', 'cotação de outro horário não serve');
insert into r select 'q2', pg_temp.quote(1, '16:00');
reset role;
update public.price_quotes set expires_at = clock_timestamp() - interval '1 second' where id = (pg_temp.got('q2')->>'quote_id')::uuid;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, %L, %L, %L, 'confirm', 'idem-pr-book-00003', %L) $$,
  (select tenant_a from ids), (select res_a from ids), (select corte_a from ids), pg_temp.at(1, '16:00'), pg_temp.at(1, '16:30'),
  pg_temp.got('q2')->>'quote_id', pg_temp.h('b3')), 'PT422', 'POLICY_REJECTED', 'cotação vencida negada no banco');

-- Hold com cotação: prazo = menor entre hold e cotação; confirmação usa o preço da cotação.
insert into r select 'q3', pg_temp.quote(1, '14:00');
insert into r select 'h3', public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  (select cust_a from ids), null, pg_temp.at(1, '14:00'), pg_temp.at(1, '14:30'), (pg_temp.got('q3')->>'quote_id')::uuid, 'hold',
  'idem-pr-hold-00001', pg_temp.h('h3'));
select ok((pg_temp.got('h3')->'body'->'booking'->>'hold_expires_at')::timestamptz <= (pg_temp.got('q3')->>'expires_at')::timestamptz,
  'hold não dura mais que a cotação');
insert into r select 'c3', public.scheduling_booking_confirm((select tenant_a from ids),
  (pg_temp.got('h3')->'body'->'booking'->>'id')::uuid, 1, 'idem-pr-confirm-001', pg_temp.h('c3'));
select is((pg_temp.got('c3')->'body'->'booking'->>'agreed_price_cents')::int, 5100, 'confirmação usa o preço da cotação');

-- ------------------------------------------------------------------ nova regra não muda o que foi vendido
insert into r select 'p2', public.pricing_propose_rule((select tenant_a from ids), (select corte_a from ids),
  '[{"weekday":2,"local_start":"13:00","local_end":"17:00"}]', 4000, 4000, 0, now(), now() + interval '90 days',
  'idem-pr-propose-002', pg_temp.h('p2'));
select is((pg_temp.got('p2')->'body'->'preview'->>'example_final_cents')::int, 4500, 'desconto maior para no piso manual');
select is(pg_temp.got('p2')->'body'->'preview'->>'reason', 'FLOOR_APPLIED', 'prévia avisa que o piso foi aplicado');
insert into r select 'a2', public.pricing_approve_rule((select tenant_a from ids), (pg_temp.got('p2')->'body'->>'proposal_id')::uuid,
  pg_temp.got('p2')->'body'->>'payload_hash', 1, 'idem-pr-approve-002', pg_temp.h('a2'));
insert into r select 'pub2', public.pricing_publish_rule((select tenant_a from ids), (pg_temp.got('p2')->'body'->>'proposal_id')::uuid,
  (pg_temp.got('a2')->'body'->>'approval_id')::uuid, 1, 'idem-pr-publish-003', pg_temp.h('pub2b'));
select is((select count(*)::int from public.pricing_rules where active), 1, 'uma regra ativa por serviço (sem empilhar)');
select is((pg_temp.quote(1, '13:00')->>'final_price_cents')::int, 4500, 'nova cotação usa a regra 2 com piso');
select is((select agreed_price_cents::int from public.bookings where id = (pg_temp.got('b1')->'body'->'booking'->>'id')::uuid), 5100,
  'reserva já confirmada mantém o preço (sem alteração retroativa)');

-- Reagendar sem cotação mantém o preço; com cotação nova, muda de forma explícita.
insert into r select 'rs1', public.scheduling_booking_reschedule((select tenant_a from ids), (pg_temp.got('b1')->'body'->'booking'->>'id')::uuid,
  1, pg_temp.at(0, '10:00'), pg_temp.at(0, '10:30'), null, 'idem-pr-resch-0001', pg_temp.h('rs1'));
select is((pg_temp.got('rs1')->'body'->'booking'->>'agreed_price_cents')::int, 5100, 'reagendar sem cotação mantém o combinado');
insert into r select 'q4', pg_temp.quote(0, '11:00');
insert into r select 'rs2', public.scheduling_booking_reschedule((select tenant_a from ids), (pg_temp.got('b1')->'body'->'booking'->>'id')::uuid,
  2, pg_temp.at(0, '11:00'), pg_temp.at(0, '11:30'), (pg_temp.got('q4')->>'quote_id')::uuid, 'idem-pr-resch-0002', pg_temp.h('rs2'));
select is((pg_temp.got('rs2')->'body'->'booking'->>'agreed_price_cents')::int, 6000, 'reagendar com cotação nova aplica o preço cotado');

-- Desativar
insert into r select 'off', public.pricing_deactivate_rule((select tenant_a from ids), (pg_temp.got('pub2')->'body'->'rule'->>'rule_id')::uuid,
  1, 'idem-pr-deact-0001', pg_temp.h('off'));
select is((pg_temp.quote(1, '13:00')->>'final_price_cents')::int, 6000, 'sem regra ativa volta ao preço base');
reset role;

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok($$ select pg_temp.quote(1, '15:00') $$, 'PT403', 'FORBIDDEN', 'dono B não cota em A');
select is((select count(*)::int from public.pricing_rules), 0, 'dono B não lê regras de A');
reset role;
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select is((select count(*)::int from public.price_quotes), 0, 'cliente não lê cotações');
reset role;

select * from finish();
rollback;

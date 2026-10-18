-- P08 · Assistente: cota atômica por negócio, leituras com vínculo, proposta sem efeito, aprovação vinculada a
-- hash/versão (uma só), execução idempotente com recibo, aprovação velha não executa quando a agenda muda,
-- preço mudado não executa, isolamento A/B e equipe sem poderes de dono. Casos AE-29/30/33/35/36/37/38/40.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000a2'::uuid as barba_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana;
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
create function pg_temp.ts(p timestamptz) returns text language sql as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
/** Proposta de booking.create (Corte) no dia/hora, com o preço esperado. */
create function pg_temp.propose_create(p_key text, p_days integer, p_hhmm text, p_price integer) returns jsonb language sql as $$
  select public.agent_proposal_create((select tenant_a from ids), null, 'booking.create',
    jsonb_build_object('customer_id', (select ana from ids), 'service_id', (select corte_a from ids),
      'resource_id', (select res_a from ids), 'starts_at', pg_temp.ts(pg_temp.at(p_days, p_hhmm)),
      'ends_at', pg_temp.ts(pg_temp.at(p_days, p_hhmm) + interval '30 minutes'), 'expected_price_cents', p_price),
    'Agendar Corte para Cliente AB (exemplo)', p_key, pg_temp.h(p_key))
$$;
create function pg_temp.approve(p_key text, p_proposal text) returns jsonb language sql as $$
  select public.action_approve((select tenant_a from ids), (pg_temp.got(p_proposal)->'body'->>'proposal_id')::uuid,
    pg_temp.got(p_proposal)->'body'->>'payload_hash', (pg_temp.got(p_proposal)->'body'->>'version')::integer,
    p_key, pg_temp.h(p_key))
$$;
create function pg_temp.execute(p_key text, p_approval text) returns jsonb language sql as $$
  select public.action_execute((select tenant_a from ids), (pg_temp.got(p_approval)->'body'->>'approval_id')::uuid,
    p_key, pg_temp.h(p_key))
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.at(integer, text), pg_temp.ts(timestamptz),
  pg_temp.propose_create(text, integer, text, integer), pg_temp.approve(text, text), pg_temp.execute(text, text)
  to anon, authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('agent_quotas', 'agent_runs', 'agent_proposals', 'agent_approvals', 'agent_receipts')),
  'RLS ligada nas tabelas do assistente');
select ok(not has_table_privilege('authenticated', 'public.agent_approvals', 'insert')
  and not has_table_privilege('authenticated', 'public.agent_proposals', 'update')
  and not has_table_privilege('authenticated', 'public.agent_receipts', 'insert'),
  'ninguém aprova ou executa escrevendo direto nas tabelas');
select ok(not has_function_privilege('anon', 'public.agent_run_start(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.action_execute(uuid, uuid, text, text, uuid)', 'execute'),
  'assistente exige login');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name in ('agent_runs', 'agent_quotas') and column_name in ('text', 'question', 'answer', 'prompt')),
  'pergunta e resposta não são guardadas');
select ok(not exists (select 1 from information_schema.routines where routine_schema = 'public'
  and routine_name like 'agent%' and routine_name ~ 'sql|query|exec_'), 'não existe RPC de SQL livre');

-- ------------------------------------------------------------------ vínculo antes de tudo (AE-29, AE-30)
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select throws_ok(format($$ select public.agent_run_start(%L, 'idem-ag-outsider-01') $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'sem vínculo: negado antes de qualquer ferramenta');
select pg_temp.login_as((select customer_ab from ids));
select throws_ok(format($$ select public.agent_run_start(%L, 'idem-ag-customer-01') $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'cliente do negócio não usa o assistente do dono');
select pg_temp.login_as((select owner_a from ids));
select throws_ok(format($$ select public.agent_run_start(%L, 'idem-ag-tenantb-001') $$, (select tenant_b from ids)),
  'PT403', 'FORBIDDEN', 'selecionar o negócio B sem vínculo é negado');
reset role;
select is((select count(*)::int from public.agent_runs), 0, 'pedidos negados não debitam nada');

-- ------------------------------------------------------------------ cota (AE-33, AE-35, AE-36)
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'run1', public.agent_run_start((select tenant_a from ids), 'idem-ag-run-000001');
select is(pg_temp.got('run1')->>'role', 'owner', 'contexto do servidor: papel');
select is(pg_temp.got('run1')->>'tenant_name', 'Barbearia Exemplo A', 'contexto do servidor: negócio selecionado');
select is((pg_temp.got('run1')->'quota'->>'used')::int, 1, 'primeira pergunta debita 1');
insert into r select 'run1b', public.agent_run_start((select tenant_a from ids), 'idem-ag-run-000001');
select ok((pg_temp.got('run1b')->>'replay')::boolean and pg_temp.got('run1b')->>'run_id' = pg_temp.got('run1')->>'run_id'
  and (pg_temp.got('run1b')->'quota'->>'used')::int = 1, 'retry com a mesma chave não debita de novo');
reset role;
update public.agent_quotas set monthly_limit = 2 where tenant_id = (select tenant_a from ids);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'run2', public.agent_run_start((select tenant_a from ids), 'idem-ag-run-000002');
select is((pg_temp.got('run2')->'quota'->>'used')::int, 2, 'última pergunta da franquia é aceita');
select throws_ok(format($$ select public.agent_run_start(%L, 'idem-ag-run-000003') $$, (select tenant_a from ids)),
  'PT429', 'QUOTA_EXCEEDED', 'franquia esgotada → 429');
select pg_temp.login_as((select owner_b from ids));
select is(public.agent_run_start((select tenant_b from ids), 'idem-ag-run-b00001')->>'tenant_name', 'Personal Exemplo B',
  'cota esgotada em A não bloqueia B');
reset role;
update public.agent_quotas set monthly_limit = 200 where tenant_id = (select tenant_a from ids);

-- ------------------------------------------------------------------ leituras das ferramentas
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rules', public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  (select jsonb_agg(jsonb_build_object('weekday', d, 'local_start', '09:00', 'local_end', '19:00')) from generate_series(1, 5) d),
  'idem-ag-rules-0001', pg_temp.h('rules'));
insert into r select 'dir', public.agent_directory((select tenant_a from ids));
select is(jsonb_array_length(pg_temp.got('dir')->'services'), 2, 'diretório: serviços do negócio A');
select ok(not (pg_temp.got('dir')::text like '%Sessão de treino%') and not (pg_temp.got('dir')::text like '%0000000000b1%'),
  'diretório de A não traz nada de B');
select is((pg_temp.got('dir')->'waitlist'->>'active')::int, 0, 'dono vê a contagem da lista de espera');
select throws_ok(format($$ select public.agent_finance_read(%L, now() - interval '500 days', now()) $$, (select tenant_a from ids)),
  'PT400', 'VALIDATION_ERROR', 'período financeiro limitado');
insert into r select 'fin', public.agent_finance_read((select tenant_a from ids), now() - interval '30 days', now());
select ok((pg_temp.got('fin')->>'records_count')::int = 0 and pg_temp.got('fin')->>'first_record_at' is null,
  'sem registros: contagem zero e sem primeira data (nada inventado)');
select pg_temp.login_as((select owner_b from ids));
select throws_ok(format($$ select public.agent_agenda_read(%L, now(), now() + interval '1 day') $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'dono de B não lê a agenda de A');
select throws_ok(format($$ select public.agent_directory(%L) $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'dono de B não lê os clientes de A');

-- Equipe: lê agenda, não lê financeiro nem lista de espera, não propõe.
reset role;
insert into public.tenant_memberships (tenant_id, user_id, role) values ((select tenant_a from ids), (select owner_b from ids), 'staff');
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is(public.agent_run_start((select tenant_a from ids), 'idem-ag-staff-0001')->>'role', 'staff', 'equipe usa o assistente com o próprio papel');
select ok(public.agent_directory((select tenant_a from ids))->'waitlist' = 'null'::jsonb, 'equipe não recebe a lista de espera');
select throws_ok(format($$ select public.agent_finance_read(%L, now() - interval '7 days', now()) $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'equipe não lê o financeiro');
select throws_ok(format($$ select public.agent_proposal_create(%L, null, 'booking.cancel',
  '{"booking_id":"60000000-0000-4000-8000-000000000001","expected_version":1,"reason":"x"}', 'Cancelar', 'idem-ag-staff-prop1', %L) $$,
  (select tenant_a from ids), pg_temp.h('sp')), 'PT403', 'FORBIDDEN', 'equipe não cria proposta');
reset role;
delete from public.tenant_memberships where tenant_id = (select tenant_a from ids) and user_id = (select owner_b from ids);

-- ------------------------------------------------------------------ proposta ≠ execução (AE-10)
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.agent_proposal_create(%L, null, 'sql.run', '{"q":"select 1"}', 'x', 'idem-ag-badtool-01', %L) $$,
  (select tenant_a from ids), pg_temp.h('bt')), 'PT400', 'VALIDATION_ERROR', 'ferramenta fora da lista fechada é recusada');
select throws_ok(format($$ select public.agent_proposal_create(%L, null, 'booking.create', '{"service_id":"x"}', 'x', 'idem-ag-badpay-001', %L) $$,
  (select tenant_a from ids), pg_temp.h('bp')), 'PT400', 'VALIDATION_ERROR', 'payload incompleto é recusado');
insert into r select 'p1', pg_temp.propose_create('idem-ag-prop-000001', 3, '10:00', 6000);
select is(pg_temp.got('p1')->'body'->>'approval_state', 'pending', 'proposta nasce pendente');
select is(pg_temp.got('p1')->'body'->>'payload_hash',
  pg_temp.h((pg_temp.got('p1')->'body'->'payload')::text || '|policy:1'), 'hash = sha256(payload normalizado + política)');
select ok((pg_temp.got('p1')->'body'->>'expires_at')::timestamptz > now(), 'proposta tem prazo');
select is((select count(*)::int from public.bookings where tenant_id = (select tenant_a from ids) and starts_at = pg_temp.at(3, '10:00')),
  0, 'proposta não grava reserva');
select is(pg_temp.propose_create('idem-ag-prop-000001', 3, '10:00', 6000)->'body'->>'proposal_id',
  pg_temp.got('p1')->'body'->>'proposal_id', 'repetir a criação devolve a mesma proposta');

-- ------------------------------------------------------------------ aprovação vinculada (AE-37)
select throws_ok(format($$ select public.action_approve(%L, %L, %L, 1, 'idem-ag-appr-bad01', %L) $$,
  (select tenant_a from ids), pg_temp.got('p1')->'body'->>'proposal_id', repeat('0', 64), pg_temp.h('ab1')),
  'PT422', 'POLICY_REJECTED', 'hash diferente do visto não aprova');
select throws_ok(format($$ select public.action_approve(%L, %L, %L, 7, 'idem-ag-appr-bad02', %L) $$,
  (select tenant_a from ids), pg_temp.got('p1')->'body'->>'proposal_id', pg_temp.got('p1')->'body'->>'payload_hash', pg_temp.h('ab2')),
  'PT409', 'STALE_VERSION', 'versão diferente não aprova');
insert into r select 'a1', pg_temp.approve('idem-ag-appr-000001', 'p1');
select ok((pg_temp.got('a1')->'body'->>'expires_at')::timestamptz <= now() + interval '15 minutes', 'aprovação vale 15 minutos');
select is((select state from public.agent_proposals where id = (pg_temp.got('p1')->'body'->>'proposal_id')::uuid), 'approved',
  'proposta aprovada');
select throws_ok(format($$ select public.action_approve(%L, %L, %L, 1, 'idem-ag-appr-000002', %L) $$,
  (select tenant_a from ids), pg_temp.got('p1')->'body'->>'proposal_id', pg_temp.got('p1')->'body'->>'payload_hash', pg_temp.h('a2')),
  'PT409', 'STALE_VERSION', 'segunda aprovação da mesma versão → 409 (AE-37)');
select is(pg_temp.approve('idem-ag-appr-000001', 'p1')->'body'->>'approval_id', pg_temp.got('a1')->'body'->>'approval_id',
  'repetir a mesma requisição devolve a mesma aprovação');
reset role;
select is((select count(*)::int from public.agent_approvals where proposal_id = (pg_temp.got('p1')->'body'->>'proposal_id')::uuid), 1,
  'uma única aprovação por proposta');
select is((select count(*)::int from public.outbox_events where event_type = 'agent.action.approved.v1'
  and aggregate_id = (pg_temp.got('p1')->'body'->>'proposal_id')::uuid), 1, 'evento agent.action.approved.v1 emitido uma vez');
select is((select count(*)::int from public.bookings where tenant_id = (select tenant_a from ids) and starts_at = pg_temp.at(3, '10:00')),
  0, 'aprovar não executa');

-- ------------------------------------------------------------------ execução idempotente (AE-37, AE-38)
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.action_execute(%L, %L, 'idem-ag-exec-b0001', %L) $$,
  (select tenant_a from ids), pg_temp.got('a1')->'body'->>'approval_id', pg_temp.h('xb')),
  'PT403', 'FORBIDDEN', 'dono de B não executa aprovação de A');
select throws_ok(format($$ select public.action_execute(%L, %L, 'idem-ag-exec-b0002', %L) $$,
  (select tenant_b from ids), pg_temp.got('a1')->'body'->>'approval_id', pg_temp.h('xb2')),
  'PT404', 'NOT_FOUND', 'aprovação de A não existe no negócio B');
select pg_temp.login_as((select owner_a from ids));
insert into r select 'x1', pg_temp.execute('idem-ag-exec-000001', 'a1');
select is(pg_temp.got('x1')->'body'->>'status', 'executed', 'execução gera recibo executado');
select is((select source || ':' || status || ':' || agreed_price_cents from public.bookings
  where id = (pg_temp.got('x1')->'body'->'result_ref'->>'id')::uuid), 'agent:confirmed:6000',
  'reserva criada pela agenda real, origem agent, preço da cotação');
insert into r select 'x1b', pg_temp.execute('idem-ag-exec-000002', 'a1');
select is(pg_temp.got('x1b')->'body', pg_temp.got('x1')->'body', 'retry com outra chave devolve o mesmo recibo (AE-38)');
select is((select count(*)::int from public.bookings where tenant_id = (select tenant_a from ids) and starts_at = pg_temp.at(3, '10:00')),
  1, 'uma única reserva');
select is((select state from public.agent_proposals where id = (pg_temp.got('p1')->'body'->>'proposal_id')::uuid), 'executed',
  'proposta executada');

-- ------------------------------------------------------------------ aprovação velha após a agenda mudar (AE-40)
insert into r select 'p2', pg_temp.propose_create('idem-ag-prop-000002', 1, '13:00', 6000);
insert into r select 'a2', pg_temp.approve('idem-ag-appr-000003', 'p2');
insert into r select 'b13', public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  null, 'Visitante', pg_temp.at(1, '13:00'), pg_temp.at(1, '13:30'), null, 'confirm', 'idem-ag-book-13-01', pg_temp.h('b13'));
insert into r select 'x2', pg_temp.execute('idem-ag-exec-000003', 'a2');
select is(pg_temp.got('x2')->'body'->>'status', 'rejected_by_policy', 'horário ocupado depois da aprovação: não executa');
select is((select reason_code from public.agent_receipts where approval_id = (pg_temp.got('a2')->'body'->>'approval_id')::uuid),
  'SLOT_CONFLICT', 'recibo explica o motivo');
select is((select state from public.agent_proposals where id = (pg_temp.got('p2')->'body'->>'proposal_id')::uuid), 'invalidated',
  'proposta invalidada');
select is((select count(*)::int from public.bookings where tenant_id = (select tenant_a from ids) and source = 'agent'
  and starts_at = pg_temp.at(1, '13:00')), 0, 'nenhuma reserva do assistente no horário ocupado');
select throws_ok(format($$ select public.action_approve(%L, %L, %L, 1, 'idem-ag-appr-000004', %L) $$,
  (select tenant_a from ids), pg_temp.got('p2')->'body'->>'proposal_id', pg_temp.got('p2')->'body'->>'payload_hash', pg_temp.h('a4')),
  'PT409', 'STALE_VERSION', 'reaprovar a proposta velha falha: precisa de nova proposta');
select is(pg_temp.execute('idem-ag-exec-000004', 'a2')->'body'->>'status', 'rejected_by_policy', 'recusa também é idempotente');

-- ------------------------------------------------------------------ preço mudou entre proposta e execução
insert into r select 'p3', pg_temp.propose_create('idem-ag-prop-000003', 4, '10:00', 5000);
insert into r select 'a3', pg_temp.approve('idem-ag-appr-000005', 'p3');
select is(pg_temp.execute('idem-ag-exec-000005', 'a3')->'body'->>'status', 'rejected_by_policy',
  'preço atual diferente do aprovado não executa');
select is((select reason_code from public.agent_receipts where approval_id = (pg_temp.got('a3')->'body'->>'approval_id')::uuid),
  'POLICY_REJECTED', 'motivo: política (preço)');

-- ------------------------------------------------------------------ prazos
insert into r select 'p4', pg_temp.propose_create('idem-ag-prop-000004', 4, '11:00', 6000);
reset role;
update public.agent_proposals set expires_at = now() - interval '1 minute'
where id = (pg_temp.got('p4')->'body'->>'proposal_id')::uuid;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.action_approve(%L, %L, %L, %s, 'idem-ag-appr-000006', %L) $$,
  (select tenant_a from ids), pg_temp.got('p4')->'body'->>'proposal_id', pg_temp.got('p4')->'body'->>'payload_hash',
  (select version from public.agent_proposals where id = (pg_temp.got('p4')->'body'->>'proposal_id')::uuid), pg_temp.h('a6')),
  'PT422', 'POLICY_REJECTED', 'proposta vencida não é aprovada');
insert into r select 'p5', pg_temp.propose_create('idem-ag-prop-000005', 4, '12:00', 6000);
insert into r select 'a5', pg_temp.approve('idem-ag-appr-000007', 'p5');
reset role;
set local session_replication_role = replica;
update public.agent_approvals set expires_at = now() - interval '1 minute'
where id = (pg_temp.got('a5')->'body'->>'approval_id')::uuid;
set local session_replication_role = origin;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.execute('idem-ag-exec-000006', 'a5')->'body'->>'status', 'rejected_by_policy', 'aprovação vencida não executa');
select is((select state from public.agent_proposals where id = (pg_temp.got('p5')->'body'->>'proposal_id')::uuid), 'expired',
  'proposta marcada como vencida');

-- ------------------------------------------------------------------ reagendar e cancelar pela agenda real
insert into r select 'p6', public.agent_proposal_create((select tenant_a from ids), null, 'booking.reschedule',
  jsonb_build_object('booking_id', pg_temp.got('x1')->'body'->'result_ref'->>'id', 'expected_version', 1,
    'starts_at', pg_temp.ts(pg_temp.at(3, '16:00')), 'ends_at', pg_temp.ts(pg_temp.at(3, '16:30'))),
  'Remarcar para 16:00', 'idem-ag-prop-000006', pg_temp.h('p6'));
insert into r select 'a6', pg_temp.approve('idem-ag-appr-000008', 'p6');
select is(pg_temp.execute('idem-ag-exec-000007', 'a6')->'body'->>'status', 'executed', 'reagendamento aprovado executa');
select is((select pg_temp.ts(starts_at) || ':' || version from public.bookings
  where id = (pg_temp.got('x1')->'body'->'result_ref'->>'id')::uuid), pg_temp.ts(pg_temp.at(3, '16:00')) || ':2',
  'reserva remarcada uma vez (versão 2)');
insert into r select 'p7', public.agent_proposal_create((select tenant_a from ids), null, 'booking.cancel',
  jsonb_build_object('booking_id', pg_temp.got('x1')->'body'->'result_ref'->>'id', 'expected_version', 1, 'reason', 'Pedido do dono'),
  'Cancelar', 'idem-ag-prop-000007', pg_temp.h('p7'));
insert into r select 'a7', pg_temp.approve('idem-ag-appr-000009', 'p7');
select is(pg_temp.execute('idem-ag-exec-000008', 'a7')->'body'->>'status', 'rejected_by_policy',
  'cancelamento com versão velha da reserva não executa');
select is((select status from public.bookings where id = (pg_temp.got('x1')->'body'->'result_ref'->>'id')::uuid), 'confirmed',
  'reserva continua confirmada');

-- ------------------------------------------------------------------ regra de preço: vira proposta do P05, não publica
insert into r select 'p8', public.agent_proposal_create((select tenant_a from ids), null, 'pricing.propose_rule',
  jsonb_build_object('weekday', 'tuesday', 'discount_bps', 5000, 'valid_from', pg_temp.ts(now()), 'valid_to', pg_temp.ts(now() + interval '90 days'),
    'rules', jsonb_build_array(
      jsonb_build_object('service_id', (select corte_a from ids), 'windows', '[{"weekday":2,"local_start":"09:00","local_end":"19:00"}]'::jsonb,
        'discount_bps', 5000, 'max_discount_bps', 5000, 'target_margin_bps', 0),
      jsonb_build_object('service_id', (select barba_a from ids), 'windows', '[{"weekday":2,"local_start":"09:00","local_end":"19:00"}]'::jsonb,
        'discount_bps', 5000, 'max_discount_bps', 5000, 'target_margin_bps', 0))),
  'Proposta de regra: 50% às terças, com piso', 'idem-ag-prop-000008', pg_temp.h('p8'));
insert into r select 'a8', pg_temp.approve('idem-ag-appr-000010', 'p8');
insert into r select 'x8', pg_temp.execute('idem-ag-exec-000009', 'a8');
select is(pg_temp.got('x8')->'body'->'result_ref'->>'kind', 'pricing_proposal', 'regra vira proposta de preço');
reset role;
select is((select count(*)::int from public.pricing_rule_proposals where tenant_id = (select tenant_a from ids)
  and discount_bps = 5000 and status = 'proposed'), 2, 'uma proposta de regra por serviço, pendente');
select is((select count(*)::int from public.pricing_rules where tenant_id = (select tenant_a from ids) and active), 0,
  'nenhuma regra publicada sem a tela de preços');

-- ------------------------------------------------------------------ auditoria sem texto livre
select ok(not exists (select 1 from public.audit_events where (action like 'agent.%' or action like 'action.%')
  and (coalesce(after::text, '') ~ 'Cliente AB|Corte|Remarcar|summary')), 'auditoria do assistente só com IDs e estados');
select is((select count(*)::int from public.audit_events where action = 'action.execute'), 7, 'cada execução auditada uma vez');

select * from finish();
rollback;

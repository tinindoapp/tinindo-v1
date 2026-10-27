-- P28 · Equipes e recursos: profissionais, salas e cadeiras; reserva composta tudo ou nada (o conflito de UM recurso
-- desfaz a reserva inteira, sem alocação órfã); agenda individual vinculada nos dois sentidos; turmas com lotação;
-- comissão congelada, lançada uma vez e estornada uma vez; recebível no Caixa; isolamento, RLS e auditoria sem nomes.
-- A corrida de várias conexões pelo mesmo recurso está em tests/db-concurrency/25_team_resources.sh.
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000b1'::uuid as sessao_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '30000000-0000-4000-8000-0000000000a2'::uuid as carlos,
  -- Daqui a 3 dias, horário local de São Paulo.
  (((now() at time zone 'America/Sao_Paulo')::date + 3) + time '10:00') at time zone 'America/Sao_Paulo' as t10,
  (((now() at time zone 'America/Sao_Paulo')::date + 3) + time '13:00') at time zone 'America/Sao_Paulo' as t13,
  (((now() at time zone 'America/Sao_Paulo')::date + 3) + time '15:00') at time zone 'America/Sao_Paulo' as t15,
  (((now() at time zone 'America/Sao_Paulo')::date + 3) + time '17:00') at time zone 'America/Sao_Paulo' as t17,
  (((now() at time zone 'America/Sao_Paulo')::date + 3) + time '23:00') at time zone 'America/Sao_Paulo' as t23;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.id(p_k text, p_path text[]) returns uuid language sql as $$ select (v #>> p_path)::uuid from r where k = p_k $$;
-- Código/mensagem/campo de um erro (throws_ok não confere o campo; o campo diz QUAL recurso está ocupado).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return v_state || '/' || v_msg || '/' || coalesce(nullif(v_hint, ''), '-');
end $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.id(text, text[]), pg_temp.err(text) to anon, authenticated;
create function pg_temp.save(p_k text, p_kind text, p_name text, p_bps integer, p_link boolean) returns jsonb language sql as $$
  insert into r select p_k, public.resources_save((select tenant_a from ids), null, null, p_kind, p_name, true, p_bps, p_link, 'idem-tm-save-' || p_k || '-000000', pg_temp.h(p_k)) returning v
$$;
create function pg_temp.book(p_k text, p_prof text, p_others uuid[], p_at timestamptz, p_customer uuid default null) returns text language sql as $$
  select pg_temp.err(format($f$ insert into r select %L, public.resources_booking_create(%L, %L, %L, %L, %L, %L, %L, %L) $f$,
    p_k, (select tenant_a from ids), (select corte_a from ids), p_customer, pg_temp.id(p_prof, '{body,resource,id}'), p_others, p_at,
    'idem-tm-book-' || p_k || '-000000', pg_temp.h(p_k)))
$$;
grant execute on function pg_temp.save(text, text, text, integer, boolean), pg_temp.book(text, text, uuid[], timestamptz, uuid) to authenticated;

-- Horário de funcionamento: agenda principal de A, todos os dias, 08:00–20:00.
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select tenant_a, res_a, d, '08:00', '20:00' from ids, generate_series(0, 6) d;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'team\_%'), 'RLS ligada em todas as tabelas da equipe');
select ok(not has_table_privilege('authenticated', 'public.team_allocations', 'insert')
  and not has_table_privilege('authenticated', 'public.team_bookings', 'update'), 'escrita só por RPC');
select ok(not has_column_privilege('authenticated', 'public.team_bookings', 'status_reason', 'select'), 'motivo do cancelamento fora da leitura direta');
select ok(not has_function_privilege('anon', 'public.resources_booking_create(uuid, uuid, uuid, uuid, uuid[], timestamptz, text, text, uuid)', 'execute'), 'anon não reserva');
select ok(not has_function_privilege('authenticated', 'app.tm_allocate(uuid, uuid, uuid, public.team_resources, uuid[], tstzrange, timestamptz, timestamptz)', 'execute'),
  'alocação só por dentro das RPCs');

-- ------------------------------------------------------------------ recursos e comissão
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select pg_temp.save('bia', 'professional', 'Bia', 4000, false);
select pg_temp.save('caio', 'professional', 'Caio', null, true);
select pg_temp.save('sala', 'room', 'Sala 1', null, false);
select pg_temp.save('cad', 'chair', 'Cadeira 1', null, false);
select is((pg_temp.got('bia')->>'status_code')::int, 201, 'profissional criado');
select is(pg_temp.got('caio')->'body'->'resource'->>'agenda_linked', 'true', 'Caio vinculado à agenda individual');
select is(public.resources_save((select tenant_a from ids), null, null, 'professional', 'Bia', true, 4000, false, 'idem-tm-save-bia-000000', pg_temp.h('bia')),
  pg_temp.got('bia'), 'repetir devolve o mesmo recurso');
select is(pg_temp.err(format($$ select public.resources_save(%L, null, null, 'professional', 'Outra', true, 1, false, 'idem-tm-save-bia-000000', %L) $$,
  (select tenant_a from ids), pg_temp.h('outro'))), 'PT409/IDEMPOTENCY_MISMATCH/-', 'mesma chave com outro conteúdo');
select is(pg_temp.err(format($$ select public.resources_save(%L, null, null, 'room', 'Sala 2', true, 1000, false, 'idem-tm-save-x-0000001', %L) $$,
  (select tenant_a from ids), pg_temp.h('x1'))), 'PT400/VALIDATION_ERROR/commission_bps', 'comissão só para profissional');
select is(pg_temp.err(format($$ select public.resources_save(%L, null, null, 'room', 'sala 1', true, null, false, 'idem-tm-save-x-0000002', %L) $$,
  (select tenant_a from ids), pg_temp.h('x2'))), 'PT422/POLICY_REJECTED/name', 'nome repetido no mesmo tipo');
select is(pg_temp.err(format($$ select public.resources_save(%L, null, null, 'professional', 'Duda', true, null, true, 'idem-tm-save-x-0000003', %L) $$,
  (select tenant_a from ids), pg_temp.h('x3'))), 'PT422/POLICY_REJECTED/name', 'a agenda individual vincula um profissional só');
insert into r select 'rule', public.resources_commission_rule_save((select tenant_a from ids), pg_temp.id('bia', '{body,resource,id}'), (select corte_a from ids), 5000,
  'idem-tm-rule-0000001', pg_temp.h('rule'));
select is((pg_temp.got('rule')->'body'->'commission_rules'->0->>'bps')::int, 5000, 'regra de comissão de Bia no corte');

-- ------------------------------------------------------------------ reserva composta: tudo ou nada
select is(pg_temp.book('b1', 'bia', array[pg_temp.id('cad', '{body,resource,id}')], (select t10 from ids), (select ana from ids)), 'ok', 'Bia + Cadeira 1 reservadas juntas');
select is((pg_temp.got('b1')->'body'->'booking'->>'commission_bps')::int, 5000, 'comissão congelada pela regra do serviço');
select is((pg_temp.got('b1')->'body'->'booking'->>'agreed_price_cents')::bigint, 6000::bigint, 'preço do serviço congelado');
select is(jsonb_array_length(pg_temp.got('b1')->'body'->'booking'->'resources'), 2, 'duas alocações');
-- Caio está livre, a cadeira não: a reserva inteira é recusada e nada de Caio fica preso.
select is(pg_temp.book('b2', 'caio', array[pg_temp.id('cad', '{body,resource,id}')], (select t10 from ids) + interval '15 minutes'), 'PT409/SLOT_CONFLICT/chair',
  'cadeira ocupada: conflito diz o recurso');
-- Bia ocupada, sala livre: a sala não fica presa.
select is(pg_temp.book('b3', 'bia', array[pg_temp.id('sala', '{body,resource,id}')], (select t10 from ids)), 'PT409/SLOT_CONFLICT/professional', 'profissional ocupado');
reset role;
select is((select count(*)::int from public.team_bookings), 1, 'nenhuma reserva parcial gravada');
select is((select count(*)::int from public.team_allocations where resource_id in (select (v #>> '{body,resource,id}')::uuid from r where k in ('caio', 'sala'))), 0,
  'nenhum recurso comprometido pela metade');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.book('b4', 'caio', array[pg_temp.id('cad', '{body,resource,id}'), pg_temp.id('cad', '{body,resource,id}')], (select t13 from ids)),
  'PT400/VALIDATION_ERROR/resource_ids', 'recurso repetido');
select is(pg_temp.book('b5', 'caio', array[pg_temp.id('bia', '{body,resource,id}')], (select t13 from ids)), 'PT400/VALIDATION_ERROR/resource_ids', 'um profissional por reserva');
select is(pg_temp.book('b6', 'caio', null, (select t23 from ids)), 'PT409/SLOT_CONFLICT/hours', 'fora do horário de funcionamento');
select is(pg_temp.book('b7', 'caio', null, now() - interval '1 hour'), 'PT400/VALIDATION_ERROR/starts_at', 'horário no passado');

-- Disponibilidade combinada: o horário de Bia + cadeira some; uma hora depois está livre.
insert into r select 'av', public.resources_availability((select tenant_a from ids), (select corte_a from ids), pg_temp.id('bia', '{body,resource,id}'),
  array[pg_temp.id('cad', '{body,resource,id}')], (select t10 from ids) - interval '2 hours', (select t10 from ids) + interval '4 hours');
select ok(not (pg_temp.got('av')->'slots') @> jsonb_build_array(jsonb_build_object('starts_at', to_char((select t10 from ids) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))), 'horário ocupado não aparece');
select ok((pg_temp.got('av')->'slots') @> jsonb_build_array(jsonb_build_object('starts_at', to_char(((select t10 from ids) + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))), 'horário livre aparece');

-- ------------------------------------------------------------------ agenda individual vinculada (mão dupla)
insert into r select 'solo', public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids), (select ana from ids), null,
  (select t13 from ids), (select t13 from ids) + interval '30 minutes', null, 'confirm', 'idem-tm-solo-000001', pg_temp.h('solo'));
select is(pg_temp.book('b8', 'caio', null, (select t13 from ids)), 'PT409/SLOT_CONFLICT/agenda', 'Caio tem atendimento na agenda individual');
select is(pg_temp.book('b9', 'caio', array[pg_temp.id('sala', '{body,resource,id}')], (select t15 from ids)), 'ok', 'Caio + Sala 1 às 15h');
select is(pg_temp.err(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, %L, %L, null, 'confirm', 'idem-tm-solo-000002', %L) $$,
  (select tenant_a from ids), (select res_a from ids), (select corte_a from ids), (select t15 from ids), (select t15 from ids) + interval '30 minutes', pg_temp.h('solo2'))),
  'PT409/SLOT_CONFLICT/team', 'a agenda individual não reserva por cima da equipe');
select is(pg_temp.err(format($$ select public.scheduling_block_create(%L, %L, %L, %L, 'Almoço', 'idem-tm-block-00001', %L) $$,
  (select tenant_a from ids), (select res_a from ids), (select t15 from ids), (select t15 from ids) + interval '1 hour', pg_temp.h('blk'))),
  'PT409/SLOT_CONFLICT/team', 'nem bloqueia por cima da equipe');

-- ------------------------------------------------------------------ cancelar libera todos os recursos de uma vez
insert into r select 'c9', public.resources_booking_cancel((select tenant_a from ids), pg_temp.id('b9', '{body,booking,id}'), 1, 'remarcou', 'idem-tm-cancel-00001', pg_temp.h('c9'));
select is(pg_temp.got('c9')->'body'->'booking'->>'status', 'cancelled', 'reserva cancelada');
select is(pg_temp.book('b10', 'bia', array[pg_temp.id('sala', '{body,resource,id}')], (select t15 from ids)), 'ok', 'sala liberada na hora');
select is(public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids), null, null,
  (select t15 from ids), (select t15 from ids) + interval '30 minutes', null, 'confirm', 'idem-tm-solo-000003', pg_temp.h('solo3'))->>'status_code', '201',
  'agenda individual de Caio liberada');
select is(pg_temp.err(format($$ select public.resources_booking_cancel(%L, %L, 1, null, 'idem-tm-cancel-00002', %L) $$,
  (select tenant_a from ids), pg_temp.id('b9', '{body,booking,id}'), pg_temp.h('c9b'))), 'PT409/STALE_VERSION/-', 'cancelar de novo exige a versão vista');

-- ------------------------------------------------------------------ concluir: recebível e comissão uma vez
reset role;
update public.team_bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes',
  occupied_range = tstzrange(now() - interval '2 hours', now() - interval '80 minutes', '[)') where id = pg_temp.id('b1', '{body,booking,id}');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.resources_booking_complete(%L, %L, 1, 'idem-tm-done-000001', %L) $$,
  (select tenant_a from ids), pg_temp.id('b10', '{body,booking,id}'), pg_temp.h('d0'))), 'PT422/POLICY_REJECTED/starts_at', 'não conclui antes do início');
insert into r select 'd1', public.resources_booking_complete((select tenant_a from ids), pg_temp.id('b1', '{body,booking,id}'), 2, 'idem-tm-done-000002', pg_temp.h('d1'));
select is(pg_temp.got('d1')->'body'->'booking'->>'status', 'completed', 'concluída');
select is((pg_temp.got('d1')->'body'->'booking'->>'commission_cents')::bigint, 3000::bigint, 'comissão de 50% sobre R$ 60');
select is(public.resources_booking_complete((select tenant_a from ids), pg_temp.id('b1', '{body,booking,id}'), 2, 'idem-tm-done-000002', pg_temp.h('d1')),
  pg_temp.got('d1'), 'repetir a conclusão devolve a mesma resposta');
select is(pg_temp.err(format($$ select public.resources_booking_complete(%L, %L, 3, 'idem-tm-done-000003', %L) $$,
  (select tenant_a from ids), pg_temp.id('b1', '{body,booking,id}'), pg_temp.h('d3'))), 'PT422/POLICY_REJECTED/status', 'concluir de novo com outra chave é recusado');
reset role;
select is((select count(*)::int from public.team_commission_entries where booking_id = pg_temp.id('b1', '{body,booking,id}')), 1, 'um lançamento de comissão');
select is((select amount_cents from public.receivables where id = pg_temp.id('d1', '{body,booking,receivable_id}')), 6000::bigint, 'recebível no Caixa pelo preço combinado');
select is((select status from public.receivables where id = pg_temp.id('d1', '{body,booking,receivable_id}')), 'open', 'concluir não é receber');

-- ------------------------------------------------------------------ estorno de comissão e relatório
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'com', public.resources_commissions((select tenant_a from ids), now() - interval '1 day', now() + interval '1 day');
insert into r select 'rev', public.resources_commission_reverse((select tenant_a from ids), (pg_temp.got('com')->'entries'->0->>'id')::uuid, 'idem-tm-rev-0000001', pg_temp.h('rev'));
select is((pg_temp.got('rev')->'body'->'entry'->>'amount_cents')::bigint, -3000::bigint, 'estorno com o valor negativo');
select is(pg_temp.err(format($$ select public.resources_commission_reverse(%L, %L, 'idem-tm-rev-0000002', %L) $$,
  (select tenant_a from ids), pg_temp.got('com')->'entries'->0->>'id', pg_temp.h('rev2'))), 'PT422/POLICY_REJECTED/reversed', 'estorno uma vez só');
select is(pg_temp.err(format($$ select public.resources_commission_reverse(%L, %L, 'idem-tm-rev-0000003', %L) $$,
  (select tenant_a from ids), pg_temp.got('rev')->'body'->'entry'->>'id', pg_temp.h('rev3'))), 'PT422/POLICY_REJECTED/kind', 'estorno não se estorna');
insert into r select 'com2', public.resources_commissions((select tenant_a from ids), now() - interval '1 day', now() + interval '1 day');
select is((pg_temp.got('com2')->'professionals'->0) - 'professional_id'::text,
  '{"professional_name": "Bia", "base_cents": 6000, "accrued_cents": 3000, "reversed_cents": -3000, "net_cents": 0, "entries": 2}'::jsonb, 'relatório por profissional');

-- ------------------------------------------------------------------ turmas: lotação, uma vaga por cliente, presença
insert into r select 'k1', public.resources_class_create((select tenant_a from ids), (select corte_a from ids), pg_temp.id('bia', '{body,resource,id}'),
  pg_temp.id('sala', '{body,resource,id}'), 'Turma da manhã', (select t17 from ids), 1, 3000, 'idem-tm-class-000001', pg_temp.h('k1'));
select is((pg_temp.got('k1')->>'status_code')::int, 201, 'turma criada com profissional e sala');
select is(pg_temp.err(format($$ select public.resources_class_create(%L, %L, %L, null, 'Outra', %L, 5, null, 'idem-tm-class-000002', %L) $$,
  (select tenant_a from ids), (select corte_a from ids), pg_temp.id('bia', '{body,resource,id}'), (select t17 from ids), pg_temp.h('k2'))),
  'PT409/SLOT_CONFLICT/professional', 'turma não sobrepõe a profissional');
insert into r select 'e1', public.resources_class_enroll((select tenant_a from ids), pg_temp.id('k1', '{body,class,id}'), (select ana from ids), 'idem-tm-enroll-00001', pg_temp.h('e1'));
select is((pg_temp.got('e1')->'body'->'class'->>'booked')::int, 1, 'uma vaga ocupada');
select is(pg_temp.err(format($$ select public.resources_class_enroll(%L, %L, %L, 'idem-tm-enroll-00002', %L) $$,
  (select tenant_a from ids), pg_temp.id('k1', '{body,class,id}'), (select carlos from ids), pg_temp.h('e2'))), 'PT422/POLICY_REJECTED/capacity', 'turma lotada');
insert into r select 'seatc', public.resources_class_seat_cancel((select tenant_a from ids), (pg_temp.got('e1')->'body'->'class'->'seats'->0->>'id')::uuid, 1,
  'idem-tm-seatc-00001', pg_temp.h('seatc'));
select is((pg_temp.got('seatc')->'body'->'class'->>'booked')::int, 0, 'vaga liberada');
insert into r select 'e3', public.resources_class_enroll((select tenant_a from ids), pg_temp.id('k1', '{body,class,id}'), (select carlos from ids), 'idem-tm-enroll-00003', pg_temp.h('e3'));
select is((pg_temp.got('e3')->'body'->'class'->>'booked')::int, 1, 'Carlos entra na vaga liberada');
reset role;
update public.team_classes set capacity = 3, starts_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes',
  occupied_range = tstzrange(now() - interval '1 hour', now() - interval '20 minutes', '[)') where id = pg_temp.id('k1', '{body,class,id}');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'e4', public.resources_class_enroll((select tenant_a from ids), pg_temp.id('k1', '{body,class,id}'), (select ana from ids), 'idem-tm-enroll-00004', pg_temp.h('e4'));
select is(pg_temp.err(format($$ select public.resources_class_enroll(%L, %L, %L, 'idem-tm-enroll-00005', %L) $$,
  (select tenant_a from ids), pg_temp.id('k1', '{body,class,id}'), (select ana from ids), pg_temp.h('e5'))), 'PT422/POLICY_REJECTED/seat', 'uma vaga por cliente');
insert into r select 'kc', public.resources_class_complete((select tenant_a from ids), pg_temp.id('k1', '{body,class,id}'),
  (select version from public.team_classes where id = pg_temp.id('k1', '{body,class,id}')),
  array[(select id from public.team_class_seats where class_id = pg_temp.id('k1', '{body,class,id}') and customer_id = (select ana from ids) and status = 'booked')],
  'idem-tm-classdone-01', pg_temp.h('kc'));
select is(pg_temp.got('kc')->'body'->'class'->>'status', 'completed', 'turma concluída');
select is((pg_temp.got('kc')->'body'->'class'->>'commission_cents')::bigint, 1500::bigint, 'comissão sobre a presença (1 × R$ 30 × 50%)');
reset role;
select is((select string_agg(s.status, ',' order by c.name) from public.team_class_seats s join public.customers c on c.id = s.customer_id
  where s.class_id = pg_temp.id('k1', '{body,class,id}') and s.status <> 'cancelled'), 'attended,no_show', 'presente atendida; ausente vira falta');
select is((select count(*)::int from public.receivables where description = 'Turma Turma da manhã'), 1, 'um recebível por presença');

-- ------------------------------------------------------------------ isolamento e privacidade
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.resources_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não lista recursos de A');
select throws_ok(format($$ select public.resources_booking_create(%L, %L, null, %L, null, %L, 'idem-tm-b-000000001', %L) $$,
  (select tenant_a from ids), (select corte_a from ids), pg_temp.id('bia', '{body,resource,id}'), (select t10 from ids) + interval '2 hours', pg_temp.h('bb')),
  'PT403', 'FORBIDDEN', 'B não reserva em A');
select is(pg_temp.err(format($$ select public.resources_booking_create(%L, %L, null, %L, null, %L, 'idem-tm-b-000000002', %L) $$,
  (select tenant_b from ids), (select sessao_b from ids), pg_temp.id('bia', '{body,resource,id}'), (select t10 from ids), pg_temp.h('bb2'))),
  'PT404/NOT_FOUND/resource_ids', 'B não usa o profissional de A no próprio negócio');
select is((select count(*)::int from public.team_resources) + (select count(*)::int from public.team_bookings) + (select count(*)::int from public.team_commission_entries), 0,
  'RLS: B não vê nada da equipe de A');
select pg_temp.login_as((select customer_ab from ids));
select is((select count(*)::int from public.team_bookings) + (select count(*)::int from public.team_class_seats), 0, 'cliente com login não lê a agenda da equipe');
reset role;
select is((select count(*)::int from public.audit_events where action like 'resources.%' and coalesce(after::text, '') ~ 'Cliente|remarcou'), 0,
  'auditoria sem nomes nem motivo');

select * from finish();
rollback;

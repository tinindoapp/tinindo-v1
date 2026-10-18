-- P03 · Motor de agenda: expediente, disponibilidade, reservas, holds, reagendamento, cancelamento,
-- conclusão/falta, bloqueios, recorrência, isolamento A/B, idempotência e a constraint de exclusão.
-- Datas relativas a now(): a semana seguinte, em America/Sao_Paulo (timezone dos tenants do seed).
begin;
create extension if not exists pgtap with schema extensions;
select plan(93);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
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
create function pg_temp.bid(p_k text) returns uuid language sql as $$ select (v->'body'->'booking'->>'id')::uuid from r where k = p_k $$;
/** Instante local: segunda-feira da próxima semana + p_days, às p_hhmm, em São Paulo. */
create function pg_temp.at(p_days integer, p_hhmm text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + p_days) + p_hhmm::time)
         at time zone 'America/Sao_Paulo'
$$;
create function pg_temp.has_slot(p_avail jsonb, p_ts timestamptz) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(p_avail->'slots') e where (e->>'starts_at')::timestamptz = p_ts)
$$;
/** Corte (30 min, 10 min depois) para a cliente de A, modo confirm. */
create function pg_temp.corte(p_key text, p_days integer, p_hhmm text, p_mode text default 'confirm') returns jsonb
language sql as $$
  select public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
    (select cust_a from ids), null, pg_temp.at(p_days, p_hhmm), pg_temp.at(p_days, p_hhmm) + interval '30 minutes',
    null, p_mode, p_key, pg_temp.h(p_key || p_days || p_hhmm || p_mode))
$$;
create function pg_temp.avail(p_days integer) returns jsonb language sql as $$
  select public.scheduling_availability((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
    pg_temp.at(p_days, '00:00'), pg_temp.at(p_days + 1, '00:00'))
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.bid(text), pg_temp.at(integer, text),
  pg_temp.has_slot(jsonb, timestamptz), pg_temp.corte(text, integer, text, text), pg_temp.avail(integer)
  to anon, authenticated;

-- ------------------------------------------------------------------ estrutura e privilégios
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('bookings', 'availability_rules', 'availability_blocks')),
  'RLS ligada nas tabelas da agenda');
select ok(exists (select 1 from pg_constraint where conname = 'bookings_no_overlap' and contype = 'x'),
  'constraint de exclusão de sobreposição existe');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'insert'), 'authenticated não insere reserva direto');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'update'), 'authenticated não altera reserva direto');
select ok(not has_column_privilege('authenticated', 'public.bookings', 'status_reason', 'select'),
  'motivo de cancelamento/falta não é legível direto (nem pelo cliente vinculado)');
select ok(not has_function_privilege('anon',
  'public.scheduling_booking_create(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid)',
  'execute'), 'anon não cria reserva');
select ok(not has_function_privilege('authenticated', 'public.scheduling_expire_holds()', 'execute'),
  'varredura de holds é só do backend');
select ok(not has_function_privilege('authenticated',
  'app.sched_insert_booking(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, uuid, uuid)',
  'execute'), 'inserção interna não é exposta');

-- ------------------------------------------------------------------ expediente
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'settings0', public.scheduling_settings((select tenant_a from ids));
select is(pg_temp.got('settings0')->'rules', '[]'::jsonb, 'negócio novo começa sem expediente');
select is(jsonb_array_length(pg_temp.avail(0)->'slots'), 0, 'sem expediente não há horário livre');

insert into r select 'rules', public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (pg_temp.got('settings0')->>'resource_version')::int,
  (select jsonb_agg(x) from (
     select jsonb_build_object('weekday', d, 'local_start', '09:00', 'local_end', '12:00') x from generate_series(1, 5) d
     union all
     select jsonb_build_object('weekday', d, 'local_start', '13:00', 'local_end', '19:00') from generate_series(1, 5) d
     union all
     select jsonb_build_object('weekday', 6, 'local_start', '09:00', 'local_end', '14:00')) s),
  'idem-rules-a-000001', pg_temp.h('rules'));
select is(jsonb_array_length(pg_temp.got('rules')->'body'->'rules'), 11, 'expediente salvo (11 faixas)');
select is((pg_temp.got('rules')->'body'->>'resource_version')::int,
  (pg_temp.got('settings0')->>'resource_version')::int + 1, 'salvar expediente sobe a versão do recurso');
select throws_ok(format($$ select public.scheduling_rules_save(%L, %L, %s, '[]'::jsonb, 'idem-rules-stale-01', %L) $$,
  (select tenant_a from ids), (select res_a from ids), (pg_temp.got('settings0')->>'resource_version')::int,
  pg_temp.h('stale')), 'PT409', 'STALE_VERSION', 'expediente com versão antiga → 409');
select throws_ok(format($$ select public.scheduling_rules_save(%L, %L, %s,
  '[{"weekday":1,"local_start":"09:00","local_end":"12:00"},{"weekday":1,"local_start":"11:00","local_end":"13:00"}]'::jsonb,
  'idem-rules-overlap1', %L) $$, (select tenant_a from ids), (select res_a from ids),
  (pg_temp.got('rules')->'body'->>'resource_version')::int, pg_temp.h('ov')),
  'PT400', 'VALIDATION_ERROR', 'faixas sobrepostas no mesmo dia negadas');
select throws_ok(format($$ select public.scheduling_rules_save(%L, %L, 1, '[]'::jsonb, 'idem-rules-cross-01', %L) $$,
  (select tenant_a from ids), (select res_b from ids), pg_temp.h('cross')),
  'PT404', 'NOT_FOUND', 'recurso de B não é editável pelo tenant A');
reset role;

select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_rules_save(%L, %L, 1, '[]'::jsonb, 'idem-rules-b-in-a01', %L) $$,
  (select tenant_a from ids), (select res_a from ids), pg_temp.h('bina')),
  'PT403', 'FORBIDDEN', 'dono B não edita o expediente de A');
select throws_ok('select pg_temp.avail(0)', 'PT403', 'FORBIDDEN', 'dono B não vê horários de A');
reset role;

-- ------------------------------------------------------------------ disponibilidade
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'av_mon', pg_temp.avail(0);
select ok(pg_temp.has_slot(pg_temp.got('av_mon'), pg_temp.at(0, '09:00')), 'segunda 09:00 livre');
select ok(pg_temp.has_slot(pg_temp.got('av_mon'), pg_temp.at(0, '11:30')), 'segunda 11:30 cabe antes da pausa');
select ok(not pg_temp.has_slot(pg_temp.got('av_mon'), pg_temp.at(0, '12:00')), 'pausa do almoço não é oferecida');
select ok(not pg_temp.has_slot(pg_temp.got('av_mon'), pg_temp.at(0, '18:45')), 'atendimento que passa do fechamento não é oferecido');
select is(jsonb_array_length(pg_temp.avail(6)->'slots'), 0, 'domingo fechado');
select ok(pg_temp.got('av_mon')::text !~ '"customer|tenant_id|booking', 'horários não carregam dados de reservas');

-- ------------------------------------------------------------------ criar, repetir, conflitar
insert into r select 'b1', pg_temp.corte('idem-b1-0000000001', 0, '10:00');
select is((pg_temp.got('b1')->>'status_code')::int, 201, 'reserva confirmada → 201');
select is(pg_temp.got('b1')->'body'->'booking'->>'status', 'confirmed', 'estado confirmed');
select is((pg_temp.got('b1')->'body'->'booking'->>'agreed_price_cents')::int, 6000, 'preço base congelado na confirmação');
select is(pg_temp.corte('idem-b1-0000000001', 0, '10:00'), pg_temp.got('b1'), 'mesma chave → mesma resposta');
select throws_ok($$ select pg_temp.corte('idem-b1-0000000001', 0, '11:00') $$, 'PT409', 'IDEMPOTENCY_MISMATCH',
  'mesma chave com outro horário → 409');
select throws_ok($$ select pg_temp.corte('idem-b1-overlap-01', 0, '10:15') $$, 'PT409', 'SLOT_CONFLICT',
  'horário sobreposto → SLOT_CONFLICT');
select throws_ok($$ select pg_temp.corte('idem-b1-buffer-001', 0, '10:30') $$, 'PT409', 'SLOT_CONFLICT',
  'intervalo depois do serviço ocupa a agenda');
select throws_ok($$ select pg_temp.corte('idem-closed-000001', 0, '12:00') $$, 'PT409', 'SLOT_CONFLICT',
  'fora do expediente → SLOT_CONFLICT');
insert into r select 'av_mon2', pg_temp.avail(0);
select ok(not pg_temp.has_slot(pg_temp.got('av_mon2'), pg_temp.at(0, '10:30')), 'horário ocupado some da lista');
select ok(pg_temp.has_slot(pg_temp.got('av_mon2'), pg_temp.at(0, '10:45')), 'depois do intervalo volta a ficar livre');

select throws_ok(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, now() - interval '1 day',
  now() - interval '1 day' + interval '30 minutes', null, 'confirm', 'idem-past-0000001', %L) $$,
  (select tenant_a from ids), (select res_a from ids), (select corte_a from ids), pg_temp.h('past')),
  'PT400', 'VALIDATION_ERROR', 'horário no passado negado');
select throws_ok(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, %L, %L, null, 'confirm',
  'idem-duration-0001', %L) $$, (select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  pg_temp.at(1, '09:00'), pg_temp.at(1, '10:00'), pg_temp.h('dur')),
  'PT400', 'VALIDATION_ERROR', 'duração diferente da do serviço negada');
select throws_ok(format($$ select public.scheduling_booking_create(%L, %L, %L, %L, null, %L, %L, null, 'confirm',
  'idem-cust-b-000001', %L) $$, (select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  (select cust_b from ids), pg_temp.at(1, '09:00'), pg_temp.at(1, '09:30'), pg_temp.h('custb')),
  'PT404', 'NOT_FOUND', 'cliente de B não entra na agenda de A');
select throws_ok(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, %L, %L, null, 'confirm',
  'idem-svc-b-0000001', %L) $$, (select tenant_a from ids), (select res_a from ids), (select treino_b from ids),
  pg_temp.at(1, '09:00'), pg_temp.at(1, '10:00'), pg_temp.h('svcb')),
  'PT404', 'NOT_FOUND', 'serviço de B não entra na agenda de A');
select throws_ok(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, %L, %L, %L, 'confirm',
  'idem-quote-000001', %L) $$, (select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  pg_temp.at(1, '09:00'), pg_temp.at(1, '09:30'), gen_random_uuid(), pg_temp.h('quote')),
  'PT400', 'VALIDATION_ERROR', 'cotação ainda não aceita (P05)');
reset role;

select ok((select count(*) = 1 from public.outbox_events e
  where e.aggregate_id = pg_temp.bid('b1') and e.event_type = 'booking.confirmed.v1'),
  'confirmação emite um evento no outbox');

-- ------------------------------------------------------------------ isolamento de leitura
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok($$ select pg_temp.corte('idem-b-in-a-00001', 1, '09:00') $$, 'PT403', 'FORBIDDEN',
  'dono B não cria reserva em A');
select is((select count(*)::int from public.bookings b where b.tenant_id = (select tenant_a from ids)), 0,
  'dono B não lê reservas de A');
select throws_ok(format($$ select public.scheduling_booking_get(%L, %L) $$, (select tenant_a from ids), pg_temp.bid('b1')),
  'PT403', 'FORBIDDEN', 'dono B não abre reserva de A');
reset role;
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select is((select count(*)::int from public.bookings), 0, 'cliente sem vínculo não lê reservas');
reset role;
set local role anon;
select throws_ok('select * from public.bookings', '42501', null, 'anon não lê reservas');
reset role;

-- ------------------------------------------------------------------ hold e expiração
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'h1', pg_temp.corte('idem-h1-0000000001', 0, '14:00', 'hold');
select is(pg_temp.got('h1')->'body'->'booking'->>'status', 'held', 'hold criado');
select ok((pg_temp.got('h1')->'body'->'booking'->>'hold_expires_at')::timestamptz > clock_timestamp(),
  'hold tem prazo no futuro');
select ok(pg_temp.got('h1')->'body'->'booking'->'agreed_price_cents' = 'null'::jsonb, 'hold não congela preço');
select throws_ok($$ select pg_temp.corte('idem-h1-dispute-01', 0, '14:00') $$, 'PT409', 'SLOT_CONFLICT',
  'hold ocupa o horário');
reset role;
update public.bookings set hold_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.bid('h1');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select ok(pg_temp.has_slot(pg_temp.avail(0), pg_temp.at(0, '14:00')), 'hold vencido libera o horário na leitura');
insert into r select 'h1b', pg_temp.corte('idem-h1-after-0001', 0, '14:00');
select is(pg_temp.got('h1b')->'body'->'booking'->>'status', 'confirmed', 'outra reserva usa o horário do hold vencido');
select is((select status from public.bookings where id = pg_temp.bid('h1')), 'expired', 'hold vencido marcado expired sob lock');
select throws_ok(format($$ select public.scheduling_booking_confirm(%L, %L, %s, 'idem-h1-confirm-01', %L) $$,
  (select tenant_a from ids), pg_temp.bid('h1'), (select version from public.bookings where id = pg_temp.bid('h1')),
  pg_temp.h('h1c')),
  'PT422', 'POLICY_REJECTED', 'hold vencido não pode ser confirmado');

insert into r select 'h2', pg_temp.corte('idem-h2-0000000001', 0, '15:00', 'hold');
insert into r select 'h2c', public.scheduling_booking_confirm((select tenant_a from ids), pg_temp.bid('h2'), 1,
  'idem-h2-confirm-01', pg_temp.h('h2c'));
select is(pg_temp.got('h2c')->'body'->'booking'->>'status', 'confirmed', 'hold dentro do prazo é confirmado');
select is((pg_temp.got('h2c')->'body'->'booking'->>'agreed_price_cents')::int, 6000, 'confirmação congela o preço');

-- ------------------------------------------------------------------ reagendar
select throws_ok(format($$ select public.scheduling_booking_reschedule(%L, %L, 1, %L, %L, null, 'idem-resch-conf-01', %L) $$,
  (select tenant_a from ids), pg_temp.bid('b1'), pg_temp.at(0, '14:00'), pg_temp.at(0, '14:30'), pg_temp.h('rc')),
  'PT409', 'SLOT_CONFLICT', 'reagendar para horário ocupado → 409');
select is((select starts_at from public.bookings where id = pg_temp.bid('b1')), pg_temp.at(0, '10:00'),
  'reagendamento falho preserva o horário original');
insert into r select 'b1r', public.scheduling_booking_reschedule((select tenant_a from ids), pg_temp.bid('b1'), 1,
  pg_temp.at(0, '16:00'), pg_temp.at(0, '16:30'), null, 'idem-resch-ok-0001', pg_temp.h('rok'));
select is((pg_temp.got('b1r')->'body'->'booking'->>'starts_at')::timestamptz, pg_temp.at(0, '16:00'), 'reagendado');
select is((pg_temp.got('b1r')->'body'->'booking'->>'version')::int, 2, 'reagendar sobe a versão');
select ok(pg_temp.has_slot(pg_temp.avail(0), pg_temp.at(0, '10:00')), 'horário antigo liberado');
select throws_ok(format($$ select public.scheduling_booking_reschedule(%L, %L, 1, %L, %L, null, 'idem-resch-stale1', %L) $$,
  (select tenant_a from ids), pg_temp.bid('b1'), pg_temp.at(0, '17:00'), pg_temp.at(0, '17:30'), pg_temp.h('rs')),
  'PT409', 'STALE_VERSION', 'reagendar com versão antiga → 409');

-- ------------------------------------------------------------------ cancelar
insert into r select 'b1c', public.scheduling_booking_cancel((select tenant_a from ids), pg_temp.bid('b1'), 2,
  'Cliente pediu', 'idem-cancel-b1-001', pg_temp.h('c1'));
select is(pg_temp.got('b1c')->'body'->'booking'->>'status', 'cancelled', 'cancelado');
select is(public.scheduling_booking_cancel((select tenant_a from ids), pg_temp.bid('b1'), 2,
  'Cliente pediu', 'idem-cancel-b1-001', pg_temp.h('c1')), pg_temp.got('b1c'), 'cancelamento repetido → mesma resposta');
select throws_ok(format($$ select public.scheduling_booking_cancel(%L, %L, 3, 'De novo', 'idem-cancel-b1-002', %L) $$,
  (select tenant_a from ids), pg_temp.bid('b1'), pg_temp.h('c2')),
  'PT422', 'POLICY_REJECTED', 'cancelar de novo com outra chave não gera segundo efeito');
reset role;
select is((select count(*)::int from public.outbox_events e
  where e.aggregate_id = pg_temp.bid('b1') and e.event_type = 'booking.cancelled.v1'), 1,
  'um único evento de cancelamento');
select ok(not exists (select 1 from public.audit_events a where a.object_id = pg_temp.bid('b1')
  and (a.after::text like '%Cliente pediu%' or a.before::text like '%Cliente pediu%')), 'motivo não vai para a auditoria');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select ok(pg_temp.has_slot(pg_temp.avail(0), pg_temp.at(0, '16:00')), 'cancelamento libera o horário');

-- ------------------------------------------------------------------ concluir e falta (reservas no passado)
reset role;
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range,
  blocks_capacity, status, agreed_price_cents, source)
values
  ('60000000-0000-4000-8000-0000000000f1', (select tenant_a from ids), (select res_a from ids), (select cust_a from ids),
   (select corte_a from ids), now() - interval '3 hours', now() - interval '150 minutes',
   tstzrange(now() - interval '3 hours', now() - interval '140 minutes', '[)'), true, 'confirmed', 6000, 'owner'),
  ('60000000-0000-4000-8000-0000000000f2', (select tenant_a from ids), (select res_a from ids), (select cust_a from ids),
   (select corte_a from ids), now() - interval '2 hours', now() - interval '90 minutes',
   tstzrange(now() - interval '2 hours', now() - interval '80 minutes', '[)'), true, 'confirmed', 6000, 'owner');
select throws_ok($$ insert into public.bookings (tenant_id, resource_id, service_id, starts_at, ends_at, occupied_range,
  blocks_capacity, status, source) values ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000a',
  '40000000-0000-4000-8000-0000000000a1', now() - interval '170 minutes', now() - interval '140 minutes',
  tstzrange(now() - interval '170 minutes', now() - interval '140 minutes', '[)'), true, 'confirmed', 'owner') $$,
  '23P01', null, 'constraint de exclusão barra sobreposição mesmo fora das RPCs');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_booking_complete(%L, %L, 2, 'idem-complete-fut1', %L) $$,
  (select tenant_a from ids), pg_temp.bid('h2'), pg_temp.h('cf')),
  'PT422', 'POLICY_REJECTED', 'não conclui antes do início');
insert into r select 'done', public.scheduling_booking_complete((select tenant_a from ids),
  '60000000-0000-4000-8000-0000000000f1', 1, 'idem-complete-0001', pg_temp.h('done'));
select is(pg_temp.got('done')->'body'->'booking'->>'status', 'completed', 'concluído depois do início');
insert into r select 'ns', public.scheduling_booking_no_show((select tenant_a from ids),
  '60000000-0000-4000-8000-0000000000f2', 1, 'Não veio', false, 'idem-noshow-00001', pg_temp.h('ns'));
select is(pg_temp.got('ns')->'body'->'booking'->>'status', 'no_show', 'falta marcada');
insert into r select 'nsr', public.scheduling_booking_no_show((select tenant_a from ids),
  '60000000-0000-4000-8000-0000000000f2', 2, 'Chegou atrasado', true, 'idem-noshow-rev01', pg_temp.h('nsr'));
select is(pg_temp.got('nsr')->'body'->'booking'->>'status', 'confirmed', 'falta revertida com motivo');
reset role;
select is((select count(*)::int from public.outbox_events e where e.aggregate_id = '60000000-0000-4000-8000-0000000000f1'
  and e.event_type = 'booking.completed.v1'), 1, 'conclusão emite evento');

-- ------------------------------------------------------------------ bloqueios
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_block_create(%L, %L, %L, %L, 'Dentista', 'idem-block-over-01', %L) $$,
  (select tenant_a from ids), (select res_a from ids), pg_temp.at(0, '14:00'), pg_temp.at(0, '15:00'), pg_temp.h('bo')),
  'PT409', 'SLOT_CONFLICT', 'bloqueio não cobre reserva ativa');
insert into r select 'blk', public.scheduling_block_create((select tenant_a from ids), (select res_a from ids),
  pg_temp.at(1, '09:00'), pg_temp.at(1, '11:00'), 'Dentista', 'idem-block-ok-0001', pg_temp.h('blk'));
select is((pg_temp.got('blk')->>'status_code')::int, 201, 'bloqueio criado');
select throws_ok($$ select pg_temp.corte('idem-on-block-0001', 1, '09:30') $$, 'PT409', 'SLOT_CONFLICT',
  'não reserva sobre bloqueio');
select ok(not pg_temp.has_slot(pg_temp.avail(1), pg_temp.at(1, '09:00')), 'bloqueio some da disponibilidade');
insert into r select 'plans', public.scheduling_day_plans((select tenant_a from ids), pg_temp.at(0, '00:00'), pg_temp.at(2, '00:00'));
select is(jsonb_array_length(pg_temp.got('plans')->'days'), 2, 'um plano por dia local');
select is(jsonb_array_length(pg_temp.got('plans')->'days'->0->'open'), 2, 'segunda: dois períodos abertos');
select is(jsonb_array_length(pg_temp.got('plans')->'days'->0->'pauses'), 1, 'segunda: uma pausa');
select is(pg_temp.got('plans')->'days'->1->'blocks'->0->>'label', 'Dentista', 'terça mostra o bloqueio');
insert into r select 'rm', public.scheduling_block_remove((select tenant_a from ids), (pg_temp.got('blk')->'body'->'block'->>'id')::uuid, 1,
  'idem-block-rm-00001', pg_temp.h('rm'));
select ok(pg_temp.has_slot(pg_temp.avail(1), pg_temp.at(1, '09:00')), 'remover bloqueio devolve o horário');

-- ------------------------------------------------------------------ recorrência semanal finita
insert into r select 'series', public.scheduling_booking_create_series((select tenant_a from ids), (select res_a from ids),
  (select corte_a from ids), (select cust_a from ids), null, pg_temp.at(2, '17:00'), pg_temp.at(2, '17:30'), 4, true,
  'idem-series-ok-001', pg_temp.h('series'));
select is(jsonb_array_length(pg_temp.got('series')->'body'->'created'), 4, 'série de 4 semanas materializada');
select is((pg_temp.got('series')->'body'->'created'->3->>'starts_at')::timestamptz, pg_temp.at(23, '17:00'),
  'quarta ocorrência na mesma hora local');
select throws_ok(format($$ select public.scheduling_booking_create_series(%L, %L, %L, null, null, %L, %L, 3, true,
  'idem-series-all-01', %L) $$, (select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  pg_temp.at(23, '17:00'), pg_temp.at(23, '17:30'), pg_temp.h('all')),
  'PT409', 'SLOT_CONFLICT', 'tudo-ou-nada com uma data ocupada → 409');
select is((select count(*)::int from public.bookings b where b.series_id is not null), 4, 'tudo-ou-nada não cria nada');
insert into r select 'partial', public.scheduling_booking_create_series((select tenant_a from ids), (select res_a from ids),
  (select corte_a from ids), null, null, pg_temp.at(23, '17:00'), pg_temp.at(23, '17:30'),
  3, false, 'idem-series-part-1', pg_temp.h('part'));
select is(jsonb_array_length(pg_temp.got('partial')->'body'->'created'), 2, 'parcial cria as livres');
select is(jsonb_array_length(pg_temp.got('partial')->'body'->'conflicts'), 1, 'e devolve as datas em conflito');

-- ------------------------------------------------------------------ listagem
insert into r select 'list', public.scheduling_booking_list((select tenant_a from ids), pg_temp.at(0, '00:00'),
  pg_temp.at(1, '00:00'), null, null, 2);
select is(jsonb_array_length(pg_temp.got('list')->'items'), 2, 'listagem respeita o limite');
select ok(pg_temp.got('list')->'next' is not null and pg_temp.got('list')->'next' <> 'null'::jsonb, 'devolve cursor da próxima página');
reset role;

-- ------------------------------------------------------------------ link público (P09)
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
values ((select tenant_a from ids), 'barbearia-exemplo-a', 'barber', 'Centro', array['display_name'], now());
set local role anon;
select ok(pg_temp.has_slot(public.scheduling_public_slots('barbearia-exemplo-a', (select corte_a from ids),
  pg_temp.at(0, '00:00'), pg_temp.at(1, '00:00')), pg_temp.at(0, '09:00')), 'visitante vê horários pelo slug');
select ok(public.scheduling_public_slots('barbearia-exemplo-a', (select corte_a from ids),
  pg_temp.at(0, '00:00'), pg_temp.at(1, '00:00'))::text !~ '10000000-0000-4000-8000-00000000000a',
  'resposta pública não carrega o tenant');
select throws_ok(format($$ select public.scheduling_public_slots('nao-existe', %L, now(), now() + interval '1 day') $$,
  (select corte_a from ids)), 'PT404', 'NOT_FOUND', 'slug desconhecido → 404');
select throws_ok(format($$ select public.scheduling_public_slots('barbearia-exemplo-a', %L, now(), now() + interval '1 day') $$,
  (select treino_b from ids)), 'PT404', 'NOT_FOUND', 'serviço de outro negócio não aparece no link');
reset role;

select * from finish();
rollback;

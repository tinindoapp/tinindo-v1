-- Agenda do personal: series_id na leitura, série com vários dias da semana (um series_id), leitura da série,
-- "cancelar este e os próximos" (transação, idempotência, motivo, passados e concluídos intactos) e trava de módulo.
-- Datas relativas a now(): a semana seguinte, em America/Sao_Paulo (fuso dos negócios do seed).
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as cust_a;
grant select on ids to authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert on r to authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
/** Instante local: segunda-feira da próxima semana + p_days, às p_hhmm, em São Paulo. */
create function pg_temp.at(p_days integer, p_hhmm text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + p_days) + p_hhmm::time)
         at time zone 'America/Sao_Paulo'
$$;
/** Série do aluno: começa na terça (dia 1) às p_hhmm, p_weeks semanas, nos dias p_days. */
create function pg_temp.series(p_key text, p_hhmm text, p_weeks integer, p_days integer[]) returns jsonb language sql as $$
  select public.scheduling_booking_create_series((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
    (select cust_a from ids), null, pg_temp.at(1, p_hhmm), pg_temp.at(1, p_hhmm) + interval '30 minutes', p_weeks, false,
    p_key, pg_temp.h(p_key), null, p_days)
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.at(integer, text),
  pg_temp.series(text, text, integer, integer[]) to authenticated;

-- Expediente das 6h às 21h de segunda a sábado.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  (select jsonb_agg(jsonb_build_object('weekday', d, 'local_start', '06:00', 'local_end', '21:00')) from generate_series(1, 6) d),
  'chave-expediente-personal-1', repeat('e', 64));

-- ------------------------------------------------------------------ terça e quinta numa série só
insert into r select 'tq', pg_temp.series('serie-terca-quinta-001', '07:00', 4, array[4, 2]);
select is((pg_temp.got('tq')->>'status_code')::int, 201, 'série criada');
select is(jsonb_array_length(pg_temp.got('tq')->'body'->'created'), 8, 'terça e quinta por 4 semanas: 8 atendimentos');
select is((select count(distinct e->>'series_id') from jsonb_array_elements(pg_temp.got('tq')->'body'->'created') e)::int, 1,
  'todos com o mesmo series_id');
select is((select e->>'series_id' from jsonb_array_elements(pg_temp.got('tq')->'body'->'created') e limit 1),
  pg_temp.got('tq')->'body'->>'series_id', 'o series_id da leitura é o da série');
select is((select array_agg(extract(dow from (e->>'starts_at')::timestamptz at time zone 'America/Sao_Paulo')::int order by e->>'starts_at')
  from jsonb_array_elements(pg_temp.got('tq')->'body'->'created') e), array[2, 4, 2, 4, 2, 4, 2, 4],
  'em ordem de data, alternando terça e quinta');
select ok((select bool_and(to_char((e->>'starts_at')::timestamptz at time zone 'America/Sao_Paulo', 'HH24:MI') = '07:00')
  from jsonb_array_elements(pg_temp.got('tq')->'body'->'created') e), 'sempre às 7h locais');
select is(public.scheduling_booking_get((select tenant_a from ids), ((pg_temp.got('tq')->'body'->'created'->0->>'id'))::uuid)
  ->'booking'->>'series_id', pg_temp.got('tq')->'body'->>'series_id', 'booking.get devolve o series_id');
select is((select count(*)::int from jsonb_array_elements(public.scheduling_booking_list((select tenant_a from ids), pg_temp.at(0, '00:00'),
  pg_temp.at(30, '00:00'))->'items') e where e->>'series_id' = pg_temp.got('tq')->'body'->>'series_id'), 8,
  'booking.list devolve o series_id');
select is(jsonb_array_length(public.scheduling_booking_series((select tenant_a from ids), (pg_temp.got('tq')->'body'->>'series_id')::uuid)->'bookings'),
  8, 'booking.series lê a série inteira');
select is((pg_temp.series('serie-terca-quinta-001', '07:00', 4, array[4, 2]))->'body'->>'series_id', pg_temp.got('tq')->'body'->>'series_id',
  'repetir com a mesma chave devolve a mesma série');
select is(jsonb_array_length((pg_temp.series('serie-sem-dias-000001', '19:00', 3, null))->'body'->'created'), 3,
  'sem dias: só o dia do primeiro horário, como antes');
select throws_ok($$ select pg_temp.series('serie-dia-repetido-01', '08:00', 2, array[2, 2]) $$, 'PT400', 'VALIDATION_ERROR',
  'dia repetido é recusado');
select throws_ok($$ select pg_temp.series('serie-dia-invalido-01', '08:00', 2, array[7]) $$, 'PT400', 'VALIDATION_ERROR',
  'dia fora de 0 a 6 é recusado');

-- Conflito em uma das datas: fica de fora e o resto entra na mesma série.
insert into r select 'blk', public.scheduling_block_create((select tenant_a from ids), (select res_a from ids),
  pg_temp.at(10, '09:00'), pg_temp.at(10, '10:00'), 'Consulta', 'bloqueio-quinta-0001', pg_temp.h('bloqueio-quinta-0001'));
insert into r select 'cf', pg_temp.series('serie-com-conflito-01', '09:00', 2, array[2, 4]);
select is(jsonb_array_length(pg_temp.got('cf')->'body'->'conflicts') || ':' || jsonb_array_length(pg_temp.got('cf')->'body'->'created'), '1:3',
  'conflito numa quinta: 3 criados e 1 de fora');

-- ------------------------------------------------------------------ cancelar este e os próximos
reset role;
-- O primeiro atendimento já aconteceu (concluído): fica como está.
update public.bookings set status = 'completed', blocks_capacity = true
where id = (pg_temp.got('tq')->'body'->'created'->0->>'id')::uuid;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'third', public.scheduling_booking_get((select tenant_a from ids), (pg_temp.got('tq')->'body'->'created'->2->>'id')::uuid);
insert into r select 'cx', public.scheduling_booking_cancel_series_from((select tenant_a from ids),
  (pg_temp.got('third')->'booking'->>'id')::uuid, (pg_temp.got('third')->'booking'->>'version')::int, ' Aluno mudou de horário ',
  'cancela-proximos-00001', pg_temp.h('cancela-proximos-00001'));
select is(jsonb_array_length(pg_temp.got('cx')->'body'->'cancelled'), 6, 'cancela o 3º e os 5 seguintes');
select ok((select bool_and(e->>'status' = 'cancelled' and e->>'status_reason' = 'Aluno mudou de horário')
  from jsonb_array_elements(pg_temp.got('cx')->'body'->'cancelled') e), 'todos com o motivo (sem espaços sobrando)');
select is((select string_agg(e->>'status', ',' order by e->>'starts_at') from jsonb_array_elements(
  public.scheduling_booking_series((select tenant_a from ids), (pg_temp.got('tq')->'body'->>'series_id')::uuid)->'bookings') e),
  'completed,confirmed,cancelled,cancelled,cancelled,cancelled,cancelled,cancelled',
  'o concluído e o anterior ficam como estão');
select is((public.scheduling_booking_cancel_series_from((select tenant_a from ids),
  (pg_temp.got('third')->'booking'->>'id')::uuid, (pg_temp.got('third')->'booking'->>'version')::int, ' Aluno mudou de horário ',
  'cancela-proximos-00001', pg_temp.h('cancela-proximos-00001'))->'body'->'cancelled'), pg_temp.got('cx')->'body'->'cancelled',
  'repetir com a mesma chave devolve o mesmo resultado, sem cancelar de novo');
reset role;
select is((select count(*)::int from public.outbox_events e where e.event_type = 'booking.cancelled.v1'
  and e.payload->>'series_id' = pg_temp.got('tq')->'body'->>'series_id'), 6, 'um evento de cancelamento por atendimento');
select is((select count(*)::int from public.audit_events a where a.action = 'booking.cancel_series_from'), 6, 'auditado um a um');
select ok(not exists (select 1 from public.bookings b where b.series_id = (pg_temp.got('tq')->'body'->>'series_id')::uuid
  and b.status = 'cancelled' and b.blocks_capacity), 'os cancelados liberam o horário');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_booking_cancel_series_from(%L, %L, %s, 'x', 'cancela-proximos-00002', %L) $$,
  (select tenant_a from ids), (pg_temp.got('third')->'booking'->>'id'), (pg_temp.got('third')->'booking'->>'version'),
  pg_temp.h('cancela-proximos-00002')), 'PT409', 'STALE_VERSION', 'versão antiga do atendimento: recusado');
insert into r select 'second', public.scheduling_booking_get((select tenant_a from ids), (pg_temp.got('tq')->'body'->'created'->1->>'id')::uuid);
select throws_ok(format($$ select public.scheduling_booking_cancel_series_from(%L, %L, %s, '  ', 'cancela-proximos-00003', %L) $$,
  (select tenant_a from ids), (pg_temp.got('second')->'booking'->>'id'), (pg_temp.got('second')->'booking'->>'version'),
  pg_temp.h('cancela-proximos-00003')), 'PT400', 'VALIDATION_ERROR', 'sem motivo: recusado');
insert into r select 'avulso', public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids),
  (select cust_a from ids), null, pg_temp.at(5, '15:00'), pg_temp.at(5, '15:30'), null, 'confirm', 'avulso-personal-00001', pg_temp.h('avulso'));
select throws_ok(format($$ select public.scheduling_booking_cancel_series_from(%L, %L, 1, 'x', 'cancela-proximos-00004', %L) $$,
  (select tenant_a from ids), (pg_temp.got('avulso')->'body'->'booking'->>'id'), pg_temp.h('cancela-proximos-00004')),
  'PT422', 'POLICY_REJECTED', 'atendimento fora de série: recusado');
select is(pg_temp.got('avulso')->'body'->'booking'->'series_id', 'null'::jsonb, 'atendimento avulso: series_id null');

-- ------------------------------------------------------------------ isolamento
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.scheduling_booking_series(%L, %L) $$, (select tenant_a from ids), pg_temp.got('tq')->'body'->>'series_id'),
  'PT403', 'FORBIDDEN', 'dono de outro negócio não lê a série');
select throws_ok(format($$ select public.scheduling_booking_cancel_series_from(%L, %L, %s, 'x', 'cancela-proximos-00005', %L) $$,
  (select tenant_a from ids), (pg_temp.got('second')->'booking'->>'id'), (pg_temp.got('second')->'booking'->>'version'),
  pg_temp.h('cancela-proximos-00005')), 'PT403', 'FORBIDDEN', 'dono de outro negócio não cancela');
select ok(not has_function_privilege('anon', 'public.scheduling_booking_cancel_series_from(uuid, uuid, integer, text, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.scheduling_booking_series(uuid, uuid)', 'execute'), 'anon não chama');
select throws_ok(format($$ select public.scheduling_booking_series(%L, %L) $$, (select tenant_b from ids), pg_temp.got('tq')->'body'->>'series_id'),
  'PT404', 'NOT_FOUND', 'série de outro negócio: não encontrada');

-- ------------------------------------------------------------------ trava de módulo
reset role;
select lives_ok($$ select app.module_guard((select tenant_a from ids), 'scheduling') $$, 'Agenda (piloto): sempre ligada');
-- O seed liga tudo para A (recado #142); aqui a chave volta a desligada para provar a recusa.
select app.module_admin_set((select tenant_a from ids), 'payments', false);
select throws_ok($$ select app.module_guard((select tenant_a from ids), 'payments') $$, 'PT403', 'FORBIDDEN',
  'módulo guardado sem a chave: recusado');
select app.module_admin_set((select tenant_a from ids), 'payments', true);
select lives_ok($$ select app.module_guard((select tenant_a from ids), 'payments') $$, 'com a chave ligada: passa');
select throws_ok($$ select app.module_guard((select tenant_a from ids), 'nao-existe') $$, 'PT400', 'VALIDATION_ERROR',
  'módulo desconhecido: erro de quem chama');
select ok(not has_function_privilege('authenticated', 'app.module_guard(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'app.authorize(uuid, text[], text)', 'execute'), 'trava só por dentro das RPCs');

select * from finish();
rollback;

-- P29 · Serviço a domicílio: zonas por bairro/CEP e distância (área), sem endereço nem coordenada; o deslocamento vira
-- bloqueio da agenda (some dos horários livres e impede reserva por cima); deslocamento que não cabe recusa tudo;
-- janela de chegada; roteiro do dia em ordem; cancelar na agenda solta o deslocamento; isolamento e RLS.
-- Corridas em tests/db-concurrency/28_field_service.sh.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000a2'::uuid as barba_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '30000000-0000-4000-8000-0000000000a2'::uuid as carlos,
  (now() at time zone 'America/Sao_Paulo')::date + 3 as day;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.id(p_k text, p_path text[]) returns uuid language sql as $$ select (v #>> p_path)::uuid from r where k = p_k $$;
create function pg_temp.at(p_hhmm text) returns timestamptz language sql as $$ select ((select day from ids) + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.utc(p_hhmm text) returns text language sql as $$ select to_char(pg_temp.at(p_hhmm) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return v_state || '/' || v_msg || '/' || coalesce(nullif(v_hint, ''), '-');
end $$;
create function pg_temp.book(p_k text, p_service uuid, p_hhmm text, p_min integer, p_customer uuid) returns jsonb language sql as $$
  insert into r select p_k, public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), p_service, p_customer, null,
    pg_temp.at(p_hhmm), pg_temp.at(p_hhmm) + make_interval(mins => p_min), null, 'confirm', 'idem-fs-book-' || p_k || '-0000', pg_temp.h(p_k)) returning v
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.id(text, text[]), pg_temp.at(text), pg_temp.utc(text), pg_temp.err(text),
  pg_temp.book(text, uuid, text, integer, uuid) to anon, authenticated;

insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select tenant_a, res_a, d, '08:00', '20:00' from ids, generate_series(0, 6) d;

-- ------------------------------------------------------------------ estrutura e privacidade da localização
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'field\_%'), 'RLS ligada no atendimento a domicílio');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name like 'field\_%'
  and column_name ~ '(lat|lng|lon|geo|address|endereco|street|rua|numero|complement|location|coord)'), 0, 'nenhuma coluna de endereço, coordenada ou rastreamento');
select ok(not has_table_privilege('authenticated', 'public.field_visits', 'insert'), 'escrita só por RPC');
select ok(not has_function_privilege('anon', 'public.field_route(uuid, date)', 'execute'), 'anon não vê roteiro');
select ok(not has_function_privilege('authenticated', 'app.fs_rebuild_day(uuid, date)', 'execute'), 'montagem do roteiro só por dentro');

-- ------------------------------------------------------------------ regras, zonas, tempos e área
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'st', public.field_settings_save((select tenant_a from ids), null, true, 30, 10, 30, 15, 'idem-fs-set-00000001', pg_temp.h('st'));
select is((pg_temp.got('st')->'body'->'settings'->>'max_km')::numeric, 15::numeric, 'área de até 15 km');
insert into r select 'zc', public.field_zone_save((select tenant_a from ids), null, null, 'Centro', array['01000', '01001'], 2, 20, true, 'idem-fs-zone-0000001', pg_temp.h('zc'));
insert into r select 'zp', public.field_zone_save((select tenant_a from ids), null, null, 'Pinheiros', array['05400'], 8, 35, true, 'idem-fs-zone-0000002', pg_temp.h('zp'));
insert into r select 'zf', public.field_zone_save((select tenant_a from ids), null, null, 'Alphaville', array['06454'], 25, 60, true, 'idem-fs-zone-0000003', pg_temp.h('zf'));
select is(pg_temp.got('zc')->'body'->'zone'->>'in_area', 'true', 'Centro dentro da área');
select is(pg_temp.got('zf')->'body'->'zone'->>'in_area', 'false', 'Alphaville a 25 km: fora da área');
select is(pg_temp.err(format($$ select public.field_zone_save(%L, null, null, 'Sé', array['01001'], 1, 15, true, 'idem-fs-zone-0000004', %L) $$,
  (select tenant_a from ids), pg_temp.h('z4'))), 'PT422/POLICY_REJECTED/cep_prefixes', 'um CEP numa zona só');
select is(pg_temp.err(format($$ select public.field_zone_save(%L, null, null, 'Lapa', array['0500'], 6, 25, true, 'idem-fs-zone-0000005', %L) $$,
  (select tenant_a from ids), pg_temp.h('z5'))), 'PT400/VALIDATION_ERROR/zone', 'prefixo de CEP com 5 dígitos');
select is(public.field_zone_save((select tenant_a from ids), null, null, 'Centro', array['01000', '01001'], 2, 20, true, 'idem-fs-zone-0000001', pg_temp.h('zc')),
  pg_temp.got('zc'), 'repetir devolve a mesma zona');
insert into r select 'tt', public.field_travel_save((select tenant_a from ids), pg_temp.id('zp', '{body,zone,id}'), pg_temp.id('zc', '{body,zone,id}'), 25,
  'idem-fs-travel-000001', pg_temp.h('tt'));
select is(jsonb_array_length(pg_temp.got('tt')->'body'->'travel_times'), 1, 'tempo entre Centro e Pinheiros, nos dois sentidos');
insert into r select 'cep', public.field_zone_for((select tenant_a from ids), '01001-000');
select is(pg_temp.got('cep')->'zone'->>'name', 'Centro', 'CEP 01001-000 cai no Centro');
select is(pg_temp.got('cep')->>'cep5', '01001', 'só os 5 primeiros dígitos');
insert into r select 'cep2', public.field_zone_for((select tenant_a from ids), '99999-999');
select is(pg_temp.got('cep2')->>'in_area', 'false', 'CEP sem zona: fora da área');

-- ------------------------------------------------------------------ visitas: deslocamento ocupa a agenda
select pg_temp.book('b10', (select corte_a from ids), '10:00', 30, (select ana from ids));
select pg_temp.book('b1050', (select corte_a from ids), '10:50', 30, (select carlos from ids));
select pg_temp.book('b13', (select barba_a from ids), '13:00', 20, (select ana from ids));
insert into r select 'v10', public.field_visit_attach((select tenant_a from ids), pg_temp.id('b10', '{body,booking,id}'), pg_temp.id('zc', '{body,zone,id}'), '01001',
  'idem-fs-visit-000001', pg_temp.h('v10'));
select is((pg_temp.got('v10')->'body'->'stop'->>'travel_min')::int, 20, 'primeira visita: 20 min da base até o Centro');
select is(pg_temp.got('v10')->'body'->'stop'->>'depart_at', pg_temp.utc('09:40'), 'sai às 9h40');
select is(pg_temp.got('v10')->'body'->'stop'->>'arrival_from', pg_temp.utc('09:30'), 'janela de chegada: 9h30');
select is(pg_temp.got('v10')->'body'->'stop'->>'arrival_to', pg_temp.utc('10:00'), 'até 10h');
select is(pg_temp.err(format($$ select public.scheduling_booking_create(%L, %L, %L, null, null, %L, %L, null, 'confirm', 'idem-fs-solo-000001', %L) $$,
  (select tenant_a from ids), (select res_a from ids), (select barba_a from ids), pg_temp.at('09:20'), pg_temp.at('09:40'), pg_temp.h('s1'))),
  'PT409/SLOT_CONFLICT/-', 'a agenda não aceita reserva no horário do deslocamento');
insert into r select 'av', public.scheduling_availability((select tenant_a from ids), (select res_a from ids), (select barba_a from ids), pg_temp.at('08:00'), pg_temp.at('10:00'));
select ok(not (pg_temp.got('av')->'slots') @> jsonb_build_array(jsonb_build_object('starts_at', pg_temp.utc('09:30'))), 'horário livre some no deslocamento');
select ok((pg_temp.got('av')->'slots') @> jsonb_build_array(jsonb_build_object('starts_at', pg_temp.utc('09:15'))), 'antes dele continua livre');
-- Pinheiros às 10h50 depois do Centro às 10h: 25 min de deslocamento não cabem (o corte ocupa até 10h40). Nada muda.
select is(pg_temp.err(format($$ select public.field_visit_attach(%L, %L, %L, null, 'idem-fs-visit-000002', %L) $$, (select tenant_a from ids),
  pg_temp.id('b1050', '{body,booking,id}'), pg_temp.id('zp', '{body,zone,id}'), pg_temp.h('v1050'))), 'PT409/SLOT_CONFLICT/travel', 'não dá tempo de chegar: recusado');
reset role;
select is((select count(*)::int from public.field_visits), 1, 'a visita recusada não foi gravada');
select is((select count(*)::int from public.availability_blocks where label like 'Deslocamento%' and removed_at is null), 1, 'o deslocamento anterior continua');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.field_visit_attach(%L, %L, %L, null, 'idem-fs-visit-000003', %L) $$, (select tenant_a from ids),
  pg_temp.id('b13', '{body,booking,id}'), pg_temp.id('zf', '{body,zone,id}'), pg_temp.h('v3'))), 'PT422/POLICY_REJECTED/area', 'fora da área não vira visita');
select is(pg_temp.err(format($$ select public.field_visit_attach(%L, %L, %L, '05400', 'idem-fs-visit-000004', %L) $$, (select tenant_a from ids),
  pg_temp.id('b13', '{body,booking,id}'), pg_temp.id('zc', '{body,zone,id}'), pg_temp.h('v4'))), 'PT400/VALIDATION_ERROR/cep', 'CEP de outra zona');
insert into r select 'v13', public.field_visit_attach((select tenant_a from ids), pg_temp.id('b13', '{body,booking,id}'), pg_temp.id('zp', '{body,zone,id}'), null,
  'idem-fs-visit-000005', pg_temp.h('v13'));
select is((pg_temp.got('v13')->'body'->'stop'->>'travel_min')::int, 25, 'do Centro a Pinheiros: tempo cadastrado (25)');

-- ------------------------------------------------------------------ roteiro do dia
insert into r select 'rt', public.field_route((select tenant_a from ids), (select day from ids));
select is((select jsonb_agg(x->>'zone_name') from jsonb_array_elements(pg_temp.got('rt')->'stops') x), '["Centro", "Pinheiros"]'::jsonb, 'roteiro em ordem');
select is((pg_temp.got('rt')->>'needs_rebuild')::boolean, false, 'roteiro em dia');
select is(jsonb_array_length(pg_temp.got('rt')->'bookings'), 3, 'atendimentos do dia para marcar');

-- ------------------------------------------------------------------ cancelar na agenda solta o deslocamento; recalcular
insert into r select 'cx', public.scheduling_booking_cancel((select tenant_a from ids), pg_temp.id('b10', '{body,booking,id}'), 1, 'remarcou', 'idem-fs-cancel-00001', pg_temp.h('cx'));
reset role;
select is((select count(*)::int from public.availability_blocks k join public.field_visits v on v.travel_block_id = k.id
  where v.booking_id = pg_temp.id('b10', '{body,booking,id}') and k.removed_at is null), 0, 'deslocamento da visita cancelada solto');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is((public.field_route((select tenant_a from ids), (select day from ids))->>'needs_rebuild')::boolean, true,
  'cancelar uma visita pede recálculo das outras do dia');
insert into r select 'rb', public.field_route_rebuild((select tenant_a from ids), (select day from ids), 'idem-fs-rebuild-0001', pg_temp.h('rb'));
select is((pg_temp.got('rb')->'body'->>'stops')::int, 1, 'recalculado: uma visita ativa');
insert into r select 'v1050b', public.field_visit_attach((select tenant_a from ids), pg_temp.id('b1050', '{body,booking,id}'), pg_temp.id('zp', '{body,zone,id}'), '05400',
  'idem-fs-visit-000006', pg_temp.h('v1050b'));
select is((pg_temp.got('v1050b')->'body'->'stop'->>'travel_min')::int, 35, 'sem o Centro antes, sai da base para Pinheiros (35)');
insert into r select 'rt2', public.field_route((select tenant_a from ids), (select day from ids));
select is((select jsonb_agg((x->>'travel_min')::int) from jsonb_array_elements(pg_temp.got('rt2')->'stops') x), '[35, 10]'::jsonb,
  'Pinheiros às 10h50 e de novo Pinheiros às 13h: mesma zona, 10 min');
insert into r select 'dt', public.field_visit_detach((select tenant_a from ids), pg_temp.id('b13', '{body,booking,id}'), 'idem-fs-detach-00001', pg_temp.h('dt'));
reset role;
select is((select count(*)::int from public.availability_blocks where label like 'Deslocamento%' and removed_at is null), 1, 'tirar a visita solta o deslocamento dela');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.field_route(%L, now()::date) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não vê o roteiro de A');
select is(pg_temp.err(format($$ select public.field_visit_attach(%L, %L, %L, null, 'idem-fs-b-0000000001', %L) $$, (select tenant_b from ids),
  pg_temp.id('b13', '{body,booking,id}'), pg_temp.id('zc', '{body,zone,id}'), pg_temp.h('b'))), 'PT404/NOT_FOUND/booking_id', 'B não usa reserva de A');
select is((select count(*)::int from public.field_zones) + (select count(*)::int from public.field_visits), 0, 'RLS: B não vê zonas nem visitas de A');
select pg_temp.login_as((select customer_ab from ids));
select is((select count(*)::int from public.field_visits), 0, 'cliente com login não lê');

select * from finish();
rollback;

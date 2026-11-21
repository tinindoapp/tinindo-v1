-- P32 bloco 5 · previsão simples: só com 8 semanas fechadas; ocupação esperada por dia; risco de falta por horário com
-- base (ou média geral); acerto contra o que aconteceu e contra "igual à semana anterior"; só o dono lê; nada é gravado.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as svc_a;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.bk(p_day date, p_hhmm text, p_status text) returns void language sql as $$
  insert into public.bookings (tenant_id, resource_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source, agreed_price_cents)
  select i.tenant_a, i.res_a, i.svc_a, s, s + interval '60 minutes', tstzrange(s, s + interval '60 minutes', '[)'),
    p_status in ('completed', 'confirmed', 'held'), p_status, 'owner', 6000
  from ids i, (select ((p_day::text || ' ' || p_hhmm)::timestamp at time zone 'America/Sao_Paulo') as s) x
$$;

-- Expediente: segunda a sexta, 09:00 às 12:00 (180 min por dia).
delete from public.availability_rules where tenant_id = (select tenant_a from ids);
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
  select (select tenant_a from ids), (select res_a from ids), wd, '09:00', '12:00' from generate_series(1, 5) wd;
delete from public.bookings where tenant_id = (select tenant_a from ids);

-- 12 semanas fechadas antes da semana de 09/11/2026 (j = 1 é a de 02/11). Segunda: 2 por semana. Terça: 1 nas semanas
-- ímpares e 3 nas pares. Quinta 11h: 1 por semana, falta nas 4 últimas.
do $$
declare j int; m date;
begin
  for j in 1..12 loop
    m := date '2026-11-09' - 7 * j;
    perform pg_temp.bk(m, '09:00', 'completed');
    perform pg_temp.bk(m, '10:00', 'completed');
    perform pg_temp.bk(m + 1, '09:00', 'completed');
    if j % 2 = 0 then
      perform pg_temp.bk(m + 1, '10:00', 'completed');
      perform pg_temp.bk(m + 1, '11:00', 'completed');
    end if;
    perform pg_temp.bk(m + 3, '11:00', case when j <= 4 then 'no_show' else 'completed' end);
  end loop;
end $$;
-- Já marcado na semana prevista (16/11).
select pg_temp.bk('2026-11-16', '09:00', 'confirmed');

create temp table before_n as select count(*) as n from public.bookings;

select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.forecast_week(%L, '2026-11-12') $$, (select tenant_a from ids)), 'PT403', null,
  'dono de outro negócio não lê a previsão');
reset role;
select ok(not has_function_privilege('anon', 'public.forecast_week(uuid, date)', 'execute'), 'anônimo não lê');

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.forecast_week(%L, current_date + 30) $$, (select tenant_a from ids)), 'PT400', null, 'semana futura é recusada');
create temp table f on commit drop as select public.forecast_week((select tenant_a from ids), '2026-11-12') as j;
create temp table early on commit drop as select public.forecast_week((select tenant_a from ids), '2026-09-10') as j;
reset role;

-- ------------------------------------------------------------------ pouco histórico: não prevê
select is((select j ->> 'status' from early), 'insufficient', 'com 3 semanas fechadas não há previsão');
select is((select (j ->> 'weeks_of_history')::int from early), 3, 'e diz quantas semanas há (precisa de 8)');

-- ------------------------------------------------------------------ previsão da semana de 16/11
select is((select j ->> 'status' from f), 'ok', 'com 12 semanas há previsão');
select is((select j #>> '{target,starts_at}' from f), '2026-11-16T03:00:00Z', 'prevê a semana seguinte, no fuso do negócio');
select is((select d from f, jsonb_array_elements(j -> 'days') d where (d ->> 'weekday')::int = 1) - 'date',
  '{"weekday": 1, "expected_bookings": 2.0, "already_booked": 1, "open_minutes": 180, "expected_occupancy": 0.67}'::jsonb,
  'segunda: 2 esperados (média de 8 semanas), 1 já marcado, 67% do expediente');
select is((select (d ->> 'expected_bookings')::numeric from f, jsonb_array_elements(j -> 'days') d where (d ->> 'weekday')::int = 2), 2.0,
  'terça: média de 1 e 3 alternados');
select is((select (d ->> 'expected_occupancy') from f, jsonb_array_elements(j -> 'days') d where (d ->> 'weekday')::int = 0), null,
  'domingo sem expediente: ocupação sem número');

-- ------------------------------------------------------------------ risco de falta
select is((select s - 'weekday' - 'hour' from f, jsonb_array_elements(j -> 'no_show_slots') s where (s ->> 'weekday')::int = 4 and (s ->> 'hour')::int = 11),
  '{"denominator": 8, "no_shows": 4, "basis": "slot", "risk": 0.50}'::jsonb, 'quinta 11h: 4 faltas em 8, pela base do horário');
select is((select s ->> 'basis' from f, jsonb_array_elements(j -> 'no_show_slots') s where (s ->> 'weekday')::int = 5 and (s ->> 'hour')::int = 9),
  'overall', 'horário sem base usa a média geral, dito como tal');
select is((select j -> 'overall_no_show' from f), '{"denominator": 40, "no_shows": 4, "risk": 0.10}'::jsonb, 'média geral: 4 em 40');

-- ------------------------------------------------------------------ acerto (teste temporal)
select is((select jsonb_array_length(j -> 'backtest') from f), 4, 'quatro semanas comparadas com o que aconteceu');
select is((select j -> 'accuracy' from f) - 'model_error' - 'baseline_error',
  '{"weeks": 4, "actual": 20, "model_accuracy": 0.80, "baseline_accuracy": 0.60, "beats_baseline": true}'::jsonb,
  'acerto 80% contra 60% da referência "igual à semana anterior"');

select is((select count(*) from public.bookings), (select n from before_n), 'a previsão não grava nem muda nada');

select * from finish();
rollback;

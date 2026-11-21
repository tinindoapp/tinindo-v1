-- P32 bloco 4 · relatório ao profissional: período no fuso, denominador, insuficiente ≠ zero, voltou / não voltou,
-- horário mais cheio e mais vazio, recebido sem estorno; só o dono do negócio lê.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as svc_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '30000000-0000-4000-8000-0000000000a2'::uuid as bruno;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
-- Atendimento às HH:MM de São Paulo numa data, com estado e cliente.
create function pg_temp.bk(p_day date, p_hhmm text, p_status text, p_customer uuid) returns void language sql as $$
  insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source, agreed_price_cents)
  select i.tenant_a, i.res_a, p_customer, i.svc_a, s, s + interval '30 minutes', tstzrange(s, s + interval '40 minutes', '[)'),
    p_status in ('completed', 'confirmed', 'held'), p_status, 'owner', 6000
  from ids i, (select ((p_day::text || ' ' || p_hhmm)::timestamp at time zone 'America/Sao_Paulo') as s) x
$$;

-- Expediente de A: segunda a sexta, 09:00 às 12:00.
delete from public.availability_rules where tenant_id = (select tenant_a from ids);
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
  select (select tenant_a from ids), (select res_a from ids), wd, '09:00', '12:00' from generate_series(1, 5) wd;
delete from public.bookings where tenant_id = (select tenant_a from ids);

-- Semana anterior (02 a 08/11/2026): Ana e Bruno atendidos.
select pg_temp.bk('2026-11-03', '09:00', 'completed', (select ana from ids));
select pg_temp.bk('2026-11-04', '10:00', 'completed', (select bruno from ids));
-- Semana do relatório (09 a 15/11/2026): Ana volta duas vezes; uma falta; mais atendimentos sem cliente às 09:00 de terça.
select pg_temp.bk('2026-11-10', '09:00', 'completed', (select ana from ids));
select pg_temp.bk('2026-11-11', '09:00', 'completed', (select ana from ids));
select pg_temp.bk('2026-11-10', '09:45', 'completed', null);
select pg_temp.bk('2026-11-17', '09:00', 'completed', null);
select pg_temp.bk('2026-11-12', '11:00', 'no_show', null);
select pg_temp.bk('2026-11-13', '09:00', 'completed', null);

-- Recebimentos: 60,00 e 40,00 na semana; o de 40,00 foi estornado.
insert into public.receivables (id, tenant_id, description, amount_cents, paid_cents, status)
  values ('c3200000-0000-4000-8000-0000000000d1', (select tenant_a from ids), 'Corte', 6000, 6000, 'paid'),
         ('c3200000-0000-4000-8000-0000000000d2', (select tenant_a from ids), 'Barba', 4000, 0, 'open');
insert into public.payment_entries (id, tenant_id, receivable_id, amount_cents, method, received_at) values
  ('c3200000-0000-4000-8000-0000000000e1', (select tenant_a from ids), 'c3200000-0000-4000-8000-0000000000d1', 6000, 'pix', '2026-11-10 13:00:00+00'),
  ('c3200000-0000-4000-8000-0000000000e2', (select tenant_a from ids), 'c3200000-0000-4000-8000-0000000000d2', 4000, 'pix', '2026-11-11 13:00:00+00');
insert into public.payment_entries (tenant_id, receivable_id, amount_cents, method, received_at, reversal_of) values
  ((select tenant_a from ids), 'c3200000-0000-4000-8000-0000000000d2', 4000, 'pix', '2026-11-11 14:00:00+00', 'c3200000-0000-4000-8000-0000000000e2');

-- ------------------------------------------------------------------ acesso
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.report_period(%L, 'week', '2026-11-12') $$, (select tenant_a from ids)), 'PT403', null,
  'dono de outro negócio não lê o relatório');
reset role;
select ok(not has_function_privilege('anon', 'public.report_period(uuid, text, date)', 'execute'), 'anônimo não lê');

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.report_period(%L, 'ano', '2026-11-12') $$, (select tenant_a from ids)), 'PT400', null, 'tipo de período fechado');
select throws_ok(format($$ select public.report_period(%L, 'week', current_date + 30) $$, (select tenant_a from ids)), 'PT400', null, 'período futuro é recusado');
create temp table r on commit drop as select public.report_period((select tenant_a from ids), 'week', '2026-11-12') as j;
create temp table m on commit drop as select public.report_period((select tenant_a from ids), 'month', '2026-11-12') as j;
create temp table e on commit drop as select public.report_period((select tenant_a from ids), 'week', '2026-10-12') as j;
reset role;

-- ------------------------------------------------------------------ semana de 09 a 15/11
select is((select j #>> '{period,starts_at}' from r), '2026-11-09T03:00:00Z', 'semana começa na segunda, 00:00 de São Paulo');
select is((select j #>> '{period,ends_at}' from r), '2026-11-16T03:00:00Z', 'e termina na segunda seguinte');
select is((select j -> 'services_done' from r) - 'note', '{"value": 4, "denominator": 5, "status": "ok"}'::jsonb,
  'feitos 4 de 5 atendimentos que começaram (o do dia 17 é de outra semana)');
select is((select j #>> '{no_shows,value}' from r), '1', 'uma falta');
select is((select j #>> '{received_cents,value}' from r), '6000', 'recebido sem o estornado');
select is((select j #>> '{to_receive_cents,value}' from r), '4000', 'a receber: o que está em aberto agora');
select is((select j -> 'returned' from r) - 'note', '{"value": 1, "denominator": 1, "status": "ok"}'::jsonb, 'Ana voltou (1 de 1 cliente atendida)');
select is((select j -> 'not_returned' from r) - 'note', '{"value": 1, "denominator": 2, "status": "ok"}'::jsonb, 'Bruno não voltou (1 de 2 da semana anterior)');
select is((select j -> 'busiest' from r), '{"weekday": 2, "hour": 9, "count": 2}'::jsonb, 'mais cheio: terça às 9h');
select is((select (j -> 'quietest') ->> 'count' from r), '0', 'mais vazio: uma hora do expediente sem ninguém');
select is((select j #>> '{period,starts_at}' from m), '2026-11-01T03:00:00Z', 'mês do calendário, no fuso do negócio');

-- ------------------------------------------------------------------ sem base: insuficiente, nunca zero
select is((select j -> 'services_done' from e) - 'note', '{"value": null, "denominator": 0, "status": "insufficient"}'::jsonb,
  'semana sem atendimento: insuficiente, não 0');
select is((select j ->> 'hours_status' from e), 'insufficient', 'horário mais cheio só com pelo menos 5 atendimentos');

select * from finish();
rollback;

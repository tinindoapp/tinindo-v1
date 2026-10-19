-- P18 · Resultado e custo: ocupação com denominador explícito (expediente − bloqueios), faltas só com desfecho,
-- cobertura dos dados, indicador ausente ≠ zero, baseline congelada (só período encerrado), comparação sem causa,
-- minutos medidos e custo por cliente só para a operação, isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as op,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
/** Semana passada (segunda = 0), hora local de São Paulo. */
create function pg_temp.lw(p_day integer, p_hhmm text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date - 7 + p_day) + p_hhmm::time) at time zone 'America/Sao_Paulo'
$$;
create function pg_temp.m(p_k text, p_metric text) returns jsonb language sql as $$
  select x from r, jsonb_array_elements(r.v->'metrics') x where r.k = p_k and x->>'key' = p_metric
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.lw(integer, text), pg_temp.m(text, text) to authenticated;

-- ------------------------------------------------------------------ cenário da semana passada (histórico inserido direto)
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select (select tenant_a from ids), (select res_a from ids), d, '09:00', '19:00' from generate_series(1, 5) d;
insert into public.availability_blocks (tenant_id, resource_id, period, label)
values ((select tenant_a from ids), (select res_a from ids), tstzrange(pg_temp.lw(0, '14:00'), pg_temp.lw(0, '15:00'), '[)'), 'Médico');
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range,
  blocks_capacity, status, agreed_price_cents, source)
select v.id, (select tenant_a from ids), (select res_a from ids), (select ana from ids), (select corte_a from ids),
  pg_temp.lw(v.d, '10:00'), pg_temp.lw(v.d, '10:30'), tstzrange(pg_temp.lw(v.d, '10:00'), pg_temp.lw(v.d, '10:40'), '[)'),
  v.s in ('confirmed', 'completed'), v.s, 6000, 'owner'
from (values ('63000000-0000-4000-8000-000000000001'::uuid, 0, 'completed'), ('63000000-0000-4000-8000-000000000002'::uuid, 1, 'completed'),
  ('63000000-0000-4000-8000-000000000003'::uuid, 2, 'no_show'), ('63000000-0000-4000-8000-000000000004'::uuid, 3, 'cancelled'),
  ('63000000-0000-4000-8000-000000000005'::uuid, 4, 'confirmed')) v(id, d, s);
-- Minutos medidos da equipe (P15): 45 humanos + 15 de automação em retrabalho.
insert into public.platform_operators (user_id, display_name) values ((select op from ids), 'Operadora (exemplo)');
insert into public.service_orders (id, tenant_id, offering_version_id, scope_hash, price_cents, minutes_quota, status, assignee_user_id)
select '64000000-0000-4000-8000-000000000001', (select tenant_a from ids), v.id, v.scope_hash, v.price_cents, 120, 'in_progress', (select op from ids)
from public.offering_versions v join public.platform_offerings o on o.id = v.offering_id where o.code = 'implantacao_exemplo';
insert into public.work_logs (tenant_id, order_id, operator_user_id, minutes, kind, reprocess, logged_at) values
  ((select tenant_a from ids), '64000000-0000-4000-8000-000000000001', (select op from ids), 45, 'human', false, pg_temp.lw(1, '15:00')),
  ((select tenant_a from ids), '64000000-0000-4000-8000-000000000001', (select op from ids), 15, 'automation', true, pg_temp.lw(1, '16:00'));

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
-- Uma cobrança e um recebimento (P07), uma despesa.
insert into r select 'chg', public.finance_charge_booking((select tenant_a from ids), '63000000-0000-4000-8000-000000000001', null,
  'idem-an-charge-00001', pg_temp.h('chg'));
insert into r select 'pay', public.finance_record_payment((select tenant_a from ids), (pg_temp.got('chg')->'body'->'receivable'->>'id')::uuid,
  6000, 'pix', pg_temp.lw(0, '10:30'), 'idem-an-pay-0000001', pg_temp.h('pay'));
insert into r select 'exp', public.finance_record_expense((select tenant_a from ids), 2000, pg_temp.lw(2, '12:00'), 'supplies', null,
  'idem-an-exp-0000001', pg_temp.h('exp'));

-- ------------------------------------------------------------------ estrutura
reset role;
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.analytics_baselines'::regclass), 'RLS ligada nas baselines');
select ok(not has_table_privilege('authenticated', 'public.analytics_baselines', 'insert'), 'baseline só por RPC');
select ok(not has_function_privilege('anon', 'public.analytics_metrics(uuid, timestamptz, timestamptz, uuid)', 'execute'), 'anon não lê indicadores');
set local role authenticated;

-- ------------------------------------------------------------------ indicadores da semana passada
insert into r select 'wk', public.analytics_metrics((select tenant_a from ids), pg_temp.lw(0, '00:00'), pg_temp.lw(5, '00:00'), null);
select is((pg_temp.m('wk', 'occupancy')->>'denominator')::numeric, 2940::numeric, 'denominador da ocupação: 5 × 10 h − 1 h de bloqueio');
select is((pg_temp.m('wk', 'occupancy')->>'numerator')::numeric, 120::numeric, 'numerador: 4 atendimentos de 30 min (sem cancelado nem intervalos)');
select is((pg_temp.m('wk', 'occupancy')->>'value')::numeric, 0.0408, 'ocupação = 120 / 2940');
select is((pg_temp.m('wk', 'no_show')->>'value')::numeric, 0.3333, 'faltas = 1 / (2 concluídos + 1 falta)');
select is((pg_temp.m('wk', 'no_show')->>'denominator')::int, 3, 'cancelado e sem desfecho ficam fora do denominador de faltas');
select is((pg_temp.m('wk', 'cancellation')->>'value')::numeric, 0.25, 'cancelamentos = 1 / 4');
select is((pg_temp.m('wk', 'received')->>'value')::bigint, 6000::bigint, 'recebimentos registrados');
select is((pg_temp.m('wk', 'expenses')->>'value')::bigint, 2000::bigint, 'despesas registradas');
select is((pg_temp.m('wk', 'charge_coverage')->>'value')::numeric, 0.5, 'metade dos concluídos com cobrança registrada');
select is((pg_temp.m('wk', 'human_minutes')->>'value')::int, 45, 'minutos humanos medidos');
select ok(pg_temp.m('wk', 'human_minutes')->>'note' ~ 'Automação: 15 min; retrabalho: 15 min', 'automação e retrabalho à parte');
select is(pg_temp.m('wk', 'waitlist_acceptance')->>'status', 'insufficient', 'sem ofertas: denominador zero = dado insuficiente');
select is(pg_temp.m('wk', 'waitlist_acceptance')->'value', 'null'::jsonb, 'insuficiente não vira 0%');
select is(pg_temp.m('wk', 'reminders')->>'status', 'unavailable', 'lembretes (P13) indisponíveis');
select is(pg_temp.m('wk', 'reminders')->'value', 'null'::jsonb, 'indisponível não é zero');
select ok(pg_temp.got('wk')->'coverage' @> '[{"key":"pending_outcome","count":1}]', 'cobertura: atendimento passado sem desfecho');
select ok(pg_temp.got('wk')->'coverage' @> '[{"key":"uncharged","count":1}]', 'cobertura: concluído sem cobrança');
select ok(not (pg_temp.got('wk')->'coverage' @> '[{"key":"future"}]'), 'período encerrado: sem aviso de futuro');
select is(pg_temp.got('wk')->>'causality', 'not_established', 'causalidade nunca é atribuída');

-- ------------------------------------------------------------------ baseline congelada
select throws_ok(format($$ select public.analytics_baseline_create(%L, 'Futuro', %L, now() + interval '1 day', 'idem-an-base-fut01', %L) $$,
  (select tenant_a from ids), pg_temp.lw(0, '00:00'), pg_temp.h('fut')), 'PT400', 'VALIDATION_ERROR', 'baseline só com período encerrado');
insert into r select 'base', public.analytics_baseline_create((select tenant_a from ids), 'Antes da Tinindo', pg_temp.lw(0, '00:00'),
  pg_temp.lw(5, '00:00'), 'idem-an-base-00001', pg_temp.h('base'));
select is((pg_temp.got('base')->>'status_code')::int, 201, 'baseline criada');
select is(public.analytics_baseline_create((select tenant_a from ids), 'Antes da Tinindo', pg_temp.lw(0, '00:00'), pg_temp.lw(5, '00:00'),
  'idem-an-base-00001', pg_temp.h('base')), pg_temp.got('base'), 'repetição devolve a mesma baseline');
-- Registro posterior no mesmo período não muda a baseline.
insert into r select 'pay2', public.finance_record_payment((select tenant_a from ids),
  (public.finance_charge_booking((select tenant_a from ids), '63000000-0000-4000-8000-000000000002', null, 'idem-an-charge-00002',
    pg_temp.h('chg2'))->'body'->'receivable'->>'id')::uuid, 6000, 'cash', pg_temp.lw(1, '10:30'), 'idem-an-pay-0000002', pg_temp.h('pay2'));
insert into r select 'cmp', public.analytics_metrics((select tenant_a from ids), pg_temp.lw(0, '00:00'), pg_temp.lw(5, '00:00'),
  (pg_temp.got('base')->'body'->'baseline'->>'id')::uuid);
select is((pg_temp.m('cmp', 'received')->>'value')::bigint, 12000::bigint, 'período atual vê o novo registro');
select ok(pg_temp.got('cmp')->'baseline'->'metrics' @> '[{"key":"received","value":6000}]', 'baseline congelada com o valor antigo');
select ok(pg_temp.got('cmp')->'comparison' @> '[{"key":"received","delta":6000}]', 'comparação mostra a diferença');
select ok(pg_temp.got('cmp')->'comparison' @> '[{"key":"reminders","delta":null}]', 'sem dado, sem diferença');
select ok(pg_temp.got('cmp')->>'comparison_note' ~ 'não prova', 'aviso de que antes/depois não prova causa');
select is(jsonb_array_length(public.analytics_baseline_list((select tenant_a from ids))->'baselines'), 1, 'lista de baselines');
reset role;
select throws_ok(format($$ update public.analytics_baselines set metrics = '[]' where id = %L $$, pg_temp.got('base')->'body'->'baseline'->>'id'),
  'PT403', 'FORBIDDEN', 'baseline é imutável');
set local role authenticated;

-- ------------------------------------------------------------------ período atual e validações
insert into r select 'now', public.analytics_metrics((select tenant_a from ids), now() - interval '1 day', now() + interval '6 days', null);
select ok(pg_temp.got('now')->'coverage' @> '[{"key":"future"}]', 'período com dias futuros é avisado');
select throws_ok(format($$ select public.analytics_metrics(%L, now() - interval '500 days', now(), null) $$, (select tenant_a from ids)),
  'PT400', 'VALIDATION_ERROR', 'período máximo de 400 dias');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
select throws_ok(format($$ select public.analytics_metrics(%L, now() - interval '7 days', now(), null) $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'dono de B não lê indicadores de A');
select throws_ok(format($$ select public.analytics_metrics(%L, now() - interval '7 days', now(), %L) $$, (select tenant_b from ids),
  pg_temp.got('base')->'body'->'baseline'->>'id'), 'PT404', 'NOT_FOUND', 'baseline de A não serve para B');
select is((select count(*)::int from public.analytics_baselines), 0, 'RLS: dono de B não vê baselines de A');
insert into r select 'b', public.analytics_metrics((select tenant_b from ids), now() - interval '7 days', now(), null);
select is(pg_temp.m('b', 'occupancy')->>'status', 'insufficient', 'sem expediente: ocupação sem denominador');
select pg_temp.login_as((select customer_ab from ids));
select throws_ok(format($$ select public.analytics_baseline_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN',
  'cliente com login não vê indicadores');

-- ------------------------------------------------------------------ custo de atendimento (operação)
select pg_temp.login_as((select owner_a from ids));
select throws_ok($$ select public.analytics_cost_to_serve(now() - interval '30 days', now(), 6000) $$, 'PT403', 'FORBIDDEN',
  'custo por cliente é só da operação');
select pg_temp.login_as((select op from ids));
insert into r select 'cost', public.analytics_cost_to_serve(now() - interval '30 days', now(), 6000);
select ok(pg_temp.got('cost')->'tenants' @> jsonb_build_array(jsonb_build_object('tenant_id', (select tenant_a from ids),
  'human_minutes', 45, 'reprocess_minutes', 15, 'estimated_cost_cents', 4500)), 'custo = 45 min × R$60/h = R$45');
select throws_ok($$ select public.analytics_cost_to_serve(now() - interval '30 days', now(), -1) $$, 'PT400', 'VALIDATION_ERROR',
  'custo-hora inválido');

select * from finish();
rollback;

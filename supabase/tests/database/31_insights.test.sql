-- P45 · Insights proativos: cada uma das nove regras com caso POSITIVO (dispara), NEGATIVO (quieta) e INSUFICIENTE
-- (sem dado bastante: nunca zero disfarçado); evidência com período, número e denominador; motor diário com uma rodada
-- por negócio e dia e upsert por (regra, assunto): duas rodadas não duplicam insight; "Agora não" silencia 30 dias;
-- "Preparar" cria PROPOSTA no fluxo dono (regra de preço inativa no P05, rascunho manual no P13) e nada executa;
-- dado mudou → recusa; acompanhamento em 30 dias por advice_decisions (P22); resumo semanal; isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(90);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  'America/Sao_Paulo'::text as tz;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.t(n integer) returns uuid language sql immutable as $$ select format('51000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.res(n integer) returns uuid language sql immutable as $$ select format('52000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.svc(n integer) returns uuid language sql immutable as $$ select format('53000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.cus(n integer, k integer) returns uuid language sql immutable as $$ select format('54000000-0000-4000-8000-%s%s', lpad(n::text, 4, '0'), lpad(k::text, 8, '0'))::uuid $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.t(integer), pg_temp.cus(integer, integer) to anon, authenticated;
/** Negócio de teste com 200 dias de conta, um profissional, o dono A como dono e (opcionalmente) o serviço Corte. */
create function pg_temp.mk(n integer, p_service boolean default true) returns uuid language plpgsql as $$
begin
  insert into public.tenants (id, name, profession, timezone, created_at) values (pg_temp.t(n), format('Negócio %s', n), 'barber', 'America/Sao_Paulo', now() - interval '200 days');
  insert into public.tenant_memberships (tenant_id, user_id, role) values (pg_temp.t(n), (select owner_a from ids), 'owner');
  insert into public.resources (id, tenant_id, name) values (pg_temp.res(n), pg_temp.t(n), 'Profissional');
  if p_service then
    insert into public.provider_services (id, tenant_id, name, duration_min, base_price_cents, min_price_cents, estimated_cost_cents, fee_bps, active)
    values (pg_temp.svc(n), pg_temp.t(n), 'Corte', 30, 6000, 4500, 1000, 0, true);
  end if;
  return pg_temp.t(n);
end $$;
create function pg_temp.cust(n integer, k integer) returns uuid language sql as $$
  insert into public.customers (id, tenant_id, name) values (pg_temp.cus(n, k), pg_temp.t(n), format('Cliente%s Sobrenome', k)) returning id
$$;
/** Atendimento de 30 min. */
create function pg_temp.bk(n integer, p_customer uuid, p_start timestamptz, p_status text) returns uuid language sql as $$
  insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
  values (pg_temp.t(n), pg_temp.res(n), p_customer, pg_temp.svc(n), p_start, p_start + interval '30 minutes', tstzrange(p_start, p_start + interval '30 minutes', '[)'),
    p_status in ('held', 'confirmed', 'completed'), p_status, 6000, 'owner') returning id
$$;
create function pg_temp.ev(n integer, p_code text, p_now timestamptz default now()) returns jsonb language sql as $$ select app.gi_evaluate(pg_temp.t(n), p_code, p_now) $$;
create function pg_temp.st(n integer, p_code text, p_now timestamptz default now()) returns text language sql as $$ select pg_temp.ev(n, p_code, p_now)->>'status' $$;
/** Instante local de hoje − d dias às HH. */
create function pg_temp.ago(d integer, hh integer) returns timestamptz language sql as $$
  select (((now() at time zone 'America/Sao_Paulo')::date - d)::timestamp + make_interval(hours => hh)) at time zone 'America/Sao_Paulo'
$$;

-- ------------------------------------------------------------------ estrutura
select is((select count(*)::int from public.insight_rules), 9, 'nove regras no catálogo (só por migration)');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('insight_rules', 'insight_runs', 'insights', 'insight_digests')), 'RLS ligada nas tabelas do motor');
select ok(not has_table_privilege('authenticated', 'public.insights', 'insert') and not has_table_privilege('authenticated', 'public.insights', 'update'), 'dono não grava insight direto');
select ok(not has_table_privilege('authenticated', 'public.insight_runs', 'select'), 'rodadas só do backend');
select ok(not has_function_privilege('authenticated', 'app.gi_tick(integer, timestamptz)', 'execute'), 'motor só do backend');
select is((select count(*)::int from public.channel_templates where code = 'pacote_vencendo' and category = 'utility'), 1, 'modelo de aviso de pacote (P13) aprovado por migration');

-- ------------------------------------------------------------------ 1. atendimentos sem cobrança (P07)
select pg_temp.mk(1);
select pg_temp.bk(1, null, pg_temp.ago(d, 10), 'completed') from generate_series(1, 4) d;
select is(pg_temp.st(1, 'uncharged_bookings'), 'insufficient', 'cobrança: 4 concluídos → insuficiente (não é 0%)');
select pg_temp.bk(1, null, pg_temp.ago(5, 10), 'completed');
insert into r select 'unch', pg_temp.ev(1, 'uncharged_bookings');
select is(pg_temp.got('unch')->>'status', 'fire', 'cobrança: 0 de 5 → dispara');
select is(pg_temp.got('unch')->'evidence'->>'denominator', '5', 'cobrança: denominador na evidência');
select ok(pg_temp.got('unch')->'evidence' ?& array['period_start', 'period_end', 'numerator'], 'cobrança: período e número');
select is(pg_temp.got('unch')->'action'->>'route', '/app/caixa', 'cobrança: abre o Caixa (P07)');
insert into public.receivables (tenant_id, booking_id, description, amount_cents)
select b.tenant_id, b.id, 'Corte', 6000 from public.bookings b where b.tenant_id = pg_temp.t(1);
select is(pg_temp.st(1, 'uncharged_bookings'), 'quiet', 'cobrança: 5 de 5 registradas → quieta');

-- ------------------------------------------------------------------ 2. vaga aberta com lista de espera (P06)
select pg_temp.mk(2);
select pg_temp.cust(2, 1);
select is(pg_temp.st(2, 'waitlist_opening'), 'insufficient', 'espera: sem lista de espera usada → insuficiente');
insert into public.contact_consents (id, tenant_id, customer_id, purpose, channel) values ('55000000-0000-4000-8000-000000000002', pg_temp.t(2), pg_temp.cus(2, 1), 'waitlist_offer', 'manual_share');
insert into public.waitlist_entries (id, tenant_id, customer_id, service_id, acceptable_windows, consent_id, valid_until)
values ('56000000-0000-4000-8000-000000000002', pg_temp.t(2), pg_temp.cus(2, 1), pg_temp.svc(2), '[{"weekday": 2, "local_start": "09:00", "local_end": "18:00"}]', '55000000-0000-4000-8000-000000000002', now() + interval '30 days');
select is(pg_temp.st(2, 'waitlist_opening'), 'quiet', 'espera: gente esperando sem vaga aberta → quieta');
insert into public.waitlist_candidates (tenant_id, entry_id, slot) values (pg_temp.t(2), '56000000-0000-4000-8000-000000000002', tstzrange(now() + interval '2 days', now() + interval '2 days 30 minutes', '[)'));
insert into r select 'wl', pg_temp.ev(2, 'waitlist_opening');
select is(pg_temp.got('wl')->>'status', 'fire', 'espera: vaga aberta + 1 pessoa → dispara');
select is(pg_temp.got('wl')->'evidence'->>'numerator' || '/' || (pg_temp.got('wl')->'evidence'->>'denominator'), '1/1', 'espera: 1 vaga para 1 pessoa');
select is(pg_temp.got('wl')->'action'->>'route', '/app/lista-de-espera', 'espera: abre a lista de espera (P06)');

-- ------------------------------------------------------------------ 3. faltas concentradas (P13)
select pg_temp.mk(3);
select pg_temp.bk(3, null, pg_temp.ago(d, 10), 'completed') from generate_series(1, 19) d;
select is(pg_temp.st(3, 'no_show_concentration'), 'insufficient', 'faltas: 19 com desfecho → insuficiente');
select pg_temp.bk(3, null, pg_temp.ago(d, 10), case when d in (20, 21) then 'no_show' else 'completed' end) from generate_series(20, 42) d;
select is(pg_temp.st(3, 'no_show_concentration'), 'quiet', 'faltas: 2 de 42 espalhadas → quieta');
-- 4 das 6 do mesmo dia da semana viram falta.
update public.bookings b set status = 'no_show', blocks_capacity = false
where b.tenant_id = pg_temp.t(3) and extract(dow from b.starts_at at time zone 'America/Sao_Paulo') = extract(dow from pg_temp.ago(7, 10) at time zone 'America/Sao_Paulo')
  and b.id in (select x.id from public.bookings x where x.tenant_id = pg_temp.t(3) and extract(dow from x.starts_at at time zone 'America/Sao_Paulo') = extract(dow from pg_temp.ago(7, 10) at time zone 'America/Sao_Paulo') order by x.starts_at limit 4);
insert into r select 'ns', pg_temp.ev(3, 'no_show_concentration');
select is(pg_temp.got('ns')->>'status', 'fire', 'faltas: um dia com 4 de 6 → dispara');
select is(pg_temp.got('ns')->'evidence'->>'denominator', '6', 'faltas: denominador = atendimentos daquele dia');
select is(pg_temp.got('ns')->>'subject_key', 'wd' || extract(dow from pg_temp.ago(7, 10) at time zone 'America/Sao_Paulo')::int, 'faltas: assunto = o dia da semana');

-- ------------------------------------------------------------------ 4. pacote perto de vencer (P13, rascunho)
select pg_temp.mk(4);
select pg_temp.cust(4, 1);
select is(pg_temp.st(4, 'package_expiring'), 'insufficient', 'pacote: nenhum vendido → insuficiente');
insert into public.session_packages (tenant_id, customer_id, service_id, purchased_credits, total_price_cents, expires_at)
values (pg_temp.t(4), pg_temp.cus(4, 1), pg_temp.svc(4), 4, 20000, now() + interval '60 days');
select is(pg_temp.st(4, 'package_expiring'), 'quiet', 'pacote: vence em 60 dias → quieta');
insert into public.session_packages (tenant_id, customer_id, service_id, purchased_credits, total_price_cents, expires_at)
values (pg_temp.t(4), pg_temp.cus(4, 1), pg_temp.svc(4), 3, 15000, now() + interval '10 days');
insert into r select 'pk', pg_temp.ev(4, 'package_expiring');
select is(pg_temp.got('pk')->>'status', 'fire', 'pacote: vence em 10 dias com sessões → dispara');
select is(pg_temp.got('pk')->'evidence'->>'numerator' || '/' || (pg_temp.got('pk')->'evidence'->>'denominator'), '1/2', 'pacote: 1 de 2 pacotes ativos');

-- ------------------------------------------------------------------ 5. clientes sem retorno (P13, rascunho)
select pg_temp.mk(5);
select pg_temp.cust(5, k) from generate_series(1, 6) k;
select pg_temp.bk(5, pg_temp.cus(5, k), pg_temp.ago(40 + k, 9 + k), 'completed'), pg_temp.bk(5, pg_temp.cus(5, k), pg_temp.ago(10 + k, 9 + k), 'completed') from generate_series(1, 4) k;
select is(pg_temp.st(5, 'lapsed_customers'), 'insufficient', 'retorno: 4 clientes de retorno → insuficiente');
select pg_temp.bk(5, pg_temp.cus(5, 5), pg_temp.ago(45, 9), 'completed'), pg_temp.bk(5, pg_temp.cus(5, 5), pg_temp.ago(15, 9), 'completed');
select is(pg_temp.st(5, 'lapsed_customers'), 'quiet', 'retorno: 5 clientes dentro do costume → quieta');
select pg_temp.bk(5, pg_temp.cus(5, 6), pg_temp.ago(120, 9), 'completed'), pg_temp.bk(5, pg_temp.cus(5, 6), pg_temp.ago(90, 9), 'completed');
insert into r select 'lp', pg_temp.ev(5, 'lapsed_customers');
select is(pg_temp.got('lp')->>'status', 'fire', 'retorno: cliente sem vir há 90 dias (costume 45) → dispara');
select is(pg_temp.got('lp')->'evidence'->>'numerator' || '/' || (pg_temp.got('lp')->'evidence'->>'denominator'), '1/6', 'retorno: 1 de 6 clientes de retorno');
select ok(not (pg_temp.got('lp')::text ~ 'Cliente[0-9]'), 'retorno: evidência e textos sem nome de cliente');

-- ------------------------------------------------------------------ 6. horário ocioso recorrente (P05, proposta)
select pg_temp.mk(6);
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end) values (pg_temp.t(6), pg_temp.res(6), 1, '09:00', '11:00');
select is(pg_temp.st(6, 'idle_slot'), 'insufficient', 'ocioso: sem atendimentos bastantes nas 5 semanas → insuficiente');
-- Segundas das 5 semanas encerradas: 9h e 10h ocupadas (10 atendimentos).
select pg_temp.bk(6, null, ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date - 35 + 7 * k)::timestamp + make_interval(hours => hh)) at time zone 'America/Sao_Paulo', 'completed')
from generate_series(0, 4) k, (values (9), (10)) v(hh);
select is(pg_temp.st(6, 'idle_slot'), 'quiet', 'ocioso: expediente cheio → quieta');
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end) values (pg_temp.t(6), pg_temp.res(6), 2, '14:00', '16:00');
insert into r select 'idle', pg_temp.ev(6, 'idle_slot');
select is(pg_temp.got('idle')->>'status', 'fire', 'ocioso: terça 14–16 vazia em 5 de 5 semanas → dispara');
select is(pg_temp.got('idle')->>'subject_key', 'wd2-14-16', 'ocioso: assunto = dia e faixa');
select is(pg_temp.got('idle')->'evidence'->>'numerator' || '/' || (pg_temp.got('idle')->'evidence'->>'denominator'), '5/5', 'ocioso: semanas vazias / semanas olhadas');
select is(pg_temp.got('idle')->'action'->>'operation', 'pricing.propose_rule', 'ocioso: ação é proposta de regra de preço (P05)');

-- ------------------------------------------------------------------ 7. serviço abaixo da margem (P05)
select pg_temp.mk(7);
select is(pg_temp.st(7, 'low_margin_service'), 'insufficient', 'margem: sem ficha de materiais → insuficiente');
insert into public.material_items (id, tenant_id, name, unit, on_hand, stock_value_cents) values ('57000000-0000-4000-8000-000000000007', pg_temp.t(7), 'Pomada', 'un', 10, 1000);
insert into public.material_service_usage (tenant_id, service_id, item_id, quantity) values (pg_temp.t(7), pg_temp.svc(7), '57000000-0000-4000-8000-000000000007', 5);
select is(pg_temp.st(7, 'low_margin_service'), 'quiet', 'margem: materiais 8% do preço → quieta');
update public.material_service_usage set quantity = 20 where tenant_id = pg_temp.t(7);
insert into r select 'mg', pg_temp.ev(7, 'low_margin_service');
select is(pg_temp.got('mg')->>'status', 'fire', 'margem: materiais 33% do preço → dispara');
select is(pg_temp.got('mg')->'evidence'->>'cost_cents', '2000', 'margem: custo pela ficha × custo médio');
select is(pg_temp.got('mg')->'evidence'->>'numerator' || '/' || (pg_temp.got('mg')->'evidence'->>'denominator'), '1/1', 'margem: serviços acima / serviços com ficha');

-- ------------------------------------------------------------------ 8. perfil incompleto (P44)
select pg_temp.mk(8, false);
select is(pg_temp.st(8, 'profile_incomplete'), 'insufficient', 'perfil: antes do primeiro serviço quem fala é a configuração guiada');
insert into public.provider_services (id, tenant_id, name, duration_min, base_price_cents, min_price_cents, active) values (pg_temp.svc(8), pg_temp.t(8), 'Corte', 30, 6000, 4500, true);
insert into r select 'pf', pg_temp.ev(8, 'profile_incomplete');
select is(pg_temp.got('pf')->>'status', 'fire', 'perfil: sem publicar, foto e canal → dispara');
select is(pg_temp.got('pf')->'evidence'->>'numerator' || '/' || (pg_temp.got('pf')->'evidence'->>'denominator'), '1/4', 'perfil: itens prontos / itens olhados');
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at, photo_path)
values (pg_temp.t(8), 'negocio-8', 'barber', 'Centro', array['display_name', 'area'], now(), pg_temp.t(8)::text || '/foto.webp');
insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at) values (pg_temp.t(8), 'simulated', '+5511900000008', '+5511900000008', 'active', now());
select is(pg_temp.st(8, 'profile_incomplete'), 'quiet', 'perfil: tudo pronto → quieta');

-- ------------------------------------------------------------------ 9. mês fechando (P07/P31)
select pg_temp.mk(9);
create temp table mc as select
  ((date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '9 days 12 hours') at time zone 'America/Sao_Paulo') as mid,
  ((date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month' - interval '12 hours') at time zone 'America/Sao_Paulo') as last_day,
  ((date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 day 10 hours') at time zone 'America/Sao_Paulo') as day2;
select is(pg_temp.st(9, 'month_closing', (select last_day from mc)), 'insufficient', 'mês: nenhum registro no mês → insuficiente');
insert into public.expense_entries (tenant_id, amount_cents, paid_at, category) values (pg_temp.t(9), 12000, (select day2 from mc), 'rent');
select is(pg_temp.st(9, 'month_closing', (select mid from mc)), 'quiet', 'mês: dia 10 → quieta');
insert into r select 'mc', pg_temp.ev(9, 'month_closing', (select last_day from mc));
select is(pg_temp.got('mc')->>'status', 'fire', 'mês: último dia com registros → dispara');
select is(pg_temp.got('mc')->'evidence'->>'expenses_cents', '12000', 'mês: despesas do mês');
select is(pg_temp.got('mc')->'action'->>'kind', 'none', 'mês: só informa (sem ação)');

-- ------------------------------------------------------------------ motor: rodada diária sem duplicar
insert into r select 'run1', app.gi_tick(200);
select ok((pg_temp.got('run1')->>'tenants')::int >= 9, 'rodada do dia avalia cada negócio');
select is(app.gi_tick(200)->>'tenants', '0', 'segunda rodada no mesmo dia não avalia de novo');
select app.gi_run(pg_temp.t(1), now());
select is((select count(*)::int from public.insights where tenant_id = pg_temp.t(6) and rule_code = 'idle_slot'), 1, 'rodar o motor de novo não duplica o insight (upsert por regra e assunto)');
select app.gi_run(pg_temp.t(6), now());
select is((select count(*)::int from public.insights where tenant_id = pg_temp.t(6) and rule_code = 'idle_slot'), 1, 'idem para a mesma regra no mesmo negócio');
select is((select count(*)::int from public.insights where tenant_id = pg_temp.t(1) and rule_code = 'uncharged_bookings'), 0, 'regra quieta não abre insight');
select is((select result->'rules' @> '[{"code": "uncharged_bookings", "status": "quiet"}]'::jsonb from public.insight_runs where tenant_id = pg_temp.t(1)), true, 'status de cada regra fica na rodada');

-- ------------------------------------------------------------------ dono: lista, "Agora não", "Preparar"
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'home3', public.insight_list(pg_temp.t(3), 'home');
select is((select string_agg(x->>'rule_code', ',' order by (x->>'priority')::int desc) from jsonb_array_elements(pg_temp.got('home3')->'insights') x),
  'uncharged_bookings,no_show_concentration,profile_incomplete', 'Home: até 3 abertos, por prioridade');
insert into r select 'ns3', (select x from jsonb_array_elements(pg_temp.got('home3')->'insights') x where x->>'rule_code' = 'no_show_concentration');
select ok(not ((pg_temp.got('ns3')->'action') ? 'payload'), 'tela não recebe o payload interno da ação');
select ok(pg_temp.got('ns3')->'evidence' ?& array['period_start', 'period_end', 'numerator', 'denominator'], 'todo insight mostra período, número e denominador');
insert into r select 'snz', public.insight_snooze(pg_temp.t(3), (pg_temp.got('ns3')->>'id')::uuid, (pg_temp.got('ns3')->>'version')::int, 'idem-insight-snooze-0001', pg_temp.h('snz'));
select is(pg_temp.got('snz')->'body'->'insight'->>'state', 'snoozed', '"Agora não" silencia');
select ok(not (public.insight_list(pg_temp.t(3), 'home')::text like '%no_show_concentration%'), 'silenciado sai da Home');
select is((select decision from public.advice_decisions where tenant_id = pg_temp.t(3) and rule_code = 'no_show_concentration'), 'dismissed', 'dispensa registrada para o acompanhamento (P22)');
reset role;
select app.gi_run(pg_temp.t(3), now() + interval '1 day');
select is((select state from public.insights where tenant_id = pg_temp.t(3) and rule_code = 'no_show_concentration'), 'snoozed', 'regra silenciada não volta no dia seguinte');
select app.gi_run(pg_temp.t(3), now() + interval '31 days');
select isnt((select state from public.insights where tenant_id = pg_temp.t(3) and rule_code = 'no_show_concentration'), 'open', '31 dias depois, sem as faltas no período, a regra não reabre');
-- Mesmo dia + 31 com a regra ainda disparando (negócio 6, faixa ociosa): o silêncio acabou e o insight volta.
update public.insights set state = 'snoozed', quiet_until = now() + interval '30 days' where tenant_id = pg_temp.t(6) and rule_code = 'idle_slot';
select app.gi_run(pg_temp.t(6), now() + interval '1 day');
select is((select state from public.insights where tenant_id = pg_temp.t(6) and rule_code = 'idle_slot'), 'snoozed', 'dentro dos 30 dias, segue silenciado mesmo disparando');
update public.insights set quiet_until = now() - interval '1 minute' where tenant_id = pg_temp.t(6) and rule_code = 'idle_slot';
select app.gi_run(pg_temp.t(6), now());
select is((select state from public.insights where tenant_id = pg_temp.t(6) and rule_code = 'idle_slot'), 'open', 'passado o silêncio e ainda disparando, volta a aparecer');

-- Preparar no P05: proposta inativa; nada publicado.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'i6', (select x from jsonb_array_elements(public.insight_list(pg_temp.t(6), 'all')->'insights') x where x->>'rule_code' = 'idle_slot');
insert into r select 'act6', public.insight_act(pg_temp.t(6), (pg_temp.got('i6')->>'id')::uuid, (pg_temp.got('i6')->>'version')::int, 'idem-insight-act-000006', pg_temp.h('act6'));
select is(pg_temp.got('act6')->'body'->'result'->>'kind', 'pricing_proposal', 'Preparar cria proposta de regra de preço');
select is(public.insight_act(pg_temp.t(6), (pg_temp.got('i6')->>'id')::uuid, (pg_temp.got('i6')->>'version')::int, 'idem-insight-act-000006', pg_temp.h('act6'))->'body'->'result'->>'ref',
  pg_temp.got('act6')->'body'->'result'->>'ref', 'repetir a chave devolve a mesma proposta');
reset role;
select is((select count(*)::int from public.pricing_rule_proposals where tenant_id = pg_temp.t(6) and status = 'proposed'), 1, 'uma proposta pendente no P05');
select is((select count(*)::int from public.pricing_rules where tenant_id = pg_temp.t(6)), 0, 'nenhuma regra de preço ativa sem aprovação');
select is((select windows from public.pricing_rule_proposals where tenant_id = pg_temp.t(6)), '[{"weekday": 2, "local_end": "16:00", "local_start": "14:00"}]'::jsonb, 'proposta só para a faixa ociosa');
select is((select decision from public.advice_decisions where tenant_id = pg_temp.t(6) and rule_code = 'idle_slot'), 'accepted', 'decisão registrada com o número de agora');

-- Preparar no P13: rascunhos manuais, nada sai pelo canal; sem consentimento de marketing, pula.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'i5', (select x from jsonb_array_elements(public.insight_list(pg_temp.t(5), 'all')->'insights') x where x->>'rule_code' = 'lapsed_customers');
insert into r select 'act5', public.insight_act(pg_temp.t(5), (pg_temp.got('i5')->>'id')::uuid, (pg_temp.got('i5')->>'version')::int, 'idem-insight-act-000005', pg_temp.h('act5'));
select is(pg_temp.got('act5')->'body'->'result'->>'skipped', '1', 'retorno sem consentimento de marketing: nenhum rascunho');
reset role;
insert into public.lifecycle_consents (tenant_id, customer_id, purpose) values (pg_temp.t(5), pg_temp.cus(5, 6), 'marketing');
-- Simula o fim do silêncio de 30 dias para preparar de novo.
update public.insights set state = 'open', quiet_until = null where tenant_id = pg_temp.t(5) and rule_code = 'lapsed_customers';
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'act5b', public.insight_act(pg_temp.t(5), (pg_temp.got('i5')->>'id')::uuid, (select version from public.insights where id = (pg_temp.got('i5')->>'id')::uuid), 'idem-insight-act-000055', pg_temp.h('act5b'));
select is(pg_temp.got('act5b')->'body'->'result'->>'created', '1', 'com consentimento: um rascunho de convite');
reset role;
select is((select status from public.lifecycle_steps where tenant_id = pg_temp.t(5)), 'manual', 'rascunho manual em Relacionamento (o dono revisa e envia)');
select ok((select body from public.lifecycle_steps where tenant_id = pg_temp.t(5)) like 'Olá, Cliente6!%', 'texto pelo modelo aprovado');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'i4', (select x from jsonb_array_elements(public.insight_list(pg_temp.t(4), 'all')->'insights') x where x->>'rule_code' = 'package_expiring');
insert into r select 'act4', public.insight_act(pg_temp.t(4), (pg_temp.got('i4')->>'id')::uuid, (pg_temp.got('i4')->>'version')::int, 'idem-insight-act-000004', pg_temp.h('act4'));
reset role;
select is((select rule || '/' || aggregate_type || '/' || status from public.lifecycle_steps where tenant_id = pg_temp.t(4)), 'package_expiry/package/manual', 'aviso de pacote como rascunho manual');
select is((select count(*)::int from public.channel_messages where tenant_id in (pg_temp.t(4), pg_temp.t(5))), 0, 'nenhuma mensagem enviada sem aprovação');

-- Dado mudou entre a rodada e o clique: recusa.
select app.gi_run(pg_temp.t(2), now());
delete from public.waitlist_candidates where tenant_id = pg_temp.t(2);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'i2', (select x from jsonb_array_elements(public.insight_list(pg_temp.t(2), 'all')->'insights') x where x->>'rule_code' = 'waitlist_opening');
select throws_ok(format($$ select public.insight_act(%L, %L, %s, 'idem-insight-act-000002', %L) $$, pg_temp.t(2), pg_temp.got('i2')->>'id', pg_temp.got('i2')->>'version', pg_temp.h('act2')),
  'PT422', 'POLICY_REJECTED', 'regra que deixou de valer não gera ação (dado de agora)');
select throws_ok(format($$ select public.insight_snooze(%L, %L, 99, 'idem-insight-snooze-0002', %L) $$, pg_temp.t(2), pg_temp.got('i2')->>'id', pg_temp.h('snz2')),
  'PT409', 'STALE_VERSION', 'versão antiga não silencia');
reset role;

-- Acompanhamento em 30 dias (P22): mede a mesma regra de novo.
update public.receivables set status = 'cancelled' where tenant_id = pg_temp.t(1);
select app.gi_run(pg_temp.t(1), now() + interval '1 day');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'i1', (select x from jsonb_array_elements(public.insight_list(pg_temp.t(1), 'all')->'insights') x where x->>'rule_code' = 'uncharged_bookings');
insert into r select 'act1', public.insight_act(pg_temp.t(1), (pg_temp.got('i1')->>'id')::uuid, (pg_temp.got('i1')->>'version')::int, 'idem-insight-act-000001', pg_temp.h('act1'));
select is(pg_temp.got('act1')->'body'->'result'->>'route', '/app/caixa', 'Ver abre a tela do fluxo dono');
reset role;
update public.receivables set status = 'open' where tenant_id = pg_temp.t(1);
update public.advice_decisions set follow_up_at = clock_timestamp() - interval '1 minute' where tenant_id = pg_temp.t(1);
select app.ga_tick(100);
select is((select outcome from public.advice_decisions where tenant_id = pg_temp.t(1) and rule_code = 'uncharged_bookings'), 'improved', 'acompanhamento: 0% → 100% registrados = melhorou (variação observada)');

-- Resumo semanal por modelo fixo, um por semana.
select isnt(app.gi_digest(pg_temp.t(3), now() + interval '7 days'), null, 'resumo da semana criado');
select is(app.gi_digest(pg_temp.t(3), now() + interval '7 days'), null, 'mesma semana não gera outro resumo');
select ok((select body from public.insight_digests where tenant_id = pg_temp.t(3) order by week_start desc limit 1) like 'Resumo da semana de %', 'texto do modelo fixo');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.insight_list(%L, 'home') $$, pg_temp.t(1)), 'PT403', 'FORBIDDEN', 'dono de outro negócio não lê');
select throws_ok(format($$ select public.digest_list(%L) $$, pg_temp.t(3)), 'PT403', 'FORBIDDEN', 'nem o resumo');
select is((select count(*)::int from public.insights where tenant_id = pg_temp.t(1)), 0, 'RLS: B não vê insights de A');
select is((select count(*)::int from public.insight_digests), 0, 'RLS: B não vê resumos de A');
reset role;

select * from finish();
rollback;

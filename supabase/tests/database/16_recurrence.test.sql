-- P20 · Planos recorrentes: plano do profissional; adesão congela os termos (hash) e abre o 1º ciclo (pacote + recebível
-- pelo preço aceito); mudar o plano não altera a assinatura; consumo de sessão é o do P07; renovação pelo worker abre
-- um ciclo por número (idempotente) e vence o pacote anterior; cancelar ao fim do ciclo não renova; cancelar agora
-- preserva o saldo do ciclo corrente; retomar desfaz o pedido; isolamento e auditoria sem PII.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '30000000-0000-4000-8000-0000000000a2'::uuid as carlos;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.sub(p_k text) returns jsonb language sql as $$ select v->'body'->'subscription' from r where k = p_k $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.sub(text) to anon, authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'recurrence_%'), 'RLS ligada na recorrência');
select ok(not has_table_privilege('authenticated', 'public.recurrence_subscriptions', 'insert'), 'dono não cria assinatura direto');
select ok(not has_function_privilege('authenticated', 'app.rc_tick(integer)', 'execute'), 'renovação só do backend');
select ok(not has_function_privilege('anon', 'public.recurrence_subscribe(uuid, uuid, uuid, text, text, uuid)', 'execute'), 'anon não assina');

-- ------------------------------------------------------------------ plano
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.recurrence_plan_save(%L, null, null, %L, 'Corte mensal', 0, 30, 20000, true, 'idem-rc-plan-000000', %L) $$,
  (select tenant_a from ids), (select corte_a from ids), pg_temp.h('p0')), 'PT400', 'VALIDATION_ERROR', 'sessões por ciclo fora do permitido');
select throws_ok(format($$ select public.recurrence_plan_save(%L, null, null, %L, 'Corte mensal', 4, 10, 20000, true, 'idem-rc-plan-000001', %L) $$,
  (select tenant_a from ids), (select corte_a from ids), pg_temp.h('p1')), 'PT400', 'VALIDATION_ERROR', 'ciclo só de 7, 14 ou 30 dias');
insert into r select 'plan', public.recurrence_plan_save((select tenant_a from ids), null, null, (select corte_a from ids), 'Corte mensal', 4, 30, 20000, true, 'idem-rc-plan-000002', pg_temp.h('plan'));
select is((pg_temp.got('plan')->>'status_code')::int, 201, 'plano criado');
select is(pg_temp.got('plan')->'body'->'plan'->>'service_name', 'Corte', 'com o nome do serviço');
select is(public.recurrence_plan_save((select tenant_a from ids), null, null, (select corte_a from ids), 'Corte mensal', 4, 30, 20000, true, 'idem-rc-plan-000002', pg_temp.h('plan')),
  pg_temp.got('plan'), 'repetir devolve o mesmo plano');

-- ------------------------------------------------------------------ adesão: termos congelados e 1º ciclo
insert into r select 's1', public.recurrence_subscribe((select tenant_a from ids), (pg_temp.got('plan')->'body'->'plan'->>'id')::uuid, (select ana from ids), 'idem-rc-sub-0000001', pg_temp.h('s1'));
select is((pg_temp.got('s1')->>'status_code')::int, 201, 'assinatura criada');
select is(pg_temp.sub('s1')->'terms', '{"plan_name": "Corte mensal", "service_id": "40000000-0000-4000-8000-0000000000a1", "service_name": "Corte", "sessions_per_cycle": 4, "cycle_days": 30, "price_cents": 20000}'::jsonb,
  'termos aceitos congelados');
select is(pg_temp.sub('s1')->>'accepted_source', 'owner_declared', 'adesão declarada pelo dono');
select is((pg_temp.sub('s1')->>'cycles_count')::int, 1, 'primeiro ciclo aberto');
select is((pg_temp.sub('s1')->'current_cycle'->'package'->>'remaining_credits')::int, 4, 'pacote com 4 sessões');
select is((pg_temp.sub('s1')->'current_cycle'->'receivable'->>'amount_cents')::bigint, 20000::bigint, 'recebível pelo preço aceito');
select is(pg_temp.sub('s1')->'current_cycle'->'receivable'->>'status', 'open', 'em aberto: cobrar pelo P14 ou registrar manual');
select is((pg_temp.sub('s1')->>'next_renewal_at')::timestamptz, (pg_temp.sub('s1')->>'started_at')::timestamptz + interval '30 days', 'renova em 30 dias');
select throws_ok(format($$ select public.recurrence_subscribe(%L, %L, %L, 'idem-rc-sub-0000002', %L) $$,
  (select tenant_a from ids), pg_temp.got('plan')->'body'->'plan'->>'id', (select ana from ids), pg_temp.h('s2')), 'PT422', 'POLICY_REJECTED', 'uma assinatura ativa por cliente e plano');
reset role;
select is((select count(*)::int from public.outbox_events where event_type = 'recurrence.cycle.opened.v1'), 1, 'evento de ciclo aberto');
select is((select count(*)::int from public.receivables where package_id = (pg_temp.sub('s1')->'current_cycle'->'package'->>'package_id')::uuid), 1, 'um recebível por ciclo');

-- Mudar o preço do plano não altera a assinatura.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'plan2', public.recurrence_plan_save((select tenant_a from ids), (pg_temp.got('plan')->'body'->'plan'->>'id')::uuid, 1, (select corte_a from ids), 'Corte mensal', 4, 30, 25000, true, 'idem-rc-plan-000003', pg_temp.h('plan2'));
select is((pg_temp.got('plan2')->'body'->'plan'->>'price_cents')::bigint, 25000::bigint, 'plano reajustado');
select throws_ok(format($$ select public.recurrence_plan_save(%L, %L, 1, %L, 'Corte mensal', 4, 30, 26000, true, 'idem-rc-plan-000004', %L) $$,
  (select tenant_a from ids), pg_temp.got('plan')->'body'->'plan'->>'id', (select corte_a from ids), pg_temp.h('plan3')), 'PT409', 'STALE_VERSION', 'editar exige a versão vista');
insert into r select 'lst', public.recurrence_list((select tenant_a from ids));
select is((pg_temp.got('lst')->'subscriptions'->0->'terms'->>'price_cents')::bigint, 20000::bigint, 'assinatura mantém o preço aceito');
select is((pg_temp.got('plan2')->'body'->'plan'->>'subscribers')::int, 1, 'plano mostra uma assinante');

-- ------------------------------------------------------------------ consumo (P07) e renovação pelo worker
reset role;
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select (select tenant_a from ids), (select res_a from ids), d, '08:00', '20:00' from generate_series(1, 5) d;
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
values ('66000000-0000-4000-8000-000000000001', (select tenant_a from ids), (select res_a from ids), (select ana from ids), (select corte_a from ids),
  now() - interval '2 hours', now() - interval '90 minutes', tstzrange(now() - interval '2 hours', now() - interval '80 minutes', '[)'), true, 'completed', 6000, 'owner');
-- O consumo exige o evento booking.completed.v1 do atendimento (débito único por evento).
insert into r select 'ev', to_jsonb(app.emit_event((select tenant_a from ids), 'booking.completed.v1', '66000000-0000-4000-8000-000000000001', 1, gen_random_uuid(),
  jsonb_build_object('booking_id', '66000000-0000-4000-8000-000000000001', 'customer_id', (select ana from ids), 'service_id', (select corte_a from ids))));
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cons', public.package_consume((select tenant_a from ids), (pg_temp.sub('s1')->'current_cycle'->'package'->>'package_id')::uuid,
  '66000000-0000-4000-8000-000000000001', (pg_temp.got('ev')#>>'{}')::uuid, 'idem-rc-consume-00001', pg_temp.h('cons'));
select is((pg_temp.got('cons')->'body'->>'remaining_credits')::int, 3, 'sessão consumida pelo P07: 3 restantes');
reset role;
insert into r select 'tick0', public.jobs_run(100);
select is((pg_temp.got('tick0')->'recurrence'->>'renewed')::int, 0, 'antes de vencer, nada renova');
update public.recurrence_subscriptions set next_renewal_at = now() - interval '1 minute';
insert into r select 'tick1', public.jobs_run(100);
select is((pg_temp.got('tick1')->'recurrence'->>'renewed')::int, 1, 'venceu: renovou');
insert into r select 'tick2', public.jobs_run(100);
select is((pg_temp.got('tick2')->'recurrence'->>'renewed')::int, 0, 'rodada seguinte não renova de novo');
select is((select count(*)::int from public.recurrence_cycles), 2, 'dois ciclos');
select is((select cycles_count from public.recurrence_subscriptions), 2, 'contagem de ciclos');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'lst2', public.recurrence_list((select tenant_a from ids));
select is((pg_temp.got('lst2')->'subscriptions'->0->'current_cycle'->>'cycle_no')::int, 2, 'ciclo corrente é o 2');
select is((pg_temp.got('lst2')->'subscriptions'->0->'current_cycle'->'package'->>'remaining_credits')::int, 4, 'ciclo novo com 4 sessões (sem transporte do saldo)');
select is((pg_temp.got('lst2')->'subscriptions'->0->'current_cycle'->'receivable'->>'amount_cents')::bigint, 20000::bigint, 'recebível do ciclo 2 pelo preço ACEITO (não os 25.000 do plano)');
insert into r select 'cyc', public.recurrence_cycles_list((select tenant_a from ids), (pg_temp.sub('s1')->>'id')::uuid);
select is(jsonb_array_length(pg_temp.got('cyc')->'cycles'), 2, 'histórico com dois ciclos');
select is((pg_temp.got('cyc')->'cycles'->1->'package'->>'remaining_credits')::int, 3, 'ciclo 1 guarda o saldo de 3 (vencido no fim do ciclo)');

-- ------------------------------------------------------------------ cancelar ao fim do ciclo, retomar, cancelar agora
select throws_ok(format($$ select public.recurrence_cancel(%L, %L, 1, true, 'mudou de cidade', 'idem-rc-cancel-00000', %L) $$,
  (select tenant_a from ids), pg_temp.sub('s1')->>'id', pg_temp.h('c0')), 'PT409', 'STALE_VERSION', 'cancelar exige a versão vista');
insert into r select 'c1', public.recurrence_cancel((select tenant_a from ids), (pg_temp.sub('s1')->>'id')::uuid, (pg_temp.got('lst2')->'subscriptions'->0->>'version')::int, true, 'mudou de cidade', 'idem-rc-cancel-00001', pg_temp.h('c1'));
select is(pg_temp.sub('c1')->>'status', 'active', 'ao fim do ciclo: continua ativa até vencer');
select is((pg_temp.sub('c1')->>'cancel_at_period_end')::boolean, true, 'marcada para não renovar');
insert into r select 'r1', public.recurrence_resume((select tenant_a from ids), (pg_temp.sub('s1')->>'id')::uuid, (pg_temp.sub('c1')->>'version')::int, 'idem-rc-resume-00001', pg_temp.h('r1'));
select is((pg_temp.sub('r1')->>'cancel_at_period_end')::boolean, false, 'retomar desfaz o pedido');
insert into r select 'c2', public.recurrence_cancel((select tenant_a from ids), (pg_temp.sub('s1')->>'id')::uuid, (pg_temp.sub('r1')->>'version')::int, true, 'de novo', 'idem-rc-cancel-00002', pg_temp.h('c2'));
reset role;
update public.recurrence_subscriptions set next_renewal_at = now() - interval '1 minute';
insert into r select 'tick3', public.jobs_run(100);
select is((pg_temp.got('tick3')->'recurrence'->>'closed')::int, 1, 'no vencimento, encerra em vez de renovar');
select is((select status from public.recurrence_subscriptions), 'cancelled', 'assinatura cancelada');
select is((select count(*)::int from public.recurrence_cycles), 2, 'nenhum ciclo novo');
-- Nova assinatura (Carlos), cancelada agora: saldo do ciclo corrente preservado.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 's3', public.recurrence_subscribe((select tenant_a from ids), (pg_temp.got('plan')->'body'->'plan'->>'id')::uuid, (select carlos from ids), 'idem-rc-sub-0000003', pg_temp.h('s3'));
select is((pg_temp.sub('s3')->'terms'->>'price_cents')::bigint, 25000::bigint, 'adesão nova aceita o preço atual do plano');
insert into r select 'c3', public.recurrence_cancel((select tenant_a from ids), (pg_temp.sub('s3')->>'id')::uuid, (pg_temp.sub('s3')->>'version')::int, false, null, 'idem-rc-cancel-00003', pg_temp.h('c3'));
select is(pg_temp.sub('c3')->>'status', 'cancelled', 'cancelar agora encerra');
select is((pg_temp.sub('c3')->'current_cycle'->'package'->>'remaining_credits')::int, 4, 'saldo do ciclo corrente preservado');
select ok((pg_temp.sub('c3')->'current_cycle'->'package'->>'expires_at')::timestamptz > now(), 'pacote vale até o fim do ciclo');
select throws_ok(format($$ select public.recurrence_resume(%L, %L, %s, 'idem-rc-resume-00002', %L) $$,
  (select tenant_a from ids), pg_temp.sub('c3')->>'id', pg_temp.sub('c3')->>'version', pg_temp.h('r2')), 'PT422', 'POLICY_REJECTED', 'cancelada não retoma');
-- Plano inativo não aceita adesão.
insert into r select 'plan4', public.recurrence_plan_save((select tenant_a from ids), (pg_temp.got('plan')->'body'->'plan'->>'id')::uuid, 2, (select corte_a from ids), 'Corte mensal', 4, 30, 25000, false, 'idem-rc-plan-000005', pg_temp.h('plan4'));
select throws_ok(format($$ select public.recurrence_subscribe(%L, %L, %L, 'idem-rc-sub-0000004', %L) $$,
  (select tenant_a from ids), pg_temp.got('plan')->'body'->'plan'->>'id', (select ana from ids), pg_temp.h('s4')), 'PT422', 'POLICY_REJECTED', 'plano inativo não aceita adesão');

-- ------------------------------------------------------------------ isolamento e privacidade
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.recurrence_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não lista assinaturas de A');
select throws_ok(format($$ select public.recurrence_subscribe(%L, %L, %L, 'idem-rc-sub-b-00001', %L) $$,
  (select tenant_a from ids), pg_temp.got('plan')->'body'->'plan'->>'id', (select ana from ids), pg_temp.h('sb')), 'PT403', 'FORBIDDEN', 'B não assina em A');
select is((select count(*) from public.recurrence_subscriptions), 0::bigint, 'RLS: B não vê assinaturas de A');
select is((select count(*) from public.recurrence_plans), 0::bigint, 'RLS: B não vê planos de A');
reset role;
select is((select count(*) from public.audit_events where action like 'recurrence.%' and coalesce(after::text, '') ~ 'Ana|Carlos'), 0::bigint, 'auditoria sem nomes');

select * from finish();
rollback;

-- P19 · Campanhas e experimentos: público só com consentimento de marketing e sem atendimento futuro; aprovação cita o
-- público visto (hash); controle sorteado no servidor; tetos de envio e de gasto aplicados no servidor; oferta
-- vinculada (desconto em serviço / regra de preço); passos pela régua do P13 (marketing); conversão medida nos
-- agendamentos; resultado por braço com intervalo e veredito só pelo desenho; sem controle = observação; cancelar
-- para o pendente; fechar congela; idempotência; isolamento; auditoria sem nomes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.seg(p_days integer) returns jsonb language sql as $$ select jsonb_build_object('kind', 'inactive_days', 'days', p_days) $$;
create function pg_temp.hash(p_seg jsonb) returns text language sql as $$ select public.campaign_preview((select tenant_a from ids), p_seg)->>'audience_hash' $$;
create function pg_temp.approve(p_k text, p_name text, p_seg jsonb, p_ctrl integer, p_max integer, p_cap bigint, p_days integer, p_offer jsonb) returns jsonb language sql as $$
  select public.campaign_approve((select tenant_a from ids), p_name, p_seg, pg_temp.hash(p_seg), p_ctrl, p_max, p_cap, p_days, p_offer, p_k, pg_temp.h(p_k))
$$;
create function pg_temp.cid(p_k text) returns uuid language sql as $$ select (v->'body'->'campaign'->>'id')::uuid from r where k = p_k $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.seg(integer), pg_temp.hash(jsonb), pg_temp.approve(text, text, jsonb, integer, integer, bigint, integer, jsonb), pg_temp.cid(text) to anon, authenticated;

-- 20 clientes novas em A: 16 com consentimento de marketing, 2 sem, 1 com atendimento futuro, 1 arquivada.
insert into public.customers (id, tenant_id, name) select ('50000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, (select tenant_a from ids), 'Cliente ' || g from generate_series(1, 20) g;
insert into public.lifecycle_consents (tenant_id, customer_id, purpose) select (select tenant_a from ids), ('50000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'marketing' from generate_series(1, 18) g;
insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
values ((select tenant_a from ids), (select res_a from ids), '50000000-0000-4000-8000-000000000017', (select corte_a from ids), now() + interval '3 days', now() + interval '3 days 30 minutes',
  tstzrange(now() + interval '3 days', now() + interval '3 days 30 minutes', '[)'), true, 'confirmed', 6000, 'owner');
update public.customers set archived_at = now() where id = '50000000-0000-4000-8000-000000000018';

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'campaign%'), 'RLS ligada nas campanhas');
select ok(not has_table_privilege('authenticated', 'public.campaigns', 'insert'), 'dono não cria campanha direto');
select ok(not has_table_privilege('authenticated', 'public.campaign_members', 'insert'), 'dono não escolhe braço direto');
select ok(not has_function_privilege('authenticated', 'app.cp_tick(integer)', 'execute'), 'fechamento só do backend');
select is((select category from public.channel_templates where code = 'oferta_campanha'), 'marketing', 'modelo de oferta é marketing');

-- ------------------------------------------------------------------ público autorizado
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'prev', public.campaign_preview((select tenant_a from ids), pg_temp.seg(30));
select is((pg_temp.got('prev')->>'audience_count')::int, 16, 'público: só consentimento de marketing, sem atendimento futuro, sem arquivada (16 de 20)');
select ok(not (pg_temp.got('prev')->'customers')::text ~ 'Cliente 19|Cliente 20|Cliente 17|Cliente 18', 'sem consentimento, com atendimento futuro ou arquivada ficam de fora');
select throws_ok(format($$ select public.campaign_preview(%L, '{"kind":"inactive_days","days":3}') $$, (select tenant_a from ids)), 'PT400', 'VALIDATION_ERROR', 'janela mínima de 14 dias');
select throws_ok(format($$ select public.campaign_preview(%L, '{"kind":"vip"}') $$, (select tenant_a from ids)), 'PT400', 'VALIDATION_ERROR', 'segmento inventado é recusado');
select is((public.campaign_preview((select tenant_a from ids), '{"kind":"credit_remaining"}')->>'audience_count')::int, 0, 'segmento por crédito: ninguém tem saldo');

-- ------------------------------------------------------------------ aprovação: hash, limites e sorteio
select throws_ok(format($$ select public.campaign_approve(%L, 'X', %L, repeat('0', 64), 20, 50, null, 14, '{"kind":"none"}', 'idem-cp-stale-0000001', %L) $$,
  (select tenant_a from ids), pg_temp.seg(30), pg_temp.h('stale')), 'PT409', 'STALE_VERSION', 'público diferente do visto não aprova');
select throws_ok(format($$ select public.campaign_approve(%L, 'X', %L, %L, 20, 50, null, 14, '{"kind":"discount_pct","pct":90}', 'idem-cp-pct-000000001', %L) $$,
  (select tenant_a from ids), pg_temp.seg(30), pg_temp.hash(pg_temp.seg(30)), pg_temp.h('pct')), 'PT400', 'VALIDATION_ERROR', 'desconto fora de 5–50% é recusado');
select throws_ok(format($$ select public.campaign_approve(%L, 'X', %L, %L, 20, 50, null, 14, '{"kind":"pricing_rule","pricing_rule_id":"%s"}', 'idem-cp-rule-00000001', %L) $$,
  (select tenant_a from ids), pg_temp.seg(30), pg_temp.hash(pg_temp.seg(30)), gen_random_uuid(), pg_temp.h('rule')), 'PT404', 'NOT_FOUND', 'regra de preço inexistente não vincula');
-- Teto de gasto: 10% de R$ 60 = R$ 6 por tratado; teto R$ 30 → 5 tratados mesmo com 16 no público e 100 envios.
insert into r select 'cap', pg_temp.approve('idem-cp-cap-000000001', 'Teto de gasto', pg_temp.seg(30), 0, 100, 3000, 14,
  jsonb_build_object('kind', 'discount_pct', 'pct', 10, 'service_id', (select corte_a from ids)));
select is((pg_temp.got('cap')->'body'->'campaign'->>'treatment_count')::int, 5, 'teto de gasto limita os tratados no servidor');
select is((pg_temp.got('cap')->'body'->'campaign'->>'estimated_cost_cents')::int, 3000, 'custo estimado = 5 × R$ 6');
select is(pg_temp.got('cap')->'body'->'campaign'->>'offer_text', '10% de desconto em Corte', 'oferta vinculada ao serviço');
select is(pg_temp.got('cap')->'body'->'campaign'->'result'->>'design', 'observational', 'sem controle: desenho observacional');
select is(pg_temp.got('cap')->'body'->'campaign'->'result'->>'verdict', 'observation_only', 'sem controle: só observação, nunca efeito');
-- Quem entrou nessa campanha sai do público das próximas.
select is((pg_temp.hash(pg_temp.seg(30)) <> pg_temp.got('prev')->>'audience_hash'), true, 'público muda depois da aprovação (hash novo)');
select is((public.campaign_preview((select tenant_a from ids), pg_temp.seg(30))->>'audience_count')::int, 11, '5 tratadas saíram do público; controle vazio não bloqueia');
-- Cancelar a campanha de teto devolve as clientes ao público.
insert into r select 'cancel', public.campaign_cancel((select tenant_a from ids), pg_temp.cid('cap'), 1, 'idem-cp-cancel-000001', pg_temp.h('cancel'));
select is(pg_temp.got('cancel')->'body'->'campaign'->>'status', 'cancelled', 'campanha cancelada');
select is((select count(*)::int from public.lifecycle_steps s where s.rule = 'campaign' and s.status = 'cancelled' and s.skip_reason = 'campaign_cancelled'), 5, 'passos pendentes parados');
select throws_ok(format($$ select public.campaign_cancel(%L, %L, 1, 'idem-cp-cancel-000002', %L) $$, (select tenant_a from ids), pg_temp.cid('cap'), pg_temp.h('c2')), 'PT409', 'STALE_VERSION', 'versão antiga não cancela de novo');
select is((public.campaign_preview((select tenant_a from ids), pg_temp.seg(30))->>'audience_count')::int, 16, 'público volta a 16');

-- Campanha com controle de 50%: 8 controle, 8 tratadas; limite de envios 100.
insert into r select 'exp', pg_temp.approve('idem-cp-exp-000000001', 'Experimento', pg_temp.seg(30), 50, 100, null, 14, '{"kind":"none"}');
select is(pg_temp.got('exp')->'body'->'campaign'->>'control_count' || '/' || (pg_temp.got('exp')->'body'->'campaign'->>'treatment_count'), '8/8', 'controle sorteado = metade');
select is((select count(*)::int from public.campaign_members m where m.campaign_id = pg_temp.cid('exp') and m.arm = 'control' and m.step_id is null), 8, 'controle não recebe mensagem');
select is((select count(*)::int from public.campaign_members m join public.lifecycle_steps s on s.id = m.step_id where m.campaign_id = pg_temp.cid('exp') and s.rule = 'campaign'), 8, 'tratadas têm passo da régua');
select is(pg_temp.got('exp')->'body'->'campaign'->>'result' is not null and pg_temp.got('exp')->'body'->'campaign'->'result'->>'verdict' <> 'difference_detected', true, 'ainda sem conversões: nenhuma diferença detectada (nunca efeito presumido)');
-- Idempotência: mesma chave devolve a mesma campanha; público agora está em campanha em curso → vazio.
select is(pg_temp.approve('idem-cp-exp-000000001', 'Experimento', pg_temp.seg(30), 50, 100, null, 14, '{"kind":"none"}')->'body'->'campaign'->>'id', pg_temp.cid('exp')::text, 'repetir a chave devolve a mesma campanha');
select throws_ok(format($$ select public.campaign_approve(%L, 'Vazia', %L, %L, 20, 50, null, 14, '{"kind":"none"}', 'idem-cp-empty-0000001', %L) $$,
  (select tenant_a from ids), pg_temp.seg(30), pg_temp.hash(pg_temp.seg(30)), pg_temp.h('empty')), 'PT422', 'POLICY_REJECTED', 'quem está em campanha em curso não entra em outra: público vazio não aprova');

-- ------------------------------------------------------------------ envio pela régua (marketing) e medição
reset role;
insert into r select 'tick', public.jobs_run(100);
select is((pg_temp.got('tick')->'lifecycle'->>'manual')::int, 8, 'sem canal, os 8 passos viram "para compartilhar" (nada enviado por conta própria)');
update public.lifecycle_consents set revoked_at = now() where customer_id = (select m.customer_id from public.campaign_members m where m.campaign_id = pg_temp.cid('exp') and m.arm = 'treatment' limit 1);
select is((select count(*)::int from public.lifecycle_steps s where s.rule = 'campaign' and s.status = 'manual'), 8, 'revogar depois não apaga o passo manual já criado (o dono decide)');
-- Conversão medida: todas as 8 tratadas agendam na janela; nenhuma do controle.
insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
select (select tenant_a from ids), (select res_a from ids), m.customer_id, (select corte_a from ids), now() + (row_number() over ()) * interval '1 day' + interval '10 hours',
  now() + (row_number() over ()) * interval '1 day' + interval '10 hours 30 minutes',
  tstzrange(now() + (row_number() over ()) * interval '1 day' + interval '10 hours', now() + (row_number() over ()) * interval '1 day' + interval '10 hours 30 minutes', '[)'), true, 'confirmed', 6000, 'owner'
from public.campaign_members m where m.campaign_id = pg_temp.cid('exp') and m.arm = 'treatment';
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'get', public.campaign_get((select tenant_a from ids), pg_temp.cid('exp'));
select is(pg_temp.got('get')->'campaign'->'result'->'arms'->'treatment'->>'converted', '8', 'conversão medida nos agendamentos (tratadas 8/8)');
select is(pg_temp.got('get')->'campaign'->'result'->'arms'->'control'->>'converted', '0', 'controle 0/8');
select is(pg_temp.got('get')->'campaign'->'result'->>'verdict', 'difference_detected', 'intervalo da diferença exclui zero: diferença detectada');
select ok((pg_temp.got('get')->'campaign'->'result'->'difference'->'ci'->>0)::numeric > 0, 'limite inferior da diferença acima de zero');
select is((pg_temp.got('get')->'campaign'->'result'->>'final')::boolean, false, 'em curso: resultado parcial');
select is((select count(*) from jsonb_array_elements(pg_temp.got('get')->'members') x where (x->>'converted')::boolean), 8::bigint, 'participantes com conversão por braço');
select is(jsonb_array_length(public.campaign_list((select tenant_a from ids))->'campaigns'), 2, 'lista do dono: duas campanhas');

-- ------------------------------------------------------------------ fechamento pelo worker
reset role;
update public.campaigns set ends_at = clock_timestamp() - interval '1 minute' where id = pg_temp.cid('exp');
insert into r select 'close', public.jobs_run(100);
select is((pg_temp.got('close')->'campaigns'->>'closed')::int, 1, 'janela vencida: o worker fecha');
select is((select status || '/' || (result->>'final') from public.campaigns where id = pg_temp.cid('exp')), 'closed/true', 'resultado congelado');
select is((pg_temp.got('close')->'campaigns'->>'closed')::int + (public.jobs_run(100)->'campaigns'->>'closed')::int, 1, 'rodar de novo não fecha duas vezes');
select is((select count(*)::int from public.outbox_events where event_type = 'campaign.closed.v1'), 1, 'evento de fechamento');
select throws_ok(format($$ update public.campaign_members set arm = 'control' where campaign_id = %L $$, pg_temp.cid('exp')), 'PT403', 'FORBIDDEN', 'braço é append-only');

-- ------------------------------------------------------------------ isolamento e privacidade
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.campaign_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não vê as campanhas de A');
select throws_ok(format($$ select public.campaign_get(%L, %L) $$, (select tenant_a from ids), pg_temp.cid('exp')), 'PT403', 'FORBIDDEN', 'B não vê a campanha de A');
select is((select count(*) from public.campaigns where tenant_id = (select tenant_a from ids)), 0::bigint, 'RLS: B não lê campanhas de A');
reset role;
select is((select count(*) from public.audit_events where action like 'campaign.%' and coalesce(after::text, '') ~ 'Cliente'), 0::bigint, 'auditoria sem nomes');

select * from finish();
rollback;

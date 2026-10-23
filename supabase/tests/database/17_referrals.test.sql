-- P21 · Indicação de colegas: convite aceito vira adesão em avaliação; benefício só com uso real medido (clientes e
-- atendimentos concluídos); crédito de franquia do assistente só no mês; um benefício por negócio indicado
-- (duplicidade bloqueada: primeiro convite aceito vence); mesmo negócio bloqueado; janela vencida bloqueia; teto
-- mensal faz esperar; rodar de novo não concede duas vezes; painel do dono; isolamento; auditoria sem PII.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000b'::uuid as res_b,
  '40000000-0000-4000-8000-0000000000b1'::uuid as svc_b;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.act(p_ref uuid) returns text language sql as $$
  select a.status || '/' || coalesce(a.block_reason, '-') from public.referral_activations a where a.referral_id = p_ref $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.act(uuid) to anon, authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'referral_%'), 'RLS ligada nas indicações');
select ok(not has_table_privilege('authenticated', 'public.referral_activations', 'select'), 'avaliação fora da Data API (o painel expõe o necessário)');
select ok(not has_table_privilege('authenticated', 'public.referral_rewards', 'insert'), 'dono não cria benefício');
select ok(not has_function_privilege('authenticated', 'app.ref_tick(integer)', 'execute'), 'avaliação só do backend');
select is(app.ref_rules()->>'reward_questions', '50', 'benefício: 50 perguntas do assistente no mês');

-- ------------------------------------------------------------------ convite (P09) aceito pelo colega
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'inv', public.network_referral_create('professional_invites_peer', (select tenant_a from ids), 'Colega B', 'barber', 'web', 'idem-ref-create-000001', pg_temp.h('inv'));
reset role;
-- O token não fica no banco: o teste recupera o convite pelo id e simula o aceite pelo hash do próprio token devolvido.
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
insert into r select 'claim', public.network_referral_claim(pg_temp.got('inv')->>'token');
select is(pg_temp.got('claim')->>'state', 'claimed', 'colega aceitou o convite (P09)');
reset role;
select is((select claimed_tenant_id from public.referrals where id = (pg_temp.got('inv')->>'referral_id')::uuid), (select tenant_b from ids), 'atribuído ao negócio B');

-- ------------------------------------------------------------------ sem uso real: aguarda; com uso real: benefício
insert into r select 'tick1', public.jobs_run(100);
select is((pg_temp.got('tick1')->'referrals'->>'registered')::int, 1, 'o worker registra o convite aceito');
select is(pg_temp.act((pg_temp.got('inv')->>'referral_id')::uuid), 'awaiting_activity/-', 'sem uso real ainda: aguardando (nada concedido)');
select is((select count(*)::int from public.referral_rewards), 0, 'nenhum benefício por simples aceite');
-- B ganha 3 clientes e 2 atendimentos concluídos (medido, não declarado).
insert into public.customers (tenant_id, name) select (select tenant_b from ids), 'Cliente ' || g from generate_series(1, 3) g;
insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
select (select tenant_b from ids), (select res_b from ids), c.id, (select svc_b from ids), now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '60 minutes',
  tstzrange(now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '60 minutes', '[)'), true, 'completed', 10000, 'owner'
from generate_series(2, 3) g join lateral (select id from public.customers where tenant_id = (select tenant_b from ids) order by created_at desc limit 1) c on true;
insert into r select 'tick2', public.jobs_run(100);
select is((pg_temp.got('tick2')->'referrals'->>'rewarded')::int, 1, 'uso real atingido: benefício concedido');
select is(pg_temp.act((pg_temp.got('inv')->>'referral_id')::uuid), 'rewarded/-', 'adesão elegível e recompensada');
select is((select checks->>'customers' from public.referral_activations where referral_id = (pg_temp.got('inv')->>'referral_id')::uuid)::int >= 3, true, 'medição gravada (contagens, não nomes)');
select is((select amount from public.referral_rewards where referral_id = (pg_temp.got('inv')->>'referral_id')::uuid), 50, 'crédito de 50 perguntas');
select is((select bonus from public.agent_quotas where tenant_id = (select tenant_a from ids)), 50, 'bônus aplicado na franquia de A');
select is((select bonus_period_start from public.agent_quotas where tenant_id = (select tenant_a from ids)), date_trunc('month', now() at time zone 'UTC')::date, 'no mês corrente');
select is((select count(*)::int from public.outbox_events where event_type = 'referral.rewarded.v1'), 1, 'evento de benefício');
insert into r select 'tick3', public.jobs_run(100);
select is((pg_temp.got('tick3')->'referrals'->>'rewarded')::int, 0, 'rodar de novo não concede duas vezes');
select is((select count(*)::int from public.referral_rewards), 1, 'um benefício');

-- A franquia do assistente de A conta o bônus (limite 200 + 50) e o bônus de mês passado não conta.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'run', public.agent_run_start((select tenant_a from ids), 'idem-ref-agent-run-0001');
select is((pg_temp.got('run')->'quota'->>'limit')::int, 250, 'limite efetivo = plano + bônus do mês');
select is((pg_temp.got('run')->'quota'->>'bonus')::int, 50, 'bônus visível');
reset role;
update public.agent_quotas set bonus_period_start = bonus_period_start - interval '1 month' where tenant_id = (select tenant_a from ids);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'run2', public.agent_run_start((select tenant_a from ids), 'idem-ref-agent-run-0002');
select is((pg_temp.got('run2')->'quota'->>'limit')::int, 200, 'bônus de mês passado não vale');
reset role;
update public.agent_quotas set bonus_period_start = date_trunc('month', now() at time zone 'UTC')::date where tenant_id = (select tenant_a from ids);

-- ------------------------------------------------------------------ duplicidade: segundo convite aceito pelo MESMO negócio não rende
insert into public.referrals (kind, inviter_user_id, inviter_tenant_id, invitee_name, origin, token_hash, status, expires_at, claimed_by_user_id, claimed_tenant_id, claimed_at, idem_key, request_hash)
values ('professional_invites_peer', (select owner_a from ids), (select tenant_a from ids), 'Colega B de novo', 'web', pg_temp.h('dup'), 'claimed', now() + interval '30 days',
  (select owner_b from ids), (select tenant_b from ids), now(), 'idem-ref-dup-000000001', pg_temp.h('dup-req'));
insert into r select 'tick4', public.jobs_run(100);
select is((pg_temp.got('tick4')->'referrals'->>'blocked')::int, 1, 'duplicidade bloqueada');
select is((select a.status || '/' || a.block_reason from public.referral_activations a join public.referrals x on x.id = a.referral_id where x.invitee_name = 'Colega B de novo'),
  'blocked/duplicate', 'com o motivo');
select is((select count(*)::int from public.referral_rewards), 1, 'continua um benefício');

-- ------------------------------------------------------------------ mesmo negócio e janela vencida
insert into public.referrals (kind, inviter_user_id, inviter_tenant_id, invitee_name, origin, token_hash, status, expires_at, claimed_by_user_id, claimed_tenant_id, claimed_at, idem_key, request_hash)
values ('professional_invites_peer', (select owner_b from ids), (select tenant_b from ids), 'Eu mesmo', 'web', pg_temp.h('self'), 'claimed', now() + interval '30 days',
  (select owner_a from ids), (select tenant_b from ids), now(), 'idem-ref-self-00000001', pg_temp.h('self-req'));
insert into public.referrals (kind, inviter_user_id, inviter_tenant_id, invitee_name, origin, token_hash, status, expires_at, claimed_by_user_id, claimed_tenant_id, claimed_at, idem_key, request_hash)
values ('professional_invites_peer', (select owner_b from ids), (select tenant_b from ids), 'Negócio A antigo', 'web', pg_temp.h('old'), 'claimed', now() + interval '30 days',
  (select owner_a from ids), (select tenant_a from ids), now() - interval '61 days', 'idem-ref-old-000000001', pg_temp.h('old-req'));
insert into r select 'tick5', public.jobs_run(100);
select is((select a.status || '/' || a.block_reason from public.referral_activations a join public.referrals x on x.id = a.referral_id where x.invitee_name = 'Eu mesmo'),
  'blocked/same_tenant', 'convite aceito pelo mesmo negócio que convidou: bloqueado');
select is((select a.status || '/' || a.block_reason from public.referral_activations a join public.referrals x on x.id = a.referral_id where x.invitee_name = 'Negócio A antigo'),
  'blocked/window_expired', 'janela de 60 dias vencida sem uso real: bloqueado');
select is((select count(*)::int from public.referral_rewards), 1, 'nenhum benefício novo');

-- ------------------------------------------------------------------ teto mensal: elegível espera
-- Dez negócios indicados por B já recompensados neste mês (um benefício por negócio indicado).
with tn as (
  insert into public.tenants (id, name, profession, timezone)
  select ('30000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'Lote ' || g, 'barber', 'America/Sao_Paulo' from generate_series(1, 10) g returning id
), lote as (
  insert into public.referrals (kind, inviter_user_id, inviter_tenant_id, invitee_name, origin, token_hash, status, expires_at, claimed_by_user_id, claimed_tenant_id, claimed_at, idem_key, request_hash)
  select 'professional_invites_peer', (select owner_b from ids), (select tenant_b from ids), 'Lote', 'web', pg_temp.h('lote' || tn.id::text), 'claimed', now() + interval '30 days',
    (select owner_a from ids), tn.id, now(), 'idem-ref-lote-' || tn.id::text, pg_temp.h('lote-req' || tn.id::text)
  from tn returning id, claimed_tenant_id
), act as (
  insert into public.referral_activations (referral_id, inviter_tenant_id, invitee_tenant_id, status, claimed_at, rewarded_at)
  select id, (select tenant_b from ids), claimed_tenant_id, 'rewarded', now(), now() from lote
)
insert into public.referral_rewards (tenant_id, referral_id, amount, period_start)
select (select tenant_b from ids), id, 50, date_trunc('month', now() at time zone 'UTC')::date from lote;
-- Um convite de B aceito por um negócio novo com uso real: elegível, mas B já concedeu 10 este mês → espera.
insert into public.tenants (id, name, profession, timezone) values ('10000000-0000-4000-8000-00000000000c', 'Negócio C (exemplo)', 'barber', 'America/Sao_Paulo');
insert into public.customers (tenant_id, name) select '10000000-0000-4000-8000-00000000000c', 'C' || g from generate_series(1, 3) g;
insert into public.resources (tenant_id, name) values ('10000000-0000-4000-8000-00000000000c', 'Cadeira');
insert into public.provider_services (tenant_id, name, duration_min, base_price_cents, min_price_cents) values ('10000000-0000-4000-8000-00000000000c', 'Corte', 30, 5000, 4000);
insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
select '10000000-0000-4000-8000-00000000000c', (select id from public.resources where tenant_id = '10000000-0000-4000-8000-00000000000c'),
  (select id from public.customers where tenant_id = '10000000-0000-4000-8000-00000000000c' limit 1), (select id from public.provider_services where tenant_id = '10000000-0000-4000-8000-00000000000c'),
  now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '30 minutes', tstzrange(now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '30 minutes', '[)'), true, 'completed', 5000, 'owner'
from generate_series(2, 3) g;
insert into public.referrals (kind, inviter_user_id, inviter_tenant_id, invitee_name, origin, token_hash, status, expires_at, claimed_by_user_id, claimed_tenant_id, claimed_at, idem_key, request_hash)
values ('professional_invites_peer', (select owner_b from ids), (select tenant_b from ids), 'Negócio C', 'web', pg_temp.h('c'), 'claimed', now() + interval '30 days',
  (select owner_a from ids), '10000000-0000-4000-8000-00000000000c', now(), 'idem-ref-c-0000000001', pg_temp.h('c-req'));
insert into r select 'tick6', public.jobs_run(100);
select is((pg_temp.got('tick6')->'referrals'->>'capped')::int, 1, 'teto mensal de B atingido: elegível espera');
select is((select a.status from public.referral_activations a join public.referrals x on x.id = a.referral_id where x.invitee_name = 'Negócio C'), 'eligible', 'elegível registrada, benefício pendente');
select is((select count(*)::int from public.referral_rewards where tenant_id = (select tenant_b from ids)), 10, 'B continua com 10 no mês');

-- ------------------------------------------------------------------ painel do dono
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'dash', public.referral_dashboard((select tenant_a from ids));
select is((pg_temp.got('dash')->'summary'->>'rewarded')::int, 1, 'painel de A: um benefício');
select is((pg_temp.got('dash')->'summary'->>'bonus_this_month')::int, 50, 'bônus do mês');
select is((pg_temp.got('dash')->'summary'->>'claimed')::int, 2, 'dois convites aceitos (um bloqueado por duplicidade)');
select is((select x->'activation'->>'status' from jsonb_array_elements(pg_temp.got('dash')->'invites') x where x->>'invitee_name' = 'Colega B'), 'rewarded', 'convite com adesão recompensada');
select is((select x->'activation'->>'block_reason' from jsonb_array_elements(pg_temp.got('dash')->'invites') x where x->>'invitee_name' = 'Colega B de novo'), 'duplicate', 'convite duplicado com o motivo');
select ok(pg_temp.got('dash')->'rules' ? 'min_customers', 'regras do programa expostas');
select is(jsonb_array_length(public.referral_rewards_list((select tenant_a from ids))->'rewards'), 1, 'lista de benefícios');
select ok(not (pg_temp.got('dash')::text ~ 'Cliente 1'), 'painel não expõe nomes de clientes do negócio indicado');

-- ------------------------------------------------------------------ isolamento e privacidade
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.referral_dashboard(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não vê o painel de A');
select is((select count(*) from public.referral_rewards where tenant_id = (select tenant_a from ids)), 0::bigint, 'RLS: B não vê benefícios de A');
reset role;
select is((select count(*) from public.audit_events where action = 'referral.reward' and coalesce(after::text, '') ~ 'Colega|Cliente'), 0::bigint, 'auditoria sem nomes');

select * from finish();
rollback;

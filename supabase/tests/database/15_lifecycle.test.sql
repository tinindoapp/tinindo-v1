-- P13 · Relacionamento: réguas sobre o outbox (confirmação e lembretes; remarcação troca os passos; cancelamento
-- para), follow-up de orçamento sem decisão (para no aceite), lembrete de cobrança vencida (para no pagamento),
-- dedupe de evento e de passo, consentimento por finalidade, opt-out para tudo, teto diário adia, sem canal vira
-- manual, reativação só como campanha aprovada com público visto e teto, indicador de lembretes do P18, isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000a2'::uuid as barba_a,
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
create function pg_temp.bid(p_k text) returns uuid language sql as $$ select (v->'body'->'booking'->>'id')::uuid from r where k = p_k $$;
/** Segunda da próxima semana + p_days às p_hhmm, São Paulo. */
create function pg_temp.at(p_days integer, p_hhmm text) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + p_days) + p_hhmm::time) at time zone 'America/Sao_Paulo'
$$;
create function pg_temp.corte(p_key text, p_days integer, p_hhmm text, p_cust uuid) returns jsonb language sql as $$
  select public.scheduling_booking_create((select tenant_a from ids), (select res_a from ids), (select corte_a from ids), p_cust, null,
    pg_temp.at(p_days, p_hhmm), pg_temp.at(p_days, p_hhmm) + interval '30 minutes', null, 'confirm', p_key, pg_temp.h(p_key))
$$;
create function pg_temp.steps(p_agg uuid) returns text language sql as $$
  select coalesce(string_agg(s.rule || ':' || s.step_key || '=' || s.status, ',' order by s.due_at, s.step_key), '') from public.lifecycle_steps s where s.aggregate_id = p_agg
$$;
create function pg_temp.items() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('service_id', (select corte_a from ids), 'description', 'Corte', 'quantity', 1, 'unit_price_cents', 6000))
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.bid(text), pg_temp.at(integer, text), pg_temp.corte(text, integer, text, uuid),
  pg_temp.steps(uuid), pg_temp.items() to anon, authenticated;

-- Expediente e telefones (Ana tem telefone; Carlos não).
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select (select tenant_a from ids), (select res_a from ids), d, '08:00', '20:00' from generate_series(1, 5) d;
update public.customers set phone = '+5511988887777' where id = (select ana from ids);
update public.customers set phone = null where id = (select carlos from ids);

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'lifecycle_%'), 'RLS ligada no relacionamento');
select ok(not has_table_privilege('authenticated', 'public.lifecycle_processed_events', 'select'), 'dedupe de eventos fora da Data API');
select ok(not has_table_privilege('authenticated', 'public.lifecycle_steps', 'insert'), 'dono não cria passo direto');
select ok(not has_function_privilege('authenticated', 'app.lc_tick(integer)', 'execute'), 'rodada da régua só do backend');
select is((select count(*)::int from public.channel_templates where code in ('lembrete_orcamento', 'lembrete_cobranca', 'reativacao')), 3, 'três modelos novos');

-- ------------------------------------------------------------------ confirmação e lembretes pelo outbox
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cfg', public.lifecycle_settings_get((select tenant_a from ids));
select is(pg_temp.got('cfg')->'settings'->'reminder_hours', '[24, 2]'::jsonb, 'padrão: lembretes 24 h e 2 h antes');
select is((pg_temp.got('cfg')->'settings'->>'version')::int, 0, 'ainda sem configuração salva');
insert into r select 'b1', pg_temp.corte('idem-lc-b1-000000001', 2, '10:00', (select ana from ids));
reset role;
insert into r select 'run1', public.jobs_run(100);
select ok((pg_temp.got('run1')->'lifecycle') is not null, 'o worker roda a régua a cada rodada');
select is(pg_temp.steps(pg_temp.bid('b1')), 'confirmation:v1=manual,reminder:v1-h24=scheduled,reminder:v1-h2=scheduled',
  'confirmação sai agora (sem canal: manual) e dois lembretes ficam agendados');
select is((select due_at from public.lifecycle_steps where aggregate_id = pg_temp.bid('b1') and step_key = 'v1-h24'), pg_temp.at(2, '10:00') - interval '24 hours',
  'lembrete de 24 h no horário certo');
select ok((select body from public.lifecycle_steps where aggregate_id = pg_temp.bid('b1') and rule = 'confirmation') ~ 'Seu horário de Corte está confirmado para',
  'texto renderizado com serviço e horário');
-- Reprocessar o mesmo evento não duplica (consumidor idempotente).
update public.outbox_events set status = 'pending', next_run_at = now() - interval '1 second'
where aggregate_id = pg_temp.bid('b1') and event_type = 'booking.confirmed.v1';
insert into r select 'run1b', public.jobs_run(100);
select is((select count(*)::int from public.lifecycle_steps where aggregate_id = pg_temp.bid('b1')), 3, 'evento reprocessado não cria passos de novo');

-- Remarcação: passos antigos cancelados, novos criados para a nova versão.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'b1r', public.scheduling_booking_reschedule((select tenant_a from ids), pg_temp.bid('b1'),
  (pg_temp.got('b1')->'body'->'booking'->>'version')::int, pg_temp.at(3, '11:00'), pg_temp.at(3, '11:30'), null, 'idem-lc-b1-resched-001', pg_temp.h('b1r'));
reset role;
insert into r select 'run2', public.jobs_run(100);
select is((select count(*)::int from public.lifecycle_steps where aggregate_id = pg_temp.bid('b1') and status = 'cancelled' and skip_reason = 'rescheduled'), 3,
  'remarcação cancela os passos da versão antiga (inclusive a confirmação manual não compartilhada)');
select is((select count(*)::int from public.lifecycle_steps where aggregate_id = pg_temp.bid('b1') and status in ('manual', 'scheduled')), 3,
  'e cria os passos da nova versão');
select is((select due_at from public.lifecycle_steps where aggregate_id = pg_temp.bid('b1') and rule = 'reminder' and status = 'scheduled' order by due_at limit 1),
  pg_temp.at(3, '11:00') - interval '24 hours', 'lembrete recalculado para o novo horário');

-- Cancelamento para a régua.
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'b1c', public.scheduling_booking_cancel((select tenant_a from ids), pg_temp.bid('b1'),
  (pg_temp.got('b1r')->'body'->'booking'->>'version')::int, 'cliente desmarcou', 'idem-lc-b1-cancel-0001', pg_temp.h('b1c'));
reset role;
insert into r select 'run3', public.jobs_run(100);
select is((select count(*)::int from public.lifecycle_steps where aggregate_id = pg_temp.bid('b1') and status in ('manual', 'scheduled', 'deferred')), 0,
  'cancelar o atendimento para tudo que estava pendente');

-- ------------------------------------------------------------------ canal conectado: enviado ao canal, teto diário, opt-out
insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
values ((select tenant_a from ids), 'simulated', '+5511999990001', '+5511999990001', 'active', now());
insert into public.channel_contacts (tenant_id, connection_id, phone_e164, customer_id, opt_in_at, opt_in_source, last_inbound_at)
select (select tenant_a from ids), c.id, '+5511988887777', (select ana from ids), now(), 'inbound', now() from public.channel_connections c where c.tenant_id = (select tenant_a from ids);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'b2', pg_temp.corte('idem-lc-b2-000000001', 4, '09:00', (select ana from ids));
reset role;
insert into r select 'run4', public.jobs_run(100);
select is((select status from public.lifecycle_steps where aggregate_id = pg_temp.bid('b2') and rule = 'confirmation'), 'sent', 'com canal: confirmação enviada ao canal');
select is((select m.status from public.channel_messages m join public.lifecycle_steps s on s.channel_message_id = m.id where s.aggregate_id = pg_temp.bid('b2')),
  'queued', 'a mensagem entra na fila do P12 (enviado ao canal não é entregue)');
select is((select m.template_code from public.channel_messages m join public.lifecycle_steps s on s.channel_message_id = m.id where s.aggregate_id = pg_temp.bid('b2')),
  'confirmacao_agendamento', 'como modelo aprovado');
-- Teto diário: com orçamento 1 e um envio feito hoje, o próximo passo vencido é adiado para amanhã (não descartado).
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cfg2', public.lifecycle_settings_save((select tenant_a from ids), '{"daily_budget": 1}', 0, 'idem-lc-cfg-00000001', pg_temp.h('cfg2'));
select is((pg_temp.got('cfg2')->'body'->'settings'->>'daily_budget')::int, 1, 'teto salvo');
select throws_ok(format($$ select public.lifecycle_settings_save(%L, '{"daily_budget": 5}', 0, 'idem-lc-cfg-00000002', %L) $$, (select tenant_a from ids), pg_temp.h('x')),
  'PT409', 'STALE_VERSION', 'salvar exige a versão vista');
select throws_ok(format($$ select public.lifecycle_settings_save(%L, '{"reminder_hours": [5]}', 1, 'idem-lc-cfg-00000003', %L) $$, (select tenant_a from ids), pg_temp.h('y')),
  'PT400', 'VALIDATION_ERROR', 'hora de lembrete fora da lista é recusada');
insert into r select 'b3', pg_temp.corte('idem-lc-b3-000000001', 4, '15:00', (select ana from ids));
reset role;
insert into r select 'run5', public.jobs_run(100);
select is((select status from public.lifecycle_steps where aggregate_id = pg_temp.bid('b3') and rule = 'confirmation'), 'deferred', 'teto atingido: adiado');
select is((select skip_reason from public.lifecycle_steps where aggregate_id = pg_temp.bid('b3') and rule = 'confirmation'), 'daily_budget', 'com o motivo');
select ok((select due_at from public.lifecycle_steps where aggregate_id = pg_temp.bid('b3') and rule = 'confirmation') > now(), 'para amanhã');
-- Opt-out da cliente pelo canal cancela tudo que estava pendente para ela.
select public.channel_webhook_ingest('simulated', jsonb_build_array(jsonb_build_object('external_event_id', 'lc-evt-sair', 'kind', 'inbound',
  'external_account_id', '+5511999990001', 'phone_e164', '+5511988887777', 'text', 'SAIR')));
insert into r select 'run6', public.jobs_run(100);
select is((select count(*)::int from public.lifecycle_steps where customer_id = (select ana from ids) and status in ('scheduled', 'deferred', 'manual')), 0,
  'SAIR cancela todos os passos pendentes da cliente');
select is((select count(*)::int from public.lifecycle_steps where customer_id = (select ana from ids) and skip_reason = 'opted_out'), 5,
  'com o motivo opted_out (lembretes de b2, confirmação adiada e lembretes de b3)');
select is((select status from public.lifecycle_steps where aggregate_id = pg_temp.bid('b2') and rule = 'confirmation'), 'sent', 'o que já saiu não muda');

-- ------------------------------------------------------------------ oposição registrada pelo dono: pulado; consentimento de volta
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cs0', public.lifecycle_consent_set((select tenant_a from ids), (select carlos from ids), 'transactional', true, 'idem-lc-consent-00000', pg_temp.h('cs0'));
insert into r select 'cs1', public.lifecycle_consent_set((select tenant_a from ids), (select carlos from ids), 'transactional', false, 'idem-lc-consent-00001', pg_temp.h('cs1'));
select is((pg_temp.got('cs1')->'body'->>'granted')::boolean, false, 'Carlos pediu ao dono para não receber avisos (revogado)');
insert into r select 'b4', pg_temp.corte('idem-lc-b4-000000001', 4, '16:00', (select carlos from ids));
reset role;
insert into r select 'run7', public.jobs_run(100);
select is((select status || '/' || coalesce(skip_reason, '') from public.lifecycle_steps where aggregate_id = pg_temp.bid('b4') and rule = 'confirmation'),
  'skipped/consent_revoked', 'oposição registrada: pulado com motivo');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cs', public.lifecycle_consent_set((select tenant_a from ids), (select carlos from ids), 'transactional', true, 'idem-lc-consent-00002', pg_temp.h('cs'));
select is((pg_temp.got('cs')->'body'->>'granted')::boolean, true, 'consentimento transacional registrado de novo pelo dono');
reset role;
update public.lifecycle_steps set due_at = now() - interval '1 minute' where aggregate_id = pg_temp.bid('b4') and rule = 'reminder' and step_key like '%-h24';
insert into r select 'run8', public.jobs_run(100);
select is((select status from public.lifecycle_steps where aggregate_id = pg_temp.bid('b4') and step_key like '%-h24'), 'manual',
  'com consentimento e sem canal (sem telefone): manual para o dono compartilhar');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'sh', public.lifecycle_step_mark_shared((select tenant_a from ids), (select id from public.lifecycle_steps where aggregate_id = pg_temp.bid('b4') and step_key like '%-h24'),
  'idem-lc-shared-000001', pg_temp.h('sh'));
select is(pg_temp.got('sh')->'body'->'step'->>'status', 'shared', 'dono marcou como compartilhado');
select throws_ok(format($$ select public.lifecycle_step_mark_shared(%L, %L, 'idem-lc-shared-000002', %L) $$, (select tenant_a from ids),
  (select id from public.lifecycle_steps where aggregate_id = pg_temp.bid('b4') and step_key like '%-h24'), pg_temp.h('sh2')), 'PT422', 'POLICY_REJECTED',
  'compartilhar de novo não é permitido');
insert into r select 'lst', public.lifecycle_steps_list((select tenant_a from ids), null);
select ok((pg_temp.got('lst')->'counts'->>'cancelled')::int >= 6, 'lista traz contagem por estado');
select ok(pg_temp.got('lst')->'steps'->0 ? 'customer_name', 'passo traz o nome da cliente');

-- ------------------------------------------------------------------ orçamento sem decisão → follow-up; aceite para
insert into r select 'q1', public.sales_quote_create((select tenant_a from ids), (select carlos from ids), 'Corte', pg_temp.items(), now() + interval '10 days',
  null, null, null, 'idem-lc-quote-000001', pg_temp.h('q1'));
insert into r select 'q1s', public.sales_quote_send((select tenant_a from ids), (pg_temp.got('q1')->'body'->'quote'->>'id')::uuid, 1, 'idem-lc-qsend-00001', pg_temp.h('q1s'));
reset role;
insert into r select 'run9', public.jobs_run(100);
select is((select count(*)::int from public.lifecycle_steps where rule = 'quote_followup'), 0, 'orçamento recém-enviado: ainda sem follow-up');
update public.sales_quotes set sent_at = now() - interval '3 days' where id = (pg_temp.got('q1')->'body'->'quote'->>'id')::uuid;
insert into r select 'run10', public.jobs_run(100);
select is((select status from public.lifecycle_steps where rule = 'quote_followup' and aggregate_id = (pg_temp.got('q1')->'body'->'quote'->>'id')::uuid), 'manual',
  'depois de 2 dias sem decisão: follow-up (manual, Carlos sem canal)');
select ok((select body from public.lifecycle_steps where rule = 'quote_followup') ~ 'R\$ 60,00', 'texto com o valor do orçamento');
insert into r select 'run11', public.jobs_run(100);
select is((select count(*)::int from public.lifecycle_steps where rule = 'quote_followup'), 1, 'rodada seguinte não duplica o follow-up');
-- Aceite pelo link para a régua (o passo manual não compartilhado é cancelado).
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
reset role;
set local role anon;
insert into r select 'q1v', public.sales_quote_view(pg_temp.got('q1s')->'body'->>'token');
select public.sales_quote_accept(pg_temp.got('q1s')->'body'->>'token', (pg_temp.got('q1v')->>'version_no')::int, pg_temp.got('q1v')->>'snapshot_hash');
reset role;
insert into r select 'run12', public.jobs_run(100);
select is((select status || '/' || skip_reason from public.lifecycle_steps where rule = 'quote_followup'), 'cancelled/accepted', 'aceite para o follow-up');

-- ------------------------------------------------------------------ cobrança vencida → lembrete; pagamento para
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rc', public.finance_receivable_create((select tenant_a from ids), (select carlos from ids), 'Produto', 2500, now() - interval '2 days', 'idem-lc-rec-0000001', pg_temp.h('rc'));
reset role;
insert into r select 'run13', public.jobs_run(100);
select is((select status from public.lifecycle_steps where rule = 'receivable_reminder'), 'manual', 'recebível vencido há mais de 1 dia: lembrete de cobrança');
select ok((select body from public.lifecycle_steps where rule = 'receivable_reminder') ~ 'R\$ 25,00 \(Produto\)', 'texto com valor e descrição');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select public.finance_record_payment((select tenant_a from ids), (pg_temp.got('rc')->'body'->'receivable'->>'id')::uuid, 2500, 'cash', now(), 'idem-lc-pay-0000001', pg_temp.h('pay'));
reset role;
insert into r select 'run14', public.jobs_run(100);
select is((select status || '/' || skip_reason from public.lifecycle_steps where rule = 'receivable_reminder'), 'cancelled/paid', 'pagamento para o lembrete de cobrança');

-- ------------------------------------------------------------------ reativação: só campanha aprovada com público visto
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'aud0', public.lifecycle_audience_preview((select tenant_a from ids));
select is(jsonb_array_length(pg_temp.got('aud0')->'customers'), 0, 'sem consentimento de marketing, ninguém é elegível');
insert into r select 'cm', public.lifecycle_consent_set((select tenant_a from ids), (select carlos from ids), 'marketing', true, 'idem-lc-consent-00003', pg_temp.h('cm'));
insert into r select 'aud1', public.lifecycle_audience_preview((select tenant_a from ids));
select is(jsonb_array_length(pg_temp.got('aud1')->'customers'), 0, 'Carlos tem atendimento futuro confirmado: ainda não é público de reativação');
reset role;
update public.bookings set status = 'completed', blocks_capacity = true, starts_at = now() - interval '90 days', ends_at = now() - interval '90 days' + interval '30 minutes',
  occupied_range = tstzrange(now() - interval '90 days', now() - interval '90 days' + interval '40 minutes', '[)')
where id = pg_temp.bid('b4');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'aud2', public.lifecycle_audience_preview((select tenant_a from ids));
select is(pg_temp.got('aud2')->'customers'->0->>'customer_id', (select carlos from ids)::text, 'sem visita há 90 dias e com consentimento: elegível');
select throws_ok(format($$ select public.lifecycle_campaign_approve(%L, %L, 10, 'idem-lc-camp-0000000', %L) $$, (select tenant_a from ids), repeat('0', 64), pg_temp.h('c0')),
  'PT409', 'STALE_VERSION', 'aprovar outro público do que foi visto é recusado');
insert into r select 'camp', public.lifecycle_campaign_approve((select tenant_a from ids), pg_temp.got('aud2')->>'audience_hash', 10, 'idem-lc-camp-0000001', pg_temp.h('camp'));
select is((pg_temp.got('camp')->'body'->'campaign'->>'scheduled')::int, 1, 'campanha aprovada agenda um passo por cliente do público');
select is(public.lifecycle_campaign_approve((select tenant_a from ids), pg_temp.got('aud2')->>'audience_hash', 10, 'idem-lc-camp-0000001', pg_temp.h('camp')),
  pg_temp.got('camp'), 'repetir a aprovação devolve a mesma campanha');
insert into r select 'aud3', public.lifecycle_audience_preview((select tenant_a from ids));
select is(jsonb_array_length(pg_temp.got('aud3')->'customers'), 0, 'quem já recebeu reativação sai do público por 90 dias');
reset role;
insert into r select 'run15', public.jobs_run(100);
select is((select status from public.lifecycle_steps where rule = 'reactivation'), 'manual', 'reativação despachada (manual: Carlos sem canal)');
select ok((select body from public.lifecycle_steps where rule = 'reactivation') ~ 'Responda SAIR', 'texto de marketing traz a saída');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(jsonb_array_length(public.lifecycle_campaign_list((select tenant_a from ids))->'campaigns'), 1, 'campanha listada');
-- Revogar marketing cancela reativação pendente.
insert into r select 'cm2', public.lifecycle_consent_set((select tenant_a from ids), (select carlos from ids), 'marketing', false, 'idem-lc-consent-00004', pg_temp.h('cm2'));
select is((select status || '/' || skip_reason from public.lifecycle_steps where rule = 'reactivation'), 'cancelled/consent_revoked', 'revogar consentimento cancela a reativação pendente');

-- ------------------------------------------------------------------ P18: indicador de lembretes medido
insert into r select 'an', public.analytics_metrics((select tenant_a from ids), now() - interval '100 days', pg_temp.at(7, '00:00'), null);
select is((select x->>'status' from jsonb_array_elements(pg_temp.got('an')->'metrics') x where x->>'key' = 'reminders'), 'ok', 'indicador de lembretes agora é medido');
select is((select (x->>'numerator')::int || '/' || (x->>'denominator')::int from jsonb_array_elements(pg_temp.got('an')->'metrics') x where x->>'key' = 'reminders'), '1/3',
  'um atendimento com lembrete compartilhado (b4) sobre três com cliente (b2, b3, b4; b1 cancelado fica fora)');

-- ------------------------------------------------------------------ isolamento e privacidade
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.lifecycle_steps_list(%L, null) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não vê a régua de A');
select throws_ok(format($$ select public.lifecycle_consent_set(%L, %L, 'marketing', true, 'idem-lc-consent-b-001', %L) $$, (select tenant_a from ids), (select ana from ids), pg_temp.h('b')),
  'PT403', 'FORBIDDEN', 'B não registra consentimento em A');
select is((select count(*) from public.lifecycle_steps), 0::bigint, 'RLS: B não vê passos de A');
reset role;
select is((select count(*) from public.audit_events where action like 'lifecycle.%' and coalesce(after::text, '') ~ '5511|Carlos|Seu horário'), 0::bigint,
  'auditoria sem telefone, nome ou texto');

select * from finish();
rollback;

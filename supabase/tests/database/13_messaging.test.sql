-- P12 · Canal oficial: número verificado por código enviado pelo canal (hash no banco, código só para o despacho),
-- um número por negócio, webhook deduplicado e sem efeito fora da conta, contato vinculado ao cliente do MESMO
-- negócio, janela de 24 h para texto livre, modelo só aprovado e com opt-in, opt-out pelo cliente, estados de
-- entrega que só avançam, resultado desconhecido sem reenvio, transferência para humano, isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.ev(p_id text, p_kind text, p_acc text, p_phone text, p_text text, p_pmid text, p_status text) returns jsonb
language sql as $$ select jsonb_build_array(jsonb_build_object('external_event_id', p_id, 'kind', p_kind, 'external_account_id', p_acc,
  'phone_e164', p_phone, 'text', p_text, 'provider_message_id', p_pmid, 'status', p_status, 'profile_name', 'Ana')) $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.ev(text, text, text, text, text, text, text) to anon, authenticated;

-- Cliente Ana com telefone, para o vínculo automático por telefone.
update public.customers set phone = '+5511988887777' where id = (select ana from ids);

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'channel_%'), 'RLS ligada no canal');
select ok(not has_table_privilege('authenticated', 'public.channel_verifications', 'select'), 'código de verificação fora da Data API');
select ok(not has_table_privilege('authenticated', 'public.channel_webhook_events', 'select'), 'eventos de webhook fora da Data API');
select ok(not has_function_privilege('authenticated', 'public.channel_webhook_ingest(text, jsonb)', 'execute'), 'ingestão só do backend');
select ok(not has_function_privilege('authenticated', 'public.channel_dispatch_claim(integer)', 'execute'), 'despacho só do backend');
select ok(not has_table_privilege('authenticated', 'public.channel_messages', 'insert'), 'dono não grava mensagem direto');

-- ------------------------------------------------------------------ conexão e verificação
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'c1', public.channel_connect((select tenant_a from ids), 'simulated', '+5511999990001', null, 'idem-ch-connect-a-01', pg_temp.h('c1'));
select is(pg_temp.got('c1')->'body'->'connection'->>'status', 'pending_verification', 'número registrado, pendente');
select is(public.channel_connect((select tenant_a from ids), 'simulated', '+5511999990001', null, 'idem-ch-connect-a-01', pg_temp.h('c1')),
  pg_temp.got('c1'), 'repetição devolve a mesma conexão');
select throws_ok(format($$ select public.channel_connect(%L, 'simulated', '+5511999990002', null, 'idem-ch-connect-a-02', %L) $$,
  (select tenant_a from ids), pg_temp.h('c2')), 'PT422', 'POLICY_REJECTED', 'um número por negócio (já há conexão viva)');
select throws_ok(format($$ select public.channel_send(%L, gen_random_uuid(), 'text', 'oi', null, null, 'idem-ch-send-early-1', %L) $$,
  (select tenant_a from ids), pg_temp.h('se')), 'PT422', 'POLICY_REJECTED', 'sem conexão ativa não envia');
insert into r select 'vw', public.channel_verify((select tenant_a from ids), '000000', 'idem-ch-verify-wrong1', pg_temp.h('vw'));
select is(pg_temp.got('vw')->>'status_code', '422', 'código errado é recusado (envelope 422, sem desfazer a contagem)');
select is(pg_temp.got('vw')->>'error', 'POLICY_REJECTED', 'com o código do catálogo');
reset role;
select is((select attempts from public.channel_verifications v where v.tenant_id = (select tenant_a from ids)), 1, 'tentativa errada contada');
-- O despacho (backend) pega a verificação e "envia" o código pelo canal.
insert into r select 'claim1', public.channel_dispatch_claim(50);
select is(jsonb_array_length(pg_temp.got('claim1')->'items'), 1, 'verificação entra na fila do despacho');
select is(pg_temp.got('claim1')->'items'->0->>'template_code', 'verificacao_numero', 'modelo de verificação');
select ok(pg_temp.got('claim1')->'items'->0->>'body' ~ 'código para conectar o número à Tinindo é [0-9]{6}', 'texto renderizado com o código');
select is(pg_temp.got('claim1')->'items'->0->>'to', '+5511999990001', 'vai para o número do negócio');
create temp table code as select (regexp_match(pg_temp.got('claim1')->'items'->0->>'body', '([0-9]{6})'))[1] as v;
grant select on code to authenticated;
select public.channel_dispatch_result(pg_temp.got('claim1')->'items'->0->>'ref', 'sent', 'sim-ver-1', null);
set local role authenticated;
insert into r select 'v1', public.channel_verify((select tenant_a from ids), (select v from code), 'idem-ch-verify-ok-01', pg_temp.h('v1'));
select is(pg_temp.got('v1')->'body'->'connection'->>'status', 'active', 'código certo ativa a conexão');
select throws_ok(format($$ select public.channel_verify(%L, %L, 'idem-ch-verify-again', %L) $$, (select tenant_a from ids), (select v from code), pg_temp.h('va')),
  'PT422', 'POLICY_REJECTED', 'código é de uso único');
-- O mesmo número não serve a outro negócio.
select pg_temp.login_as((select owner_b from ids));
select throws_ok(format($$ select public.channel_connect(%L, 'simulated', '+5511999990001', null, 'idem-ch-connect-b-01', %L) $$,
  (select tenant_b from ids), pg_temp.h('cb')), 'PT422', 'POLICY_REJECTED', 'número já é de outro negócio');
select is(public.channel_status((select tenant_b from ids))->'connection', 'null'::jsonb, 'B sem conexão');
select throws_ok(format($$ select public.channel_status(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não lê o canal de A');

-- ------------------------------------------------------------------ webhook: entrada, dedupe, vínculo por telefone
reset role;
insert into r select 'in1', public.channel_webhook_ingest('simulated', pg_temp.ev('evt-1', 'inbound', '+5511999990001', '+5511988887777', 'Oi, tem horário amanhã?', null, null));
select is((pg_temp.got('in1')->>'applied')::int, 1, 'mensagem recebida');
insert into r select 'in1b', public.channel_webhook_ingest('simulated', pg_temp.ev('evt-1', 'inbound', '+5511999990001', '+5511988887777', 'Oi, tem horário amanhã?', null, null));
select is((pg_temp.got('in1b')->>'duplicates')::int, 1, 'reenvio do mesmo evento é ignorado');
select is((select count(*)::int from public.channel_messages where direction = 'inbound'), 1, 'uma mensagem só');
select is((select customer_id from public.channel_contacts where phone_e164 = '+5511988887777'), (select ana from ids), 'contato vinculado à cliente pelo telefone');
select is((select opt_in_source from public.channel_contacts where phone_e164 = '+5511988887777'), 'inbound', 'quem escreve primeiro abre a janela e o opt-in');
insert into r select 'in_other', public.channel_webhook_ingest('simulated', pg_temp.ev('evt-x', 'inbound', '+5500000000000', '+5511988887777', 'oi', null, null));
select is((pg_temp.got('in_other')->>'applied')::int, 0, 'conta desconhecida não cria nada');
select is((select outcome from public.channel_webhook_events where external_event_id = 'evt-x'), 'unmatched_account', 'desfecho registrado');
select is((select count(*)::int from public.outbox_events where event_type = 'channel.message.received.v1'), 1, 'evento de entrada para os consumidores');

-- ------------------------------------------------------------------ envio: janela, modelo, estados
set local role authenticated;
select pg_temp.login_as((select owner_a from ids));
create temp table k as select id from public.channel_contacts where phone_e164 = '+5511988887777';
grant select on k to authenticated;
insert into r select 'inbox', public.channel_inbox((select tenant_a from ids));
select is((pg_temp.got('inbox')->'contacts'->0->>'unread_count')::int, 1, 'caixa mostra 1 não lida');
select is((pg_temp.got('inbox')->'contacts'->0->>'window_open')::boolean, true, 'janela de 24 h aberta');
select is(pg_temp.got('inbox')->'contacts'->0->>'customer_name', 'Cliente AB (exemplo)', 'nome do cadastro do próprio negócio');
insert into r select 'conv', public.channel_conversation((select tenant_a from ids), (select id from k));
select is((pg_temp.got('conv')->'contact'->>'unread_count')::int, 0, 'abrir a conversa zera não lidas');
insert into r select 's1', public.channel_send((select tenant_a from ids), (select id from k), 'text', 'Tenho às 10h e às 14h.', null, null, 'idem-ch-send-0001', pg_temp.h('s1'));
select is(pg_temp.got('s1')->'body'->'message'->>'status', 'queued', 'texto na janela entra na fila (não "enviado")');
select throws_ok(format($$ select public.channel_send(%L, %L, 'template', null, 'lembrete_agendamento', '["Corte"]', 'idem-ch-send-tpl-bad', %L) $$,
  (select tenant_a from ids), (select id from k), pg_temp.h('tb')), 'PT400', 'VALIDATION_ERROR', 'modelo com parâmetros errados');
insert into r select 's2', public.channel_send((select tenant_a from ids), (select id from k), 'template', null, 'lembrete_agendamento', '["Corte", "terça 10:00"]', 'idem-ch-send-0002', pg_temp.h('s2'));
select is(pg_temp.got('s2')->'body'->'message'->>'body', 'Lembrete: Corte em terça 10:00. Se precisar remarcar, responda esta mensagem.', 'modelo renderizado');
reset role;
-- Modelo não aprovado no provedor real: recusado.
update public.channel_templates set approved_providers = '{}' where code = 'link_orcamento';
set local role authenticated;
select throws_ok(format($$ select public.channel_send(%L, %L, 'template', null, 'link_orcamento', '["Ana", "https://x"]', 'idem-ch-send-0003', %L) $$,
  (select tenant_a from ids), (select id from k), pg_temp.h('s3')), 'PT422', 'POLICY_REJECTED', 'modelo não aprovado não sai');
reset role;
-- Janela fechada: texto livre é recusado; modelo com opt-in passa.
update public.channel_contacts set last_inbound_at = now() - interval '25 hours' where id = (select id from k);
set local role authenticated;
select throws_ok(format($$ select public.channel_send(%L, %L, 'text', 'ainda aí?', null, null, 'idem-ch-send-0004', %L) $$,
  (select tenant_a from ids), (select id from k), pg_temp.h('s4')), 'PT422', 'POLICY_REJECTED', 'fora da janela, texto livre não sai');
insert into r select 's5', public.channel_send((select tenant_a from ids), (select id from k), 'template', null, 'lembrete_agendamento', '["Corte", "quarta 10:00"]', 'idem-ch-send-0005', pg_temp.h('s5'));
select is(pg_temp.got('s5')->'body'->'message'->>'status', 'queued', 'fora da janela, modelo com opt-in sai');
reset role;

-- Despacho e estados.
insert into r select 'claim2', public.channel_dispatch_claim(50);
select is(jsonb_array_length(pg_temp.got('claim2')->'items'), 3, 'três mensagens reservadas para o despacho');
select is((select count(*)::int from public.channel_messages where status = 'sending'), 3, 'reservadas ficam "enviando"');
select is(jsonb_array_length(public.channel_dispatch_claim(50)->'items'), 0, 'segunda reserva não pega as mesmas');
select public.channel_dispatch_result(pg_temp.got('claim2')->'items'->0->>'ref', 'sent', 'pm-1', null);
select public.channel_dispatch_result(pg_temp.got('claim2')->'items'->1->>'ref', 'failed', null, 'invalid_number');
select public.channel_dispatch_result(pg_temp.got('claim2')->'items'->2->>'ref', 'delivery_unknown', null, null);
select is((select status from public.channel_messages where provider_message_id = 'pm-1'), 'sent', 'enviado = aceito pelo provedor');
select is((select count(*)::int from public.outbox_events where event_type = 'channel.message.failed.v1'), 1, 'falha vira evento');
select is((select count(*)::int from public.channel_messages where status = 'delivery_unknown'), 1, 'resultado desconhecido é estado próprio');
select is(jsonb_array_length(public.channel_dispatch_unknown(50)->'items'), 0, 'desconhecido recente ainda não é consultado');
update public.channel_messages set unknown_since = now() - interval '5 minutes' where status = 'delivery_unknown';
select is(jsonb_array_length(public.channel_dispatch_unknown(50)->'items'), 1, 'depois de 1 min entra na consulta de status (nunca reenvio)');
select is(jsonb_array_length(public.channel_dispatch_claim(50)->'items'), 0, 'desconhecido não volta para a fila de envio');
-- Status pelo webhook: só avança.
select public.channel_webhook_ingest('simulated', pg_temp.ev('st-1', 'status', '+5511999990001', null, null, 'pm-1', 'read'));
select is((select status from public.channel_messages where provider_message_id = 'pm-1'), 'read', 'lido');
select public.channel_webhook_ingest('simulated', pg_temp.ev('st-2', 'status', '+5511999990001', null, null, 'pm-1', 'delivered'));
select is((select status from public.channel_messages where provider_message_id = 'pm-1'), 'read', 'entregue atrasado não regride lido');
select is((select outcome from public.channel_webhook_events where external_event_id = 'st-2'), 'ignored', 'regressão registrada como ignorada');
select is((select outcome from public.channel_webhook_events where external_event_id = 'st-1'), 'applied', 'avanço registrado como aplicado');
insert into r select 'st_unknown', public.channel_webhook_ingest('simulated', pg_temp.ev('st-3', 'status', '+5511999990001', null, null, 'pm-nao-existe', 'delivered'));
select is((select outcome from public.channel_webhook_events where external_event_id = 'st-3'), 'unmatched_message', 'status de mensagem desconhecida não cria nada');

-- ------------------------------------------------------------------ opt-out, transferência e desconexão
select public.channel_webhook_ingest('simulated', pg_temp.ev('evt-2', 'inbound', '+5511999990001', '+5511988887777', 'SAIR', null, null));
select ok((select opted_out_at is not null from public.channel_contacts where id = (select id from k)), 'SAIR marca opt-out');
set local role authenticated;
select pg_temp.login_as((select owner_a from ids));
select throws_ok(format($$ select public.channel_send(%L, %L, 'text', 'oi', null, null, 'idem-ch-send-0006', %L) $$,
  (select tenant_a from ids), (select id from k), pg_temp.h('s6')), 'PT422', 'POLICY_REJECTED', 'opt-out bloqueia envio mesmo na janela');
insert into r select 'ho', public.channel_handoff((select tenant_a from ids), (select id from k), 'human', 'idem-ch-handoff-0001', pg_temp.h('ho'));
select is(pg_temp.got('ho')->'body'->'contact'->>'handling', 'human', 'humano assume a conversa');
insert into r select 'ci', public.channel_contact_consent((select tenant_a from ids), (select id from k), true, 'idem-ch-consent-0001', pg_temp.h('ci'));
select is((pg_temp.got('ci')->'body'->'contact'->>'opted_out')::boolean, false, 'dono registra que o cliente voltou a aceitar');
select throws_ok(format($$ select public.channel_contact_link(%L, %L, '30000000-0000-4000-8000-0000000000b1', 'idem-ch-link-b-0001', %L) $$,
  (select tenant_a from ids), (select id from k), pg_temp.h('lb')), 'PT404', 'NOT_FOUND', 'não vincula a cliente de outro negócio');
insert into r select 'sim', public.channel_sim_phone((select tenant_a from ids), '+5511999990001');
select ok(jsonb_typeof(pg_temp.got('sim')->'messages') = 'array', 'telefone simulado legível pelo dono em modo simulado');
-- Isolamento das leituras diretas.
select pg_temp.login_as((select owner_b from ids));
select is((select count(*)::int from public.channel_messages), 0, 'RLS: B não vê mensagens de A');
select is((select count(*)::int from public.channel_contacts), 0, 'RLS: B não vê contatos de A');
select throws_ok(format($$ select public.channel_conversation(%L, %L) $$, (select tenant_b from ids), (select id from k)), 'PT404', 'NOT_FOUND', 'contato de A não existe para B');
select pg_temp.login_as((select owner_a from ids));
insert into r select 's7', public.channel_send((select tenant_a from ids), (select id from k), 'template', null, 'lembrete_agendamento', '["Corte", "sexta 10:00"]', 'idem-ch-send-0007', pg_temp.h('s7'));
insert into r select 'dc', public.channel_disconnect((select tenant_a from ids), 'idem-ch-disconnect-01', pg_temp.h('dc'));
select is(pg_temp.got('dc')->'body'->'connection'->>'status', 'disconnected', 'desconectado');
reset role;
select is((select status || ':' || failure_reason from public.channel_messages where id = (pg_temp.got('s7')->'body'->'message'->>'id')::uuid),
  'failed:disconnected', 'fila morre com a desconexão');
select ok((select bool_and(a.after::text !~ '5511' and coalesce(a.before::text, '') !~ '5511') from public.audit_events a where a.object_type like 'channel_%'),
  'auditoria sem telefone');
set local role authenticated;
select pg_temp.login_as((select owner_b from ids));
insert into r select 'cb2', public.channel_connect((select tenant_b from ids), 'simulated', '+5511999990001', null, 'idem-ch-connect-b-02', pg_temp.h('cb2'));
select is(pg_temp.got('cb2')->'body'->'connection'->>'status', 'pending_verification', 'número liberado depois da desconexão pode ir a outro negócio');

select * from finish();
rollback;

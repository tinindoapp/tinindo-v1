-- Integrações reais, bloco 2 · WhatsApp oficial (Meta): modelos com {{1}} = negócio e o texto do app igual ao da Meta;
-- conexão com phone_number_id e código para o WhatsApp pessoal; aprovação de modelo só pelo backend; janela de 24 h
-- conferida no despacho; opt-out que falha a fila; retentativa por limite com espera crescente, teto de tentativas e
-- teto por número por rodada; status que chega antes do id do despacho não se perde; enviado ≠ entregue ≠ lido.
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana;
grant select on ids to authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
/** Item reservado de um tipo (mensagens da mesma transação têm o mesmo created_at: a ordem entre elas não é fixa). */
create function pg_temp.item(p_k text, p_kind text) returns jsonb language sql as $$
  select x from jsonb_array_elements((select v from r where k = p_k)->'items') x where x->>'kind' = p_kind limit 1 $$;
create function pg_temp.st(p_id text, p_pmid text, p_status text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('external_event_id', p_id, 'kind', 'status', 'external_account_id', '1029384756',
    'provider_message_id', p_pmid, 'status', p_status)) $$;
create function pg_temp.inb(p_id text, p_text text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('external_event_id', p_id, 'kind', 'inbound', 'external_account_id', '1029384756',
    'phone_e164', '+5511988887777', 'text', p_text, 'profile_name', 'Ana')) $$;
create function pg_temp.hint(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlerrm || '/' || coalesce(v_hint, '');
end $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.hint(text) to authenticated;
update public.customers set phone = '+5511988887777' where id = (select ana from ids);

-- ------------------------------------------------------------------ modelos na Meta
select is((select count(*)::int from public.channel_templates where meta_name is null), 0, 'todo modelo do app tem cadastro na Meta');
select is((select count(*)::int from public.channel_templates where meta_language <> 'pt_BR'), 0, 'idioma pt_BR');
select is((select count(*)::int from public.channel_templates t where t.meta_category <> 'authentication'
  and replace(app.ch_render(t.code, (select jsonb_agg('P' || g) from generate_series(1, t.params) g)), '{{negocio}}', 'NEG')
   <> app.ch_fill_numbered(t.meta_body, app.ch_meta_values(t.meta_params, 'NEG', (select jsonb_agg('P' || g) from generate_series(1, t.params) g)))), 0,
  'texto guardado pelo app = texto que a Meta mostra com os parâmetros na ordem da Meta');
select is((select count(*)::int from public.channel_templates t where t.meta_category <> 'authentication' and t.meta_params[1] = 0
  and app.ch_fill_numbered(t.meta_body, app.ch_meta_values(t.meta_params, 'NEG', (select jsonb_agg('P' || g) from generate_series(1, t.params) g))) !~ 'NEG'), 0,
  'modelos ao cliente levam o nome do negócio da Tinindo em {{1}}');
select is((select count(*)::int from public.channel_templates t where t.meta_category <> 'authentication' and t.meta_params[1] <> case when t.code in ('reativacao', 'oferta_campanha') then 2 else 0 end), 0,
  '{{1}} = nome do negócio em todos os modelos ao cliente');
select is((select count(*)::int from public.channel_templates t where t.meta_category <> 'authentication'
  and (t.meta_body ~ '^\s*\{\{' or t.meta_body ~ '\}\}\s*$')), 0, 'nenhum corpo começa ou termina em variável (regra da Meta)');
select is((select count(*)::int from public.channel_templates t
  where cardinality(t.meta_params) <> (select count(distinct m[1]) from regexp_matches(t.meta_body, '\{\{([0-9]+)\}\}', 'g') m)), 0,
  'quantidade de variáveis do corpo da Meta = origem de cada uma');
select is((select array_agg(code order by code) from public.channel_templates where meta_category = 'authentication'),
  array['codigo_reserva', 'verificacao_numero'], 'códigos são da categoria de autenticação da Meta');
select is(app.ch_provider_template('whatsapp_cloud', 'reativacao', (select tenant_a from ids), '["Ana", "Barbearia Exemplo A"]')->'params',
  '["Barbearia Exemplo A", "Ana"]'::jsonb, 'reativação: o negócio que já era parâmetro vira {{1}}');
select is(app.ch_provider_template('whatsapp_cloud', 'confirmacao_agendamento', (select tenant_a from ids), '["Ana", "Corte", "21/10 às 10:00"]'),
  jsonb_build_object('name', 'confirmacao_agendamento', 'language', 'pt_BR', 'category', 'utility',
    'params', jsonb_build_array((select name from public.tenants where id = (select tenant_a from ids)), 'Ana', 'Corte', '21/10 às 10:00')),
  'confirmação: {{1}} = nome do negócio, depois os parâmetros na ordem');
select is(app.ch_provider_template('simulated', 'confirmacao_agendamento', (select tenant_a from ids), '["Ana", "Corte", "x"]'), null, 'simulado usa o texto pronto');
select is((select count(*)::int from public.channel_templates where 'whatsapp_cloud' = any (approved_providers)), 0, 'nenhum modelo nasce aprovado na Meta');

-- Aprovação: só o backend.
select ok(not has_function_privilege('authenticated', 'public.channel_template_set_approval(text, text, boolean)', 'execute'), 'dono não aprova modelo');
select ok(has_function_privilege('service_role', 'public.channel_template_set_approval(text, text, boolean)', 'execute'), 'operador (backend) aprova');
select is(public.channel_template_set_approval('lembrete_agendamento', 'whatsapp_cloud', true)->'approved_providers', '["simulated", "whatsapp_cloud"]'::jsonb, 'aprovado na Meta');
select is(public.channel_template_set_approval('lembrete_agendamento', 'whatsapp_cloud', true)->'approved_providers', '["simulated", "whatsapp_cloud"]'::jsonb, 'aprovar de novo não duplica');
select is(pg_temp.hint($$ select public.channel_template_set_approval('nao_existe', 'whatsapp_cloud', true) $$), 'NOT_FOUND/template_code', 'modelo desconhecido');
select is(pg_temp.hint($$ select public.channel_template_set_approval('lembrete_agendamento', 'telegram', true) $$), 'VALIDATION_ERROR/provider', 'provedor desconhecido');

-- ------------------------------------------------------------------ conexão com a Meta
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.hint(format($$ select public.channel_connect(%L, 'whatsapp_cloud', '+5511999990001', null, 'idem-wa-connect-01', %L, null, '+5511988880001') $$,
  (select tenant_a from ids), pg_temp.h('w1'))), 'VALIDATION_ERROR/external_account_id', 'Meta sem phone_number_id: recusado');
select is(pg_temp.hint(format($$ select public.channel_connect(%L, 'whatsapp_cloud', '+5511999990001', 'abc-123', 'idem-wa-connect-02', %L, null, '+5511988880001') $$,
  (select tenant_a from ids), pg_temp.h('w2'))), 'VALIDATION_ERROR/external_account_id', 'phone_number_id só com números');
select is(pg_temp.hint(format($$ select public.channel_connect(%L, 'whatsapp_cloud', '+5511999990001', '1029384756', 'idem-wa-connect-03', %L, null, '+5511999990001') $$,
  (select tenant_a from ids), pg_temp.h('w3'))), 'VALIDATION_ERROR/verify_to_e164', 'o código não vai para o próprio número do negócio');
insert into r select 'c1', public.channel_connect((select tenant_a from ids), 'whatsapp_cloud', '+5511999990001', '1029384756', 'idem-wa-connect-04', pg_temp.h('w4'), null, '+5511988880001');
select is(pg_temp.got('c1')->'body'->'connection'->>'external_account_id', '1029384756', 'conexão guarda o phone_number_id');
reset role;
-- Sem o modelo de verificação aprovado na Meta, o código não sai: falha com motivo e o dono vê.
insert into r select 'cl0', public.channel_dispatch_claim(50);
select is(jsonb_array_length(pg_temp.got('cl0')->'items'), 0, 'código não vai para a Meta sem modelo aprovado');
set local role authenticated;
select is(public.channel_status((select tenant_a from ids))->'verification'->>'failure_reason', 'template_not_approved', 'status mostra por que o código não saiu');
select is(public.channel_status((select tenant_a from ids))->'templates'->0->>'approved', 'false', 'modelo não aprovado na Meta aparece como não aprovado');
reset role;
-- Aprovado: desconecta e conecta de novo; o código vai para o WhatsApp pessoal, como modelo de autenticação.
select public.channel_template_set_approval('verificacao_numero', 'whatsapp_cloud', true);
set local role authenticated;
select public.channel_disconnect((select tenant_a from ids), 'idem-wa-disconnect-01', pg_temp.h('d1'));
insert into r select 'c2', public.channel_connect((select tenant_a from ids), 'whatsapp_cloud', '+5511999990001', '1029384756', 'idem-wa-connect-05', pg_temp.h('w5'), null, '+5511988880001');
select is(public.channel_status((select tenant_a from ids))->'verification'->>'status', 'queued', 'código na fila');
reset role;
insert into r select 'cl1', public.channel_dispatch_claim(50);
select is(pg_temp.got('cl1')->'items'->0->>'to', '+5511988880001', 'código vai para o WhatsApp pessoal do dono');
select is(pg_temp.got('cl1')->'items'->0->'provider_template'->>'category', 'authentication', 'como modelo de autenticação');
select is(pg_temp.got('cl1')->'items'->0->'provider_template'->'params', jsonb_build_array((select code from public.channel_verifications where id = split_part(pg_temp.got('cl1')->'items'->0->>'ref', ':', 2)::uuid)),
  'com o código como única variável');
select public.channel_dispatch_result(pg_temp.got('cl1')->'items'->0->>'ref', 'sent', 'wamid.codigo', null);
set local role authenticated;
select is(public.channel_status((select tenant_a from ids))->'verification'->>'status', 'sent', 'status mostra o código enviado');
reset role;
create temp table code as select (pg_temp.got('cl1')->'items'->0->'provider_template'->'params'->>0) as v;
grant select on code to authenticated;
set local role authenticated;
select is(public.channel_verify((select tenant_a from ids), (select v from code), 'idem-wa-verify-01', pg_temp.h('v1'))->'body'->'connection'->>'status', 'active', 'código certo conecta o número da Meta');
reset role;

-- ------------------------------------------------------------------ webhook da Meta e estados
insert into r select 'in1', public.channel_webhook_ingest('whatsapp_cloud', pg_temp.inb('msg:wamid.in1', 'Oi, tem horário?'));
select is((pg_temp.got('in1')->>'applied')::int, 1, 'mensagem da cliente entra pelo número da Meta');
select is((public.channel_webhook_ingest('whatsapp_cloud', pg_temp.inb('msg:wamid.in1', 'Oi, tem horário?'))->>'duplicates')::int, 1, 'reentrega da Meta é duplicada');
create temp table k as select id from public.channel_contacts where phone_e164 = '+5511988887777';
grant select on k to authenticated;
set local role authenticated;
select throws_ok(format($$ select public.channel_send(%L, %L, 'template', null, 'confirmacao_agendamento', '["Ana", "Corte", "x"]', 'idem-wa-send-000000', %L) $$,
  (select tenant_a from ids), (select id from k), pg_temp.h('s0')), 'PT422', 'POLICY_REJECTED', 'modelo não aprovado na Meta não entra na fila');
insert into r select 's1', public.channel_send((select tenant_a from ids), (select id from k), 'template', null, 'lembrete_agendamento', '["Corte", "amanhã às 10h"]', 'idem-wa-send-000001', pg_temp.h('s1'));
insert into r select 's2', public.channel_send((select tenant_a from ids), (select id from k), 'text', 'Tenho às 10h.', null, null, 'idem-wa-send-000002', pg_temp.h('s2'));
reset role;
insert into r select 'cl2', public.channel_dispatch_claim(50);
select is(jsonb_array_length(pg_temp.got('cl2')->'items'), 2, 'modelo e texto reservados');
select is(pg_temp.item('cl2', 'template')->'provider_template'->'params',
  jsonb_build_array((select name from public.tenants where id = (select tenant_a from ids)), 'Corte', 'amanhã às 10h'), 'modelo sai com {{1}} = negócio para a Meta');
select is(pg_temp.item('cl2', 'text')->'provider_template', 'null'::jsonb, 'texto livre sem modelo');
-- Status da Meta ANTES do despacho gravar o id: fica guardado e é aplicado quando o id chega (fora de ordem também).
insert into r select 'early', public.channel_webhook_ingest('whatsapp_cloud', pg_temp.st('st:wamid.s1:read', 'wamid.s1', 'read') || pg_temp.st('st:wamid.s1:delivered', 'wamid.s1', 'delivered'));
select is((select count(*)::int from public.channel_webhook_events where provider_message_id = 'wamid.s1' and outcome = 'unmatched_message'), 2, 'status adiantado guardado, sem telefone nem texto');
select public.channel_dispatch_result(pg_temp.item('cl2', 'template')->>'ref', 'sent', 'wamid.s1', null);
select is((select status from public.channel_messages where provider_message_id = 'wamid.s1'), 'read', 'aplicado quando o id chega; entregue atrasado não regride lido');
select is((select count(*)::int from public.channel_webhook_events where provider_message_id = 'wamid.s1' and outcome = 'unmatched_message'), 0, 'nada fica pendente');
select ok((select delivered_at is not null and read_at is not null from public.channel_messages where provider_message_id = 'wamid.s1'), 'lido implica entregue');
select public.channel_dispatch_result(pg_temp.item('cl2', 'text')->>'ref', 'sent', 'wamid.s2', null);
select is((select status || ':' || (delivered_at is null)::text from public.channel_messages where provider_message_id = 'wamid.s2'), 'sent:true', 'enviado não é entregue');
select public.channel_webhook_ingest('whatsapp_cloud', pg_temp.st('st:wamid.s2:delivered', 'wamid.s2', 'delivered'));
select public.channel_webhook_ingest('whatsapp_cloud', pg_temp.st('st:wamid.s2:sent', 'wamid.s2', 'sent'));
select public.channel_webhook_ingest('whatsapp_cloud', jsonb_build_array(jsonb_build_object('external_event_id', 'st:wamid.s2:failed', 'kind', 'status',
  'external_account_id', '1029384756', 'provider_message_id', 'wamid.s2', 'status', 'failed', 'reason', 'undeliverable')));
select is((select status from public.channel_messages where provider_message_id = 'wamid.s2'), 'delivered', 'enviado atrasado e falha depois de entregue não mudam o entregue');

-- ------------------------------------------------------------------ janela de 24 h no despacho (Meta)
set local role authenticated;
insert into r select 's3', public.channel_send((select tenant_a from ids), (select id from k), 'text', 'Confirmado?', null, null, 'idem-wa-send-000003', pg_temp.h('s3'));
reset role;
update public.channel_contacts set last_inbound_at = now() - interval '25 hours' where id = (select id from k);
select is(jsonb_array_length(public.channel_dispatch_claim(50)->'items'), 0, 'texto que ficou na fila além da janela não vai para a Meta');
select is((select status || ':' || failure_reason from public.channel_messages where id = (pg_temp.got('s3')->'body'->'message'->>'id')::uuid), 'failed:window_closed',
  'falha com o motivo da janela');
update public.channel_contacts set last_inbound_at = now() where id = (select id from k);

-- ------------------------------------------------------------------ retentativa por limite, pela fila
set local role authenticated;
insert into r select 's4', public.channel_send((select tenant_a from ids), (select id from k), 'text', 'Mensagem com limite', null, null, 'idem-wa-send-000004', pg_temp.h('s4'));
reset role;
create temp table m4 as select (pg_temp.got('s4')->'body'->'message'->>'id')::uuid as id;
grant select on m4 to authenticated;
select public.channel_dispatch_claim(50);
insert into r select 'rt1', public.channel_dispatch_result('msg:' || (select id from m4), 'retry', null, 'throughput_limit');
select is(pg_temp.got('rt1')->>'status', 'queued', 'limite: volta para a fila');
select ok((select next_attempt_at between now() + interval '55 seconds' and now() + interval '65 seconds' from public.channel_messages where id = (select id from m4)), '1ª espera: 60 s');
select is(jsonb_array_length(public.channel_dispatch_claim(50)->'items'), 0, 'antes da espera não sai de novo');
set local role authenticated;
select is((select x->>'retry_reason' from jsonb_array_elements(public.channel_conversation((select tenant_a from ids), (select id from k))->'messages') x
  where (x->>'id')::uuid = (select id from m4)), 'throughput_limit', 'conversa mostra a espera e o motivo');
reset role;
update public.channel_messages set next_attempt_at = now() - interval '1 second' where id = (select id from m4);
select public.channel_dispatch_claim(50);
select public.channel_dispatch_result('msg:' || (select id from m4), 'retry', null, 'throughput_limit', 600);
select ok((select attempts = 2 and next_attempt_at between now() + interval '595 seconds' and now() + interval '605 seconds' from public.channel_messages where id = (select id from m4)),
  'espera pedida pela Meta vale quando é maior (600 s)');
update public.channel_messages set next_attempt_at = now() - interval '1 second' where id = (select id from m4);
select public.channel_dispatch_claim(50);
select public.channel_dispatch_result('msg:' || (select id from m4), 'requeue', null, 'rate_limited_round');
select is((select attempts from public.channel_messages where id = (select id from m4)), 2, 'volta da rodada não gasta tentativa');
update public.channel_messages set next_attempt_at = now() - interval '1 second' where id = (select id from m4);
select public.channel_dispatch_claim(50);
select public.channel_dispatch_result('msg:' || (select id from m4), 'retry', null, 'throughput_limit');
select ok((select next_attempt_at between now() + interval '235 seconds' and now() + interval '245 seconds' from public.channel_messages where id = (select id from m4)), 'espera cresce: 3ª = 240 s');
update public.channel_messages set attempts = 4, next_attempt_at = now() - interval '1 second' where id = (select id from m4);
select public.channel_dispatch_claim(50);
select is(public.channel_dispatch_result('msg:' || (select id from m4), 'retry', null, 'throughput_limit')->>'status', 'failed', 'teto de 5 tentativas');
select is((select failure_reason from public.channel_messages where id = (select id from m4)), 'retries_exhausted', 'falha com motivo; nunca reenvio sem fim');
select is(public.channel_dispatch_result('msg:' || (select id from m4), 'retry', null, 'x')->>'status', 'ignored', 'resultado atrasado não ressuscita a mensagem');
select ok(not has_function_privilege('authenticated', 'public.channel_dispatch_result(text, text, text, text, integer)', 'execute'), 'resultado só do backend');

-- ------------------------------------------------------------------ teto por número por rodada
insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, status)
select (select tenant_a from ids), (select id from k), 'outbound', 'text', 'lote ' || g, 'queued' from generate_series(1, 25) g;
select is(jsonb_array_length(public.channel_dispatch_claim(50)->'items'), 20, 'no máximo 20 por número numa rodada');
select is((select count(*)::int from public.channel_messages where status = 'queued' and body like 'lote %'), 5, 'o resto espera a próxima rodada');
update public.channel_messages set status = 'sent', sent_at = now() where status = 'sending';

-- ------------------------------------------------------------------ opt-out no servidor
set local role authenticated;
insert into r select 's5', public.channel_send((select tenant_a from ids), (select id from k), 'template', null, 'lembrete_agendamento', '["Corte", "sexta"]', 'idem-wa-send-000005', pg_temp.h('s5'));
reset role;
select public.channel_webhook_ingest('whatsapp_cloud', pg_temp.inb('msg:wamid.in2', 'Sair da lista de quê?'));
select ok((select opted_out_at is null from public.channel_contacts where id = (select id from k)), 'frase com a palavra não é pedido de saída');
select public.channel_webhook_ingest('whatsapp_cloud', pg_temp.inb('msg:wamid.in3', '  sair! '));
select ok((select opted_out_at is not null from public.channel_contacts where id = (select id from k)), '"sair!" em minúsculas com pontuação é saída');
select is((select count(*)::int from public.channel_messages where contact_id = (select id from k) and status = 'queued'), 0, 'nada fica na fila para quem saiu');
select is((select failure_reason from public.channel_messages where id = (pg_temp.got('s5')->'body'->'message'->>'id')::uuid), 'opted_out', 'o modelo que estava na fila falha com o motivo');
select ok((select count(*) >= 6 from public.outbox_events where event_type = 'channel.message.failed.v1'), 'consumidores (réguas) sabem da falha');
-- Mesmo o que entrar na fila por outro caminho (régua, campanha) não sai: o despacho confere de novo.
insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, status) values ((select tenant_a from ids), (select id from k), 'outbound', 'text', 'depois do SAIR', 'queued');
select is(jsonb_array_length(public.channel_dispatch_claim(50)->'items'), 0, 'despacho não entrega a quem saiu');
select is((select status || ':' || failure_reason from public.channel_messages where body = 'depois do SAIR'), 'failed:opted_out', 'falha com o motivo');
select ok(app.ch_is_opt_out('PARAR') and app.ch_is_opt_out('Stop.') and app.ch_is_opt_out('cancelar') and not app.ch_is_opt_out('não quero parar'), 'SAIR, PARAR, STOP e CANCELAR (palavra sozinha)');

-- ------------------------------------------------------------------ webhook de outro número
select is((public.channel_webhook_ingest('whatsapp_cloud', jsonb_build_array(jsonb_build_object('external_event_id', 'msg:wamid.outro', 'kind', 'inbound',
  'external_account_id', '5550001111', 'phone_e164', '+5511977776666', 'text', 'oi')))->>'applied')::int, 0, 'número da Meta sem conexão ativa não cria nada');

select * from finish();
rollback;

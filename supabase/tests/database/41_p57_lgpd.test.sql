-- P57 · LGPD e borda pública: prazos de retenção (D25) numa tabela e numa rotina de job_ticks com relatório sem
-- conteúdo; exportar e eliminar por negócio e por cliente final (D26), só o dono, com carência cancelável e trilha;
-- teto de reservas provisórias do link, limite por contato e por origem (D30 a).
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as cust_a,
  '30000000-0000-4000-8000-0000000000a2'::uuid as cust_a2,
  '30000000-0000-4000-8000-0000000000b1'::uuid as cust_b,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7) + time '10:00') at time zone 'America/Sao_Paulo' as monday_10;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
grant execute on function pg_temp.got(text) to anon, authenticated;
create function pg_temp.book(p_k text, p_hours int, p_phone text) returns jsonb language sql as $$
  insert into r select p_k, public.public_booking_request('barbearia-p57', (select corte_a from ids),
    (select monday_10 from ids) + make_interval(hours => p_hours), 'Visitante', p_phone, 'p57-' || p_k || '-0000000000', repeat('a', 64))
  returning v
$$;
grant execute on function pg_temp.book(text, int, text) to anon, authenticated;

-- ------------------------------------------------------------------ estrutura e acesso
select is(
  (select jsonb_object_agg(category, days) from public.retention_policies
   where category in ('idempotency', 'outbox_events', 'webhook_events', 'channel_messages', 'agent_executions', 'verification_codes', 'unconfirmed_requests')),
  '{"idempotency": 30, "outbox_events": 90, "webhook_events": 90, "channel_messages": 365, "agent_executions": 365, "verification_codes": 0, "unconfirmed_requests": 30}'::jsonb,
  'prazos da D25 na tabela de configuração');
select ok(not has_table_privilege('authenticated', 'public.retention_policies', 'select')
  and not has_table_privilege('authenticated', 'public.retention_runs', 'select')
  and not has_table_privilege('authenticated', 'public.privacy_exports', 'select')
  and not has_table_privilege('authenticated', 'public.privacy_erasures', 'select')
  and not has_table_privilege('anon', 'public.public_origin_hits', 'select')
  and not has_table_privilege('authenticated', 'public.abuse_limits', 'select'),
  'tabelas novas fechadas para leitura direta');
select ok(not has_function_privilege('authenticated', 'app.retention_tick(integer)', 'execute')
  and not has_function_privilege('authenticated', 'app.privacy_erasure_tick(integer)', 'execute')
  and not has_function_privilege('authenticated', 'app.privacy_erase_business(uuid)', 'execute'),
  'rotinas e eliminação só pelo worker');
select ok(has_function_privilege('anon', 'public.public_origin_check(text)', 'execute')
  and not has_function_privilege('anon', 'public.privacy_export_start(uuid, text, uuid, text, text, uuid)', 'execute'),
  'limite por origem é público; exportar exige login');
select is((select count(*)::int from public.job_ticks where name in ('retention', 'privacy_erasure') and enabled), 2,
  'retenção e eliminação entram como linhas em job_ticks');

-- ------------------------------------------------------------------ retenção
insert into public.idempotency_records (tenant_id, actor_user_id, operation, key, request_hash, created_at)
select tenant_a, owner_a, 'privacy.test', k, repeat('b', 64), now() - make_interval(days => d)
from ids, (values ('p57-velha-00000000001', 31), ('p57-nova-000000000001', 29)) v(k, d);
insert into public.outbox_events (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, payload, occurred_at, status)
select tenant_a, 'booking.confirmed.v1', gen_random_uuid(), 1, gen_random_uuid(), '{}', now() - interval '91 days', s
from ids, (values ('done'), ('pending')) v(s);
insert into public.channel_webhook_events (provider, external_event_id, kind, outcome, received_at) values
  ('simulated', 'p57-velho', 'status', 'applied', now() - interval '91 days'),
  ('simulated', 'p57-novo', 'status', 'applied', now() - interval '1 day');
insert into public.agent_runs (tenant_id, user_id, idem_key, created_at)
select tenant_a, owner_a, k, now() - make_interval(days => d)
from ids, (values ('p57-run-velha-0000001', 366), ('p57-run-nova-00000001', 10)) v(k, d);
insert into public.channel_connections (tenant_id, provider, external_account_id, phone_e164, status, verified_at)
select tenant_a, 'simulated', '+5511900000057', '+5511900000057', 'active', now() from ids;
insert into public.channel_contacts (id, tenant_id, connection_id, phone_e164, customer_id)
select '57000000-0000-4000-8000-0000000000c1', tenant_a, (select id from public.channel_connections where phone_e164 = '+5511900000057'), '+5511988880001', cust_a from ids;
insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, status, created_at)
select tenant_a, '57000000-0000-4000-8000-0000000000c1', 'outbound', 'text', b, 'sent', now() - make_interval(days => d)
from ids, (values ('mensagem antiga', 366), ('mensagem recente', 5)) v(b, d);

insert into r select 'tick', app.retention_tick(500);
select is((select count(*)::int from public.idempotency_records where operation = 'privacy.test'), 1, 'idempotência: 31 dias some, 29 dias fica');
select is((select array_agg(status) from public.outbox_events where event_type = 'booking.confirmed.v1' and occurred_at < now() - interval '90 days'),
  array['pending'], 'eventos: entregue com 91 dias some; pendente nunca é apagado');
select is((select array_agg(external_event_id) from public.channel_webhook_events where external_event_id like 'p57-%'), array['p57-novo'], 'webhooks: 91 dias some');
select is((select array_agg(idem_key) from public.agent_runs where idem_key like 'p57-run-%'), array['p57-run-nova-00000001'], 'assistente: execução com 12 meses some');
select is((select array_agg(body) from public.channel_messages where contact_id = '57000000-0000-4000-8000-0000000000c1'),
  array['mensagem recente'], 'mensagens: 12 meses some');
select throws_ok($$ delete from public.agent_runs where idem_key = 'p57-run-nova-00000001' $$, 'PT403', 'FORBIDDEN',
  'fora da retenção, o assistente continua só acrescenta');
select ok((pg_temp.got('tick')->>'idempotency')::int >= 1 and (pg_temp.got('tick')->>'agent_executions')::int >= 1,
  'a rodada devolve quantas linhas apagou por categoria');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
  where table_schema = 'public' and table_name = 'retention_runs'), array['id', 'ran_at', 'category', 'affected'],
  'relatório: só categoria, quando e quantas (sem conteúdo, negócio ou titular)');
select ok((select count(*) from public.retention_runs where category in ('idempotency', 'agent_executions', 'channel_messages')) >= 3,
  'relatório registra as categorias que apagaram algo');
select is((select count(*)::int from public.retention_runs where category = 'privacy_exports'), 0, 'categoria sem nada apagado não entra no relatório');

-- ------------------------------------------------------------------ reserva pública: código, pedido não confirmado e limites
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select public.scheduling_rules_save((select tenant_a from ids), (select res_a from ids),
  (select version from public.resources where id = (select res_a from ids)),
  '[{"weekday":1,"local_start":"08:00","local_end":"20:00"}]', 'chave-expediente-p57-001', repeat('e', 64));
reset role;
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
select tenant_a, 'barbearia-p57', 'barber', 'Centro', array['display_name', 'booking_link'], now() from ids;

update public.abuse_limits set value = 2 where key = 'public_holds_per_tenant';
select pg_temp.book('h1', 0, '+5511977770001');
select pg_temp.book('h2', 1, '+5511977770002');
select throws_ok($$ select pg_temp.book('h3', 2, '+5511977770003') $$, 'PT429', 'QUOTA_EXCEEDED',
  'teto de reservas provisórias do link por negócio');
select is((select count(*)::int from public.bookings where tenant_id = (select tenant_a from ids) and source = 'public_link' and status = 'held'), 2,
  'pedido recusado pelo teto não segura horário');
update public.abuse_limits set value = 10 where key = 'public_holds_per_tenant';
update public.abuse_limits set value = 1 where key = 'public_requests_per_contact_day';
select pg_temp.book('h4', 3, '+5511977770004');
update public.public_booking_requests set status = 'replaced' where id = (pg_temp.got('h4')->'body'->>'request_id')::uuid;
select throws_ok($$ select pg_temp.book('h5', 4, '+5511977770004') $$, 'PT429', 'QUOTA_EXCEEDED',
  'mesmo WhatsApp: limite de pedidos em 24 h em toda a Tinindo');
update public.abuse_limits set value = 10 where key = 'public_requests_per_contact_day';

update public.abuse_limits set value = 2 where key = 'public_requests_per_origin_10min';
select pg_temp.login_as(null);
set local role anon;
select lives_ok($$ select public.public_origin_check(repeat('c', 64)); select public.public_origin_check(repeat('c', 64)) $$,
  'origem: duas tentativas passam');
select throws_ok($$ select public.public_origin_check(repeat('c', 64)) $$, 'PT429', 'QUOTA_EXCEEDED', 'origem: a terceira em 10 min é recusada');
select lives_ok($$ select public.public_origin_check(repeat('d', 64)) $$, 'outra origem segue livre');
select throws_ok($$ select public.public_origin_check('127.0.0.1') $$, 'PT400', 'VALIDATION_ERROR', 'só aceita hash (o banco nunca vê o IP)');
reset role;

-- Código em claro: some quando o pedido deixa de esperar; pedido esperando mantém (o reenvio precisa dele).
update public.public_booking_requests set status = 'replaced' where id = (pg_temp.got('h2')->'body'->>'request_id')::uuid;
select app.retention_tick(500);
select is((select code from public.public_booking_requests where id = (pg_temp.got('h2')->'body'->>'request_id')::uuid), null,
  'código apagado no fim do envio');
select is((select code_hash from public.public_booking_requests where id = (pg_temp.got('h2')->'body'->>'request_id')::uuid), null,
  'hash do código também');
select isnt((select code from public.public_booking_requests where id = (pg_temp.got('h1')->'body'->>'request_id')::uuid), null,
  'pedido esperando o código mantém o código');
-- Pedido não confirmado com 31 dias: some, e o horário liberado perde o nome digitado.
update public.public_booking_requests set created_at = now() - interval '31 days' where id = (pg_temp.got('h2')->'body'->>'request_id')::uuid;
update public.bookings set status = 'expired', blocks_capacity = false, hold_expires_at = null
where id = (pg_temp.got('h2')->'body'->>'booking_id')::uuid;
select app.retention_tick(500);
select is((select count(*)::int from public.public_booking_requests where id = (pg_temp.got('h2')->'body'->>'request_id')::uuid), 0,
  'pedido não confirmado com 31 dias some');
select is((select guest_ref from public.bookings where id = (pg_temp.got('h2')->'body'->>'booking_id')::uuid), null,
  'o horário liberado perde o nome');

-- ------------------------------------------------------------------ exportar
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok($$ select public.privacy_export_start((select tenant_a from ids), 'business', null, 'p57-export-b-000001', repeat('f', 64)) $$,
  'PT403', 'FORBIDDEN', 'dono de outro negócio não exporta');
select pg_temp.login_as((select owner_a from ids));
insert into r select 'exp', public.privacy_export_start((select tenant_a from ids), 'business', null, 'p57-export-a-000001', repeat('f', 64));
select is(pg_temp.got('exp')->>'status_code', '201', 'dono pede a exportação do negócio');
select is(pg_temp.got('exp')->'body'->'export'->>'status', 'generating', 'exportação começa gerando');
select is(pg_temp.got('exp')->'body'->>'storage_path',
  (select tenant_a from ids)::text || '/' || (pg_temp.got('exp')->'body'->'export'->>'id') || '.json', 'arquivo na pasta do negócio');
insert into r select 'data', public.privacy_export_data((select tenant_a from ids), (pg_temp.got('exp')->'body'->'export'->>'id')::uuid);
select ok(pg_temp.got('data')->'data' ? 'customers' and pg_temp.got('data')->'data' ? 'bookings' and pg_temp.got('data')->'data' ? 'tenants',
  'exportação traz o negócio, os clientes e as reservas');
select is((select count(*)::int from jsonb_each(pg_temp.got('data')->'data') t(tbl, rows_), jsonb_array_elements(rows_) e, jsonb_object_keys(e) k
  where k in ('code', 'code_hash', 'token_hash', 'request_hash', 'idem_key', 'booking_token', 'payload_hash')), 0,
  'nenhuma coluna de código, hash de token nem chave interna');
select ok(not (pg_temp.got('data')->'data' ? 'idempotency_records') and not (pg_temp.got('data')->'data' ? 'outbox_events'),
  'tabelas internas ficam fora');
select ok(pg_temp.got('data')::text !~ (select tenant_b::text from ids), 'nada do outro negócio');
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('privacy-exports', %L) $$, pg_temp.got('exp')->'body'->>'storage_path'),
  'quem pediu grava o arquivo da exportação');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('privacy-exports', %L) $$, (select tenant_a from ids)::text || '/outro.json'),
  '42501', null, 'qualquer outro caminho é recusado');
insert into r select 'fin', public.privacy_export_finish((select tenant_a from ids), (pg_temp.got('exp')->'body'->'export'->>'id')::uuid, 1234);
select is(pg_temp.got('fin')->'export'->>'status', 'ready', 'arquivo gravado: pronta');
select ok((pg_temp.got('fin')->'export'->>'expires_at')::timestamptz between now() + interval '23 hours' and now() + interval '25 hours',
  'o arquivo vale 24 h');
select is((select count(*)::int from storage.objects where bucket_id = 'privacy-exports'), 1, 'dono lê o arquivo pronto (link assinado)');
select throws_ok(format($$ select public.privacy_export_data(%L, %L) $$, (select tenant_a from ids), pg_temp.got('exp')->'body'->'export'->>'id'),
  'PT422', 'POLICY_REJECTED', 'exportação pronta não gera outro conteúdo');
insert into r select 'expc', public.privacy_export_start((select tenant_a from ids), 'customer', (select cust_a from ids), 'p57-export-a-000002', repeat('f', 64));
insert into r select 'datac', public.privacy_export_data((select tenant_a from ids), (pg_temp.got('expc')->'body'->'export'->>'id')::uuid);
select is(jsonb_array_length(pg_temp.got('datac')->'data'->'customers'), 1, 'exportação do cliente traz só o cadastro dele');
select ok(pg_temp.got('datac')::text !~ (select cust_a2::text from ids), 'nada de outro cliente do negócio');
reset role;

-- ------------------------------------------------------------------ eliminar um cliente final
update public.customers set phone = '+5511988880001', email = 'cliente@example.com' where id = (select cust_a from ids);
insert into public.receivables (id, tenant_id, customer_id, description, amount_cents)
select '57000000-0000-4000-8000-0000000000e1', tenant_a, cust_a, 'Corte', 6000 from ids;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'erc', public.privacy_erasure_request((select tenant_a from ids), 'customer', (select cust_a from ids), 'p57-erase-cust-00001', repeat('f', 64));
select is(pg_temp.got('erc')->'body'->'erasure'->>'status', 'done', 'cliente final: eliminado no pedido');
reset role;
select is((select row(name, phone, email)::text from public.customers where id = (select cust_a from ids)), '("Cliente removido",,)',
  'cadastro sem nome, telefone e e-mail');
select is((select count(*)::int from public.channel_contacts where id = '57000000-0000-4000-8000-0000000000c1'), 0, 'contato e mensagens do canal somem');
select is((select amount_cents from public.receivables where id = '57000000-0000-4000-8000-0000000000e1'), 6000::bigint, 'valores a receber continuam (sem o nome)');
select ok((select after::text from public.audit_events where action = 'privacy.erase_customer' order by id desc limit 1) !~ 'cliente@example|5511988880001',
  'trilha da eliminação sem dado pessoal');

-- ------------------------------------------------------------------ eliminar o negócio: carência e cancelamento
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'erb', public.privacy_erasure_request((select tenant_a from ids), 'business', null, 'p57-erase-biz-000001', repeat('f', 64));
select is(pg_temp.got('erb')->'body'->'erasure'->>'status', 'scheduled', 'negócio: agendado');
select ok((pg_temp.got('erb')->'body'->'erasure'->>'execute_after')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour',
  'carência de 7 dias');
select throws_ok($$ select public.privacy_erasure_request((select tenant_a from ids), 'business', null, 'p57-erase-biz-000002', repeat('f', 64)) $$,
  'PT422', 'POLICY_REJECTED', 'um pedido agendado por vez');
insert into r select 'cancel', public.privacy_erasure_cancel((select tenant_a from ids), (pg_temp.got('erb')->'body'->'erasure'->>'id')::uuid, 'p57-erase-cancel-0001', repeat('f', 64));
select is(pg_temp.got('cancel')->'body'->'erasure'->>'status', 'cancelled', 'dono cancela dentro da carência');
insert into r select 'erb2', public.privacy_erasure_request((select tenant_a from ids), 'business', null, 'p57-erase-biz-000003', repeat('f', 64));
reset role;
select is((app.privacy_erasure_tick(5)->>'done')::int, 0, 'antes da carência, nada acontece');
update public.privacy_erasures set execute_after = now() - interval '1 minute' where id = (pg_temp.got('erb2')->'body'->'erasure'->>'id')::uuid;
select is((app.privacy_erasure_tick(5)->>'done')::int, 1, 'vencida a carência, a rotina executa');
select is((select status from public.tenants where id = (select tenant_a from ids)), 'closed', 'negócio encerrado');
select is((select count(*)::int from public.customers where tenant_id = (select tenant_a from ids) and name <> 'Cliente removido'), 0,
  'todos os clientes anonimizados');
select is((select count(*)::int from public.tenant_memberships where tenant_id = (select tenant_a from ids) and active), 0, 'acesso encerrado');
select is((select published_at from public.public_profiles where tenant_id = (select tenant_a from ids)), null, 'perfil fora do ar');
select is((select name from public.customers where id = (select cust_b from ids)), 'Cliente AB (exemplo)', 'o outro negócio fica intacto');

select * from finish();
rollback;

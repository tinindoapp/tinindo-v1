-- P16 · Fiscal seletivo: elegibilidade decidida no servidor (perfil, MEI, CNPJ, representação pelos termos vistos,
-- credencial válida informada pelo provedor); emissão só em homologação até liberação do backend; emitir nunca altera
-- recebível nem caixa; uma nota viva por recebível; resultado incerto não volta a estado final errado; cancelamento com
-- motivo e resultado do provedor; pasta do mês para o contador; documento do tomador mascarado; isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana,
  '60000000-0000-4000-8000-0000000000a1'::uuid as rec1,
  '60000000-0000-4000-8000-0000000000a2'::uuid as rec2;
grant select on ids to anon, authenticated, service_role;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated, service_role;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.get_a() returns jsonb language sql as $$ select public.fiscal_get((select tenant_a from ids)) $$;
create function pg_temp.reasons() returns text language sql as $$
  select coalesce(string_agg(x, ',' order by x), '') from jsonb_array_elements_text(pg_temp.get_a()->'eligibility'->'reasons') x
$$;
create function pg_temp.emit(p_k text, p_rec uuid, p_doc text, p_amount bigint) returns jsonb language sql as $$
  select public.fiscal_emit((select tenant_a from ids), p_rec, 'Cliente Exemplo', p_doc, 'Corte de cabelo masculino', p_amount, current_date, p_k, pg_temp.h(p_k))
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.get_a(), pg_temp.reasons(), pg_temp.emit(text, uuid, text, bigint) to anon, authenticated, service_role;

insert into public.receivables (id, tenant_id, customer_id, description, amount_cents) values
  ((select rec1 from ids), (select tenant_a from ids), (select ana from ids), 'Corte', 6000),
  ((select rec2 from ids), (select tenant_a from ids), (select ana from ids), 'Corte e barba', 10000);

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'fiscal\_%'), 'RLS ligada em todas as tabelas fiscais');
select ok(not has_table_privilege('authenticated', 'public.fiscal_documents', 'select'), 'notas não são legíveis direto (documento do tomador)');
select ok(not has_table_privilege('authenticated', 'public.fiscal_profiles', 'update'), 'produção não se liga pelo app');
select ok(not has_function_privilege('authenticated', 'public.fiscal_emit_result(uuid, text, text, text, text, text, text, text)', 'execute'), 'resultado do provedor só pelo backend');
select ok(not has_function_privilege('authenticated', 'public.fiscal_credential_record(uuid, text, text, timestamptz)', 'execute'), 'status da credencial só pelo backend');
select ok(app.fsc_cnpj_ok('11222333000181') and not app.fsc_cnpj_ok('11222333000180') and not app.fsc_cnpj_ok('11111111111111'), 'CNPJ conferido pelos dígitos');

-- ------------------------------------------------------------------ elegibilidade
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.reasons(), 'credential_invalid,profile_missing,representation_missing', 'sem nada: três motivos explícitos');
select throws_ok($$ select pg_temp.emit('idem-fsc-emit-000000001', null, null, 6000) $$, 'PT422', 'POLICY_REJECTED', 'fora do caso elegível nada é enviado');
select throws_ok(format($$ select public.fiscal_profile_save(%L, 0, 'Barbearia Exemplo A ME', '11222333000180', 'mei', '3550308', '06.01', 'idem-fsc-prof-000000001', %L) $$,
  (select tenant_a from ids), pg_temp.h('p0')), 'PT400', 'VALIDATION_ERROR', 'CNPJ com dígito errado é recusado');
insert into r select 'p1', public.fiscal_profile_save((select tenant_a from ids), 0, 'Barbearia Exemplo A ME', '11.222.333/0001-81', 'simples_nacional', '3550308', '06.01',
  'idem-fsc-prof-000000002', pg_temp.h('p1'));
select is(pg_temp.got('p1')->'body'->'profile'->>'cnpj', '11222333000181', 'CNPJ guardado só com dígitos');
select ok(pg_temp.reasons() like '%regime_not_eligible%', 'Simples Nacional fora do caso elegível do piloto');
insert into r select 'p2', public.fiscal_profile_save((select tenant_a from ids), 1, 'Barbearia Exemplo A ME', '11222333000181', 'mei', '3550308', '06.01',
  'idem-fsc-prof-000000003', pg_temp.h('p2'));
select is((pg_temp.got('p2')->'body'->'profile'->>'version')::int, 2, 'perfil MEI salvo');
select throws_ok(format($$ select public.fiscal_representation_set(%L, 'grant', %L, 365, 'idem-fsc-rep-0000000001', %L) $$, (select tenant_a from ids), repeat('a', 64), pg_temp.h('r0')),
  'PT409', 'STALE_VERSION', 'autorização com termos diferentes dos vistos é recusada');
select throws_ok(format($$ select public.fiscal_representation_set(%L, 'grant', %L, 400, 'idem-fsc-rep-0000000002', %L) $$, (select tenant_a from ids), app.fsc_terms_hash(), pg_temp.h('r1')),
  'PT400', 'VALIDATION_ERROR', 'representação vale no máximo um ano');
insert into r select 'rep', public.fiscal_representation_set((select tenant_a from ids), 'grant', (pg_temp.get_a()->'terms'->>'hash'), 365, 'idem-fsc-rep-0000000003', pg_temp.h('r2'));
select ok((pg_temp.got('rep')->'body'->'representation'->>'active')::boolean, 'representação ativa');
select is(pg_temp.reasons(), 'credential_invalid', 'falta só a credencial no provedor');
reset role;
set local role service_role;
select is(public.fiscal_credential_record((select tenant_a from ids), 'homologacao', 'expired', now() - interval '1 day')->'eligibility'->>'eligible', 'false', 'credencial vencida: não elegível');
select is(public.fiscal_credential_record((select tenant_a from ids), 'homologacao', 'valid', now() + interval '1 year')->'eligibility'->>'eligible', 'true', 'credencial válida: elegível');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.get_a()->'eligibility'->>'environment', 'homologacao', 'sem caso homologado: emite em homologação');

-- ------------------------------------------------------------------ emissão: não é pagamento
select throws_ok($$ select pg_temp.emit('idem-fsc-emit-000000002', (select rec1 from ids), '12345678900', 6000) $$, 'PT400', 'VALIDATION_ERROR', 'CPF do tomador inválido é recusado');
select throws_ok($$ select pg_temp.emit('idem-fsc-emit-000000003', (select rec1 from ids), null, 7000) $$, 'PT422', 'POLICY_REJECTED', 'nota acima do recebível é recusada');
insert into r select 'e1', pg_temp.emit('idem-fsc-emit-000000004', (select rec1 from ids), '123.456.789-09', 6000);
select is((pg_temp.got('e1')->>'status_code')::int, 201, 'pedido de emissão criado');
select is(pg_temp.got('e1')->'body'->'document'->>'status', 'submitting', 'aguardando o provedor');
select is(pg_temp.got('e1')->'body'->'request'->>'taker_document', '12345678909', 'o provedor recebe o documento completo');
select is(pg_temp.got('e1')->'body'->'document'->>'taker_document_masked', '•••••••••09', 'a leitura mostra o documento mascarado');
select ok(pg_temp.emit('idem-fsc-emit-000000004', (select rec1 from ids), '123.456.789-09', 6000)->'body'->'request' is null, 'repetir a chave não gera novo envio ao provedor');
select throws_ok($$ select pg_temp.emit('idem-fsc-emit-000000005', (select rec1 from ids), null, 6000) $$, 'PT422', 'POLICY_REJECTED', 'uma nota viva por recebível');
reset role;
select is((select status || ':' || paid_cents from public.receivables where id = (select rec1 from ids)), 'open:0', 'emitir não dá baixa no recebível');
select is((select count(*)::int from public.payment_entries where tenant_id = (select tenant_a from ids)), 0, 'emitir não cria recebimento');

set local role service_role;
insert into r select 'x1', public.fiscal_emit_result((pg_temp.got('e1')->'body'->'document'->>'id')::uuid, 'unknown', null, null, null, null, null, null);
select is(pg_temp.got('x1')->'document'->>'status', 'unknown', 'resposta incerta fica incerta');
select is(jsonb_array_length(public.fiscal_sync_claim(50)->'items'), 0, 'consulta só depois de 1 minuto');
reset role;
update public.fiscal_documents set unknown_since = now() - interval '5 minutes' where id = (pg_temp.got('e1')->'body'->'document'->>'id')::uuid;
set local role service_role;
select is(public.fiscal_sync_claim(50)->'items'->0->>'provider_ref', 'nfse:' || (pg_temp.got('e1')->'body'->'document'->>'id'), 'incerta entra na consulta pela referência');
select throws_ok(format($$ select public.fiscal_emit_result(%L, 'authorized', null, null, null, null, null, null) $$, pg_temp.got('e1')->'body'->'document'->>'id'),
  'PT400', 'VALIDATION_ERROR', 'autorizada exige número e protocolo');
insert into r select 'x2', public.fiscal_emit_result((pg_temp.got('e1')->'body'->'document'->>'id')::uuid, 'authorized', 'PRT-0001', '101', 'ABCD1234',
  'https://provedor.exemplo.test/nfse/101.pdf', 'https://provedor.exemplo.test/nfse/101.xml', null);
select is(pg_temp.got('x2')->'document'->>'status', 'authorized', 'autorizada pelo provedor');
select is(public.fiscal_emit_result((pg_temp.got('e1')->'body'->'document'->>'id')::uuid, 'rejected', null, null, null, null, null, 'atrasada')->'document'->>'status', 'authorized',
  'resposta atrasada não desfaz a autorização');
reset role;
select is((select status || ':' || paid_cents from public.receivables where id = (select rec1 from ids)), 'open:0', 'nota autorizada ainda não é pagamento');
select is((select count(*)::int from public.outbox_events where event_type = 'fiscal.document.authorized.v1'), 1, 'evento de nota autorizada');
select is((select string_agg(to_status, ',' order by id) from public.fiscal_document_events where document_id = (pg_temp.got('e1')->'body'->'document'->>'id')::uuid),
  'submitting,unknown,authorized', 'linha do tempo da nota');

-- ------------------------------------------------------------------ produção só pelo backend, depois de homologar
select is(app.fsc_environment((select tenant_a from ids)), 'homologacao', 'homologado mas sem liberação: continua homologação');
update public.fiscal_profiles set production_enabled = true where tenant_id = (select tenant_a from ids);
select is(app.fsc_environment((select tenant_a from ids)), 'producao', 'homologado e liberado pelo backend: produção');
select is(app.fsc_eligibility((select tenant_a from ids))->'reasons', '["credential_invalid"]'::jsonb, 'produção exige credencial de produção');
update public.fiscal_profiles set production_enabled = false where tenant_id = (select tenant_a from ids);

-- ------------------------------------------------------------------ cancelamento
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.fiscal_cancel(%L, %L, %s, 'curto', 'idem-fsc-canc-000000001', %L) $$, (select tenant_a from ids),
  pg_temp.got('x2')->'document'->>'id', pg_temp.got('x2')->'document'->>'version', pg_temp.h('c0')), 'PT400', 'VALIDATION_ERROR', 'cancelar exige motivo');
insert into r select 'c1', public.fiscal_cancel((select tenant_a from ids), (pg_temp.got('x2')->'document'->>'id')::uuid, (pg_temp.got('x2')->'document'->>'version')::int,
  'Valor lançado errado no atendimento', 'idem-fsc-canc-000000002', pg_temp.h('c1'));
select is(pg_temp.got('c1')->'body'->'document'->>'status', 'cancel_requested', 'cancelamento pedido');
reset role;
set local role service_role;
select is(public.fiscal_cancel_result((pg_temp.got('x2')->'document'->>'id')::uuid, 'refused', 'prazo encerrado')->'document'->>'status', 'authorized', 'recusado pelo provedor: continua autorizada');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'c2', public.fiscal_cancel((select tenant_a from ids), (pg_temp.got('x2')->'document'->>'id')::uuid,
  (select (d->>'version')::int from jsonb_array_elements(pg_temp.get_a()->'documents') d where d->>'id' = pg_temp.got('x2')->'document'->>'id'),
  'Valor lançado errado no atendimento', 'idem-fsc-canc-000000003', pg_temp.h('c2'));
reset role;
set local role service_role;
select is(public.fiscal_cancel_result((pg_temp.got('x2')->'document'->>'id')::uuid, 'cancelled', null)->'document'->>'status', 'cancelled', 'cancelada no provedor');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'e2', pg_temp.emit('idem-fsc-emit-000000006', (select rec1 from ids), null, 6000);
select is(pg_temp.got('e2')->'body'->'document'->>'status', 'submitting', 'cancelada libera nova emissão para o recebível');

-- ------------------------------------------------------------------ pasta do contador
reset role;
set local role service_role;
insert into r select 'x3', public.fiscal_emit_result((pg_temp.got('e2')->'body'->'document'->>'id')::uuid, 'authorized', 'PRT-0002', '102', 'EFGH5678', null, null, null);
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'f1', public.fiscal_folder((select tenant_a from ids), to_char(current_date, 'YYYY-MM'));
select is(jsonb_array_length(pg_temp.got('f1')->'documents'), 2, 'pasta do mês: autorizada e cancelada');
select is((pg_temp.got('f1')->'totals'->>'authorized_cents')::int, 6000, 'cancelada não soma no total');
select is((pg_temp.got('f1')->'totals'->>'cancelled_count')::int, 1, 'cancelada contada à parte');
select ok((pg_temp.got('f1'))::text !~ '12345678909', 'pasta não expõe o documento completo do tomador');
select throws_ok(format($$ select public.fiscal_folder(%L, '2026-13') $$, (select tenant_a from ids)), 'PT400', 'VALIDATION_ERROR', 'mês inválido');
reset role;

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.fiscal_get(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'dono de B não vê o fiscal de A');
select is((select count(*)::int from public.fiscal_document_events where tenant_id = (select tenant_a from ids)), 0, 'RLS: dono de B não lê a linha do tempo de A');
reset role;

select * from finish();
rollback;

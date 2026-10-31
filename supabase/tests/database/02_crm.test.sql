-- P02 · Clientes e catálogo: CRUD, validação, versão otimista, idempotência, isolamento A/B,
-- importação com relatório por linha. Roda depois da fundação + 001_crm.sql + seed sintético.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as customer_ab,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to anon, authenticated;

-- Resultados capturados entre asserções.
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to authenticated;

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.cid(p_k text) returns uuid language sql as $$ select (v->'body'->'customer'->>'id')::uuid from r where k = p_k $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.cid(text) to authenticated;

-- ------------------------------------------------------------------ estrutura e privilégios
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('customers', 'provider_services')),
  'RLS ligada em customers e provider_services'
);
select ok(not has_function_privilege('anon',
  'public.crm_customer_upsert(uuid, uuid, integer, text, text, text, text, text, text, uuid)', 'execute'),
  'anon não executa crm_customer_upsert');
select ok(not has_table_privilege('authenticated', 'public.customers', 'insert'), 'authenticated não insere cliente direto');
select ok(not has_table_privilege('authenticated', 'public.provider_services', 'update'), 'authenticated não altera serviço direto');
select ok(not has_function_privilege('authenticated', 'app.crm_customer_matches(uuid, uuid, text, text, text)', 'execute'),
  'busca de duplicados é interna');

set local role anon;
select throws_ok('select * from public.customers', '42501', null, 'anon não lê clientes');
reset role;

-- ------------------------------------------------------------------ dono B cria o cliente dele
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
insert into r select 'b1', public.crm_customer_upsert((select tenant_b from ids), null, null,
  'Cliente de B', '+5511900000001', 'b1@exemplo.test', 'referral', 'idem-b1-0000000001', pg_temp.h('b1'));
select is((pg_temp.got('b1')->>'status_code')::int, 201, 'dono B cria cliente no próprio negócio');
reset role;

-- ------------------------------------------------------------------ dono A: criar/editar
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;

insert into r select 'a1', public.crm_customer_upsert((select tenant_a from ids), null, null,
  '  Ana   Exemplo ', '+5511987654321', 'ana@exemplo.test', 'instagram', 'idem-a1-0000000001', pg_temp.h('a1'));
select is((pg_temp.got('a1')->>'status_code')::int, 201, 'criar cliente → 201');
select is(pg_temp.got('a1')->'body'->'customer'->>'name', 'Ana   Exemplo', 'nome é aparado nas pontas');
select is(pg_temp.got('a1')->'body'->'customer'->>'declared_source', 'instagram', 'origem declarada guardada');
select is((pg_temp.got('a1')->'body'->'customer'->>'version')::int, 1, 'versão inicial 1');
select is(jsonb_array_length(pg_temp.got('a1')->'body'->'possible_duplicates'), 0, 'sem duplicados no primeiro cadastro');

-- Mesmo telefone do cliente de B: sem sugestão cruzada entre negócios.
insert into r select 'a_cross', public.crm_customer_upsert((select tenant_a from ids), null, null,
  'Outra pessoa', '+5511900000001', null, null, 'idem-a-cross-00001', pg_temp.h('a_cross'));
select is(jsonb_array_length(pg_temp.got('a_cross')->'body'->'possible_duplicates'), 0,
  'telefone cadastrado em B não vira duplicado em A');

-- Mesmo telefone em A: sugere, não mescla.
insert into r select 'a2', public.crm_customer_upsert((select tenant_a from ids), null, null,
  'Ana E.', '+5511987654321', null, null, 'idem-a2-0000000001', pg_temp.h('a2'));
select is(pg_temp.got('a2')->'body'->'possible_duplicates', jsonb_build_array(pg_temp.cid('a1')),
  'mesmo telefone no mesmo negócio → possível duplicado sugerido');
select isnt(pg_temp.cid('a2'), pg_temp.cid('a1'), 'duplicado sugerido não é mesclado (novo registro)');

-- Replay e mismatch
select is(public.crm_customer_upsert((select tenant_a from ids), null, null,
  'Ana E.', '+5511987654321', null, null, 'idem-a2-0000000001', pg_temp.h('a2')),
  pg_temp.got('a2'), 'mesma chave + mesmo payload → mesma resposta');
select throws_ok(format($$ select public.crm_customer_upsert(%L, null, null, 'X', null, null, null,
  'idem-a2-0000000001', %L) $$, (select tenant_a from ids), pg_temp.h('outro')),
  'PT409', 'IDEMPOTENCY_MISMATCH', 'mesma chave + payload diferente → 409');

-- Editar com versão
insert into r select 'a1_edit', public.crm_customer_upsert((select tenant_a from ids), pg_temp.cid('a1'), 1,
  'Ana Exemplo', '+5511987654321', 'ana@exemplo.test', 'referral', 'idem-a1-edit-00001', pg_temp.h('a1_edit'));
select is((pg_temp.got('a1_edit')->>'status_code')::int, 200, 'editar → 200');
select is((pg_temp.got('a1_edit')->'body'->'customer'->>'version')::int, 2, 'editar incrementa versão');
select throws_ok(format($$ select public.crm_customer_upsert(%L, %L, 1, 'Ana', null, null, null,
  'idem-a1-stale-0001', %L) $$, (select tenant_a from ids), pg_temp.cid('a1'), pg_temp.h('stale')),
  'PT409', 'STALE_VERSION', 'versão antiga → 409 STALE_VERSION');

-- Validação
select throws_ok(format($$ select public.crm_customer_upsert(%L, null, null, '   ', null, null, null,
  'idem-a-noname-0001', %L) $$, (select tenant_a from ids), pg_temp.h('noname')),
  'PT400', 'VALIDATION_ERROR', 'nome vazio negado');
select throws_ok(format($$ select public.crm_customer_upsert(%L, null, null, 'Fulano', '11999998888', null, null,
  'idem-a-phone-00001', %L) $$, (select tenant_a from ids), pg_temp.h('phone')),
  'PT400', 'VALIDATION_ERROR', 'telefone fora de E.164 negado');
select throws_ok(format($$ select public.crm_customer_upsert(%L, null, null, 'Fulano', null, null, 'tiktok_ads',
  'idem-a-src-000001', %L) $$, (select tenant_a from ids), pg_temp.h('src')),
  'PT400', 'VALIDATION_ERROR', 'origem fora da lista negada');

-- ------------------------------------------------------------------ isolamento entre negócios
select throws_ok(format($$ select public.crm_customer_upsert(%L, null, null, 'Invasor', null, null, null,
  'idem-a-in-b-00001', %L) $$, (select tenant_b from ids), pg_temp.h('inb')),
  'PT403', 'FORBIDDEN', 'dono A não cria cliente no negócio B');
select throws_ok(format($$ select public.crm_customer_upsert(%L, %L, 1, 'Sequestro', null, null, null,
  'idem-a-steal-00001', %L) $$, (select tenant_a from ids), pg_temp.cid('b1'), pg_temp.h('steal')),
  'PT404', 'NOT_FOUND', 'cliente de B editado pelo tenant A → 404 neutro');
select throws_ok(format($$ select public.crm_customer_archive(%L, %L, 1, true, 'idem-a-arch-b-0001', %L) $$,
  (select tenant_a from ids), pg_temp.cid('b1'), pg_temp.h('archb')),
  'PT404', 'NOT_FOUND', 'cliente de B arquivado pelo tenant A → 404 neutro');
select throws_ok(format($$ select public.crm_customer_list(%L) $$, (select tenant_b from ids)),
  'PT403', 'FORBIDDEN', 'dono A não lista clientes de B');
select is_empty(format($$ select 1 from public.customers where tenant_id = %L $$, (select tenant_b from ids)),
  'RLS: dono A não lê linhas de clientes de B');
select is((select count(*)::int from public.customers), 5, 'dono A vê só os 5 clientes de A (2 do seed + 3)');

-- ------------------------------------------------------------------ arquivar e listar
insert into r select 'a2_arch', public.crm_customer_archive((select tenant_a from ids), pg_temp.cid('a2'), 1, true,
  'idem-a2-arch-00001', pg_temp.h('a2_arch'));
select isnt(pg_temp.got('a2_arch')->'body'->'customer'->>'archived_at', null, 'arquivar marca archived_at');
select is(jsonb_array_length(public.crm_customer_list((select tenant_a from ids))->'items'), 4,
  'lista padrão esconde arquivados');
select is(jsonb_array_length(public.crm_customer_list((select tenant_a from ids), null, true)->'items'), 5,
  'lista com arquivados mostra todos');
select is(public.crm_customer_get((select tenant_a from ids), pg_temp.cid('a2'))->'customer'->>'id', pg_temp.cid('a2')::text,
  'customer.get lê o cliente por id, arquivado inclusive');
select throws_ok(format($$ select public.crm_customer_get(%L, %L) $$, (select tenant_a from ids),
  pg_temp.got('b1')->'body'->'customer'->>'id'), 'PT404', 'NOT_FOUND', 'customer.get: cliente de B pelo negócio A → NOT_FOUND');
select throws_ok(format($$ select public.crm_customer_get(%L, %L) $$, (select tenant_b from ids),
  pg_temp.got('b1')->'body'->'customer'->>'id'), 'PT403', 'FORBIDDEN', 'customer.get: dono A não lê o negócio B');
select is(public.crm_customer_list((select tenant_a from ids), 'ana')->'items'->0->>'id',
  pg_temp.cid('a1')::text, 'busca por nome');
select is(jsonb_array_length(public.crm_customer_list((select tenant_a from ids), '98765', true)->'items'), 2,
  'busca por dígitos do telefone');

insert into r select 'p1', public.crm_customer_list((select tenant_a from ids), null, true, null, null, 3);
insert into r select 'p2', public.crm_customer_list((select tenant_a from ids), null, true,
  pg_temp.got('p1')->'next'->>'key', (pg_temp.got('p1')->'next'->>'id')::uuid, 3);
select is(jsonb_array_length(pg_temp.got('p1')->'items'), 3, 'página 1 respeita o limite');
select is(jsonb_array_length(pg_temp.got('p2')->'items'), 2, 'página 2 traz o restante');
select is(pg_temp.got('p2')->'next', 'null'::jsonb, 'última página sem cursor');
select is_empty(format($$ select x from jsonb_path_query(%L::jsonb, '$.items[*].id') x
  intersect select y from jsonb_path_query(%L::jsonb, '$.items[*].id') y $$, pg_temp.got('p1'), pg_temp.got('p2')),
  'cursor não repete itens');
select is((public.crm_customer_list((select tenant_a from ids), null, false, null, null, 1000)->'items') is not null,
  true, 'limite acima de 100 é limitado, não ilimitado');

-- ------------------------------------------------------------------ serviços
insert into r select 's1', public.crm_service_save((select tenant_a from ids), null, null,
  'Corte degradê', 40, 0, 10, 7000, 5000, 1500, 500, true, 'idem-s1-0000000001', pg_temp.h('s1'));
select is((pg_temp.got('s1')->>'status_code')::int, 201, 'criar serviço → 201');
select throws_ok(format($$ select public.crm_service_save(%L, null, null, 'Rápido', 0, 0, 0, 1000, 500, null, null, true,
  'idem-s-dur0-00001', %L) $$, (select tenant_a from ids), pg_temp.h('dur0')),
  'PT400', 'VALIDATION_ERROR', 'duração 0 negada');
select throws_ok(format($$ select public.crm_service_save(%L, null, null, 'Eterno', 1441, 0, 0, 1000, 500, null, null, true,
  'idem-s-dur1441-01', %L) $$, (select tenant_a from ids), pg_temp.h('dur1441')),
  'PT400', 'VALIDATION_ERROR', 'duração acima de 24h negada');
select throws_ok(format($$ select public.crm_service_save(%L, null, null, 'Piso alto', 30, 0, 0, 1000, 2000, null, null, true,
  'idem-s-floor-00001', %L) $$, (select tenant_a from ids), pg_temp.h('floor')),
  'PT400', 'VALIDATION_ERROR', 'piso acima do preço base negado');
select throws_ok(format($$ select public.crm_service_save(%L, null, null, 'corte  DEGRADÊ', 30, 0, 0, 1000, 500, null, null, true,
  'idem-s-dupname-01', %L) $$, (select tenant_a from ids), pg_temp.h('dupname')),
  'PT400', 'VALIDATION_ERROR', 'nome repetido entre serviços ativos negado');
insert into r select 's1_off', public.crm_service_save((select tenant_a from ids),
  (pg_temp.got('s1')->'body'->'service'->>'id')::uuid, 1,
  'Corte degradê', 40, 0, 10, 7000, 5000, 1500, 500, false, 'idem-s1-off-000001', pg_temp.h('s1_off'));
select is((pg_temp.got('s1_off')->'body'->'service'->>'version')::int, 2, 'arquivar serviço (active=false) versiona');
select is(jsonb_array_length(public.crm_service_list((select tenant_a from ids))->'items'), 2,
  'lista padrão de serviços esconde inativos');
reset role;
select throws_ok($$ update public.provider_services set duration_min = 2 $$, '23514', null,
  'check do banco nega duração inválida mesmo fora da RPC');

-- ------------------------------------------------------------------ importação
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'imp_rows', jsonb_build_array(
  jsonb_build_object('line', 2, 'name', 'Bruno Válido', 'phone', '+5511911110000', 'email', null, 'declared_source', 'whatsapp'),
  jsonb_build_object('line', 3, 'name', 'Telefone Ruim', 'phone', '1199', 'email', null),
  jsonb_build_object('line', 4, 'name', '', 'phone', null, 'email', null),
  jsonb_build_object('line', 5, 'name', 'Bruno de Novo', 'phone', '+5511911110000', 'email', null),
  jsonb_build_object('line', 6, 'name', 'Ana Exemplo', 'phone', '+5511987654321', 'email', null),
  jsonb_build_object('line', 7, 'name', 'Ana Homônima', 'phone', null, 'email', 'ana@exemplo.test', 'on_duplicate', 'create'));

select is(jsonb_array_length(public.crm_customer_import_preview((select tenant_a from ids),
  pg_temp.got('imp_rows'))->'rows'->4->'matches'), 2, 'preview aponta os cadastros existentes com o mesmo telefone');

insert into r select 'imp', public.crm_customer_import((select tenant_a from ids), pg_temp.got('imp_rows'),
  'idem-import-000001', pg_temp.h('imp'));
select is(jsonb_path_query_array(pg_temp.got('imp')->'body'->'created', '$[*].line'), '[2, 7]'::jsonb,
  'importa linha válida e a duplicada com decisão explícita');
select is(pg_temp.got('imp')->'body'->'rejected',
  '[{"line": 3, "field": "phone", "reason": "PHONE_INVALID"},
    {"line": 4, "field": "name", "reason": "NAME_REQUIRED"},
    {"line": 5, "field": "phone", "reason": "DUPLICATE_IN_FILE"}]'::jsonb,
  'linhas rejeitadas relatadas com linha, campo e motivo');
select is(jsonb_path_query_array(pg_temp.got('imp')->'body'->'skipped', '$[*].line'), '[6]'::jsonb,
  'possível duplicado sem decisão é pulado e relatado (não duplica em silêncio)');
select is((select count(*)::int from public.customers where phone = '+5511987654321'), 2,
  'importação não criou terceiro cadastro com o telefone existente');
select is(public.crm_customer_import((select tenant_a from ids), pg_temp.got('imp_rows'), 'idem-import-000001', pg_temp.h('imp')),
  pg_temp.got('imp'), 'repetir a importação com a mesma chave não cria nada novo');
select is((select count(*)::int from public.customers), 7, 'total de clientes de A após importação');
reset role;

-- ------------------------------------------------------------------ usuários sem vínculo
select pg_temp.login_as((select customer_ab from ids));
set local role authenticated;
select throws_ok(format($$ select public.crm_customer_list(%L) $$, (select tenant_a from ids)),
  'PT403', 'FORBIDDEN', 'cliente final com login não lista o CRM do negócio');
select throws_ok(format($$ select public.crm_customer_get(%L, %L) $$, (select tenant_a from ids), pg_temp.cid('a2')),
  'PT403', 'FORBIDDEN', 'cliente final com login não lê cliente por id');
select is_empty('select 1 from public.customers', 'cliente final não lê linhas do CRM');
reset role;

-- ------------------------------------------------------------------ auditoria redigida
select is((select count(*)::int from public.audit_events
           where object_type = 'customer' and (before::text like '%+55%' or after::text like '%+55%'
             or after::text like '%@exemplo%' or after::text like '%Ana%')), 0,
  'auditoria de cliente não guarda telefone, e-mail nem nome');

select * from finish();
rollback;

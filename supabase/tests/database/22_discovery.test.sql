-- P23 · Diretório e busca local: opt-in só com perfil publicado; o cartão público só leva campos autorizados (nome só
-- com o campo escolhido, expediente só se o dono quiser, link do site só se publicado); filtros exatos e ordem
-- alfabética documentada; perfil retirado tira do diretório; suspensão só pelo backend e o dono não a desfaz; isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '10000000-0000-4000-8000-0000000000c3'::uuid as tenant_c,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a;
grant select on ids to anon, authenticated, service_role;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated, service_role;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.names(p jsonb) returns text language sql as $$
  select coalesce(string_agg(coalesce(x->>'display_name', x->>'area'), ',' order by ord), '') from jsonb_array_elements(p->'items') with ordinality t(x, ord)
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.names(jsonb) to anon, authenticated, service_role;

-- Terceiro negócio sintético (sem dono com login nos testes): perfil sem nome público.
insert into public.tenants (id, name, profession, timezone) values ((select tenant_c from ids), 'Ateliê Privado C', 'hairdresser', 'America/Sao_Paulo');
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values
  ((select tenant_b from ids), 'personal-b', 'personal_trainer', 'Vila Madalena', array['display_name', 'category', 'area'], now()),
  ((select tenant_c from ids), 'atelie-c', 'hairdresser', 'Pinheiros', array['category', 'area'], now());
insert into public.discovery_listings (tenant_id, uf, city_name, city_slug, show_hours, status, listed_at) values
  ((select tenant_b from ids), 'SP', 'São Paulo', 'sao-paulo', false, 'listed', now()),
  ((select tenant_c from ids), 'SP', 'São Paulo', 'sao-paulo', false, 'listed', now());
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select (select tenant_a from ids), (select res_a from ids), d, '09:00', '18:00' from generate_series(1, 5) d;

-- ------------------------------------------------------------------ estrutura
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'discovery_listings'), 'RLS ligada');
select ok(not has_table_privilege('anon', 'public.discovery_listings', 'select') and not has_table_privilege('authenticated', 'public.discovery_listings', 'select'), 'listagem não é legível direto');
select ok(has_function_privilege('anon', 'public.discovery_search(text, text, text, text, integer, integer)', 'execute'), 'busca pública sem login');
select ok(not has_function_privilege('authenticated', 'public.discovery_moderate(uuid, text, text)', 'execute'), 'moderação só pelo backend');
select is(app.dsc_slug('São José dos Campos'), 'sao-jose-dos-campos', 'endereço de cidade sem acento');

-- ------------------------------------------------------------------ opt-in exige perfil publicado
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.discovery_save(%L, 0, 'SP', 'São Paulo', true, true, 'idem-dsc-save-000000001', %L) $$, (select tenant_a from ids), pg_temp.h('s0')),
  'PT422', 'POLICY_REJECTED', 'sem perfil publicado não entra no diretório');
select throws_ok(format($$ select public.discovery_save(%L, 0, 'XX', 'São Paulo', true, false, 'idem-dsc-save-000000002', %L) $$, (select tenant_a from ids), pg_temp.h('s1')),
  'PT400', 'VALIDATION_ERROR', 'UF inexistente é recusada');
reset role;
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
values ((select tenant_a from ids), 'barbearia-a', 'barber', 'Pinheiros', array['display_name', 'category', 'area', 'booking_link'], now());
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 's2', public.discovery_save((select tenant_a from ids), 0, 'sp', ' São Paulo ', true, true, 'idem-dsc-save-000000003', pg_temp.h('s2'));
select is(pg_temp.got('s2')->'body'->'listing'->>'city_slug', 'sao-paulo', 'cidade normalizada');
select is(pg_temp.got('s2')->'body'->'listing'->>'uf', 'SP', 'UF em maiúsculas');
select ok((pg_temp.got('s2')->'body'->>'visible')::boolean, 'aparece no diretório');
select is(pg_temp.got('s2')->'body'->'card'->'weekdays', '[1,2,3,4,5]'::jsonb, 'expediente aparece porque o dono escolheu mostrar');
select is(pg_temp.got('s2')->'body'->'card'->>'site_path', null, 'sem site publicado, sem link de site');
reset role;

-- ------------------------------------------------------------------ busca: filtros exatos, ordem documentada, só campos autorizados
set local role anon;
insert into r select 'q1', public.discovery_search('SP', 'sao-paulo', null, null, null, 1);
select is((pg_temp.got('q1')->>'total')::int, 3, 'três negócios listados em São Paulo');
select is(pg_temp.names(pg_temp.got('q1')), 'Barbearia Exemplo A,Personal Exemplo B,Pinheiros', 'ordem alfabética do nome exibido (sem nome público, vale a área)');
select ok((pg_temp.got('q1'))::text !~ '(Ateliê Privado|exemplo\.test|phone|email|price)', 'nome privado, contatos e preços nunca saem');
select is(pg_temp.got('q1')->'criteria'->>'order', 'ordem alfabética do nome exibido', 'critério de ordem documentado na resposta');
select ok(pg_temp.got('q1')->'criteria'->'never' ? 'destaque pago', 'sem destaque pago (declarado)');
select is((public.discovery_search('SP', 'sao-paulo', 'hairdresser', null, null, 1)->>'total')::int, 1, 'filtro por profissão exato');
select is((public.discovery_search('SP', 'sao-paulo', null, 'pinheiros', null, 1)->>'total')::int, 2, 'bairro contido na área do perfil');
select is(pg_temp.names(public.discovery_search('SP', 'sao-paulo', null, null, 3, 1)), 'Barbearia Exemplo A', 'dia da semana: só quem mostra o expediente e atende');
select is((public.discovery_search('SP', 'sao-paulo', null, null, 0, 1)->>'total')::int, 0, 'domingo: ninguém com expediente mostrado');
select is((public.discovery_search('RJ', 'sao-paulo', null, null, null, 1)->>'total')::int, 0, 'UF diferente não mistura cidades homônimas');
select throws_ok($$ select public.discovery_search('SP', 'São Paulo', null, null, null, 1) $$, 'PT400', 'VALIDATION_ERROR', 'endereço de cidade inválido');
select is(public.discovery_cities(null)->'cities'->0->>'count', '3', 'índice de cidades conta os listados');
reset role;

-- ------------------------------------------------------------------ perfil retirado e site publicado
update public.public_profiles set published_at = null where tenant_id = (select tenant_b from ids);
select is((public.discovery_search('SP', 'sao-paulo', null, null, null, 1)->>'total')::int, 2, 'perfil retirado do ar sai do diretório');
insert into public.presence_sites (tenant_id, status, published_version_no) values ((select tenant_a from ids), 'published', 1);
select is(public.discovery_search('SP', 'sao-paulo', 'barber', null, null, 1)->'items'->0->>'site_path', '/s/barbearia-a', 'com site publicado (P17), o cartão leva ao site');

-- ------------------------------------------------------------------ moderação
set local role service_role;
select is(public.discovery_moderate((select tenant_a from ids), 'suspend', 'Denúncia em análise')->'listing'->>'status', 'suspended', 'backend suspende');
reset role;
select is((public.discovery_search('SP', 'sao-paulo', null, null, null, 1)->>'total')::int, 1, 'suspenso some da busca');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 's3', public.discovery_save((select tenant_a from ids), (pg_temp.got('s2')->'body'->'listing'->>'version')::int + 1, 'SP', 'São Paulo', true, true, 'idem-dsc-save-000000004', pg_temp.h('s3'));
select is(pg_temp.got('s3')->'body'->'listing'->>'status', 'suspended', 'o dono não desfaz a suspensão');
reset role;

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.discovery_get(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'dono de B não vê a listagem de A');
select throws_ok(format($$ select public.discovery_save(%L, 1, 'SP', 'Campinas', false, false, 'idem-dsc-save-b00000001', %L) $$, (select tenant_a from ids), pg_temp.h('b1')),
  'PT403', 'FORBIDDEN', 'dono de B não altera a listagem de A');
reset role;

select * from finish();
rollback;

-- P17 · Presença digital: site como projeção pública (só perfil P09 publicado e serviços marcados; nada de CRM, piso
-- ou custo); publicação aprovada pelo hash da prévia, versionada e reversível (tirar do ar, voltar versão); preço novo
-- não muda versão publicada; perfil retirado derruba o site. Domínio do cliente verificado por DNS observado pelo
-- backend, um dono por nome verificado. Google só com acesso de gerente concedido pelo dono; entrega com evidência.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as op1,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '40000000-0000-4000-8000-0000000000a2'::uuid as barba_a,
  '40000000-0000-4000-8000-0000000000b1'::uuid as svc_b;
grant select on ids to anon, authenticated, service_role;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated, service_role;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.get_a() returns jsonb language sql as $$ select public.presence_get((select tenant_a from ids)) $$;
create function pg_temp.publish(p_k text, p_hash text) returns jsonb language sql as $$
  select public.presence_site_publish((select tenant_a from ids), p_hash, p_k, pg_temp.h(p_k))
$$;
create function pg_temp.pub(p_slug text) returns jsonb language sql as $$ select public.presence_public_site(p_slug) $$;
create function pg_temp.host(p_host text) returns jsonb language sql as $$ select public.presence_public_site(null, p_host) $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.get_a(), pg_temp.publish(text, text), pg_temp.pub(text), pg_temp.host(text)
  to anon, authenticated, service_role;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'presence\_%'), 'RLS ligada em todas as tabelas de presença');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'presence\_%'),
  7, 'sete tabelas');
select ok(not has_table_privilege('authenticated', 'public.presence_sites', 'insert'), 'site só muda pela RPC');
select ok(not has_table_privilege('authenticated', 'public.presence_domains', 'select'), 'domínios não são legíveis direto');
select ok(not has_function_privilege('authenticated', 'public.presence_domain_record_check(uuid, text[], boolean)', 'execute'), 'resultado do DNS só pelo backend');
select ok(has_function_privilege('anon', 'public.presence_public_site(text, text)', 'execute'), 'página pública legível sem login');
select ok(not has_function_privilege('anon', 'public.presence_get(uuid)', 'execute'), 'painel do dono exige login');

-- ------------------------------------------------------------------ sem perfil publicado não há site
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.get_a()->'preview', 'null'::jsonb, 'sem perfil publicado (P09) não há prévia');
select throws_ok($$ select pg_temp.publish('idem-prs-pub-0000000001', repeat('0', 64)) $$, 'PT422', 'POLICY_REJECTED', 'publicar sem perfil publicado é recusado');
reset role;
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
values ((select tenant_a from ids), 'barbearia-a', 'barber', 'Centro', array['display_name', 'category', 'area', 'booking_link'], now());
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select (select tenant_a from ids), (select res_a from ids), d, '09:00', '18:00' from generate_series(1, 5) d;

-- ------------------------------------------------------------------ rascunho e prévia
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'save1', public.presence_site_save((select tenant_a from ids), 0, '  Corte e barba no Centro  ', array['services', 'prices', 'hours', 'booking'], 'papel',
  array[(select barba_a from ids), (select corte_a from ids)], 'idem-prs-save-000000001', pg_temp.h('save1'));
select is((pg_temp.got('save1')->>'status_code')::int, 200, 'rascunho salvo');
select is((pg_temp.got('save1')->'body'->'site'->>'version')::int, 1, 'versão 1 do rascunho');
select is(pg_temp.got('save1')->'body'->'site'->>'headline', 'Corte e barba no Centro', 'título sem espaços nas pontas');
select throws_ok(format($$ select public.presence_site_save(%L, 0, 'x', array['services'], 'papel', null, 'idem-prs-save-000000002', %L) $$, (select tenant_a from ids), pg_temp.h('s2')),
  'PT409', 'STALE_VERSION', 'salvar com versão antiga não passa');
select throws_ok(format($$ select public.presence_site_save(%L, 1, 'x', array['services'], 'papel', array[%L::uuid], 'idem-prs-save-000000003', %L) $$, (select tenant_a from ids), (select svc_b from ids), pg_temp.h('s3')),
  'PT422', 'POLICY_REJECTED', 'serviço de outro negócio não entra no site');
insert into r select 'g1', pg_temp.get_a();
select is(pg_temp.got('g1')->'preview'->>'display_name', 'Barbearia Exemplo A', 'prévia usa o nome público do perfil');
select is(jsonb_array_length(pg_temp.got('g1')->'preview'->'services'), 2, 'dois serviços marcados');
select is((pg_temp.got('g1')->'preview'->'services'->0->>'price_cents')::int, 4000, 'preço base aparece com a seção de preços, na ordem escolhida pelo dono');
select is(jsonb_array_length(pg_temp.got('g1')->'preview'->'hours'), 5, 'expediente de segunda a sexta');
select is(pg_temp.got('g1')->'preview'->>'booking_path', '/p/barbearia-a', 'link de agendamento vai para o perfil público');
select ok((pg_temp.got('g1')->'preview')::text !~ '(4500|3000|1500|estimated|min_price|Cliente|exemplo\.test)', 'prévia não leva piso, custo, clientes nem contatos');
select is(pg_temp.got('g1')->'preview'->>'bio', null, 'bio só com o campo escolhido no perfil');

-- ------------------------------------------------------------------ publicar = aprovar o hash visto
select throws_ok($$ select pg_temp.publish('idem-prs-pub-0000000002', repeat('a', 64)) $$, 'PT409', 'STALE_VERSION', 'hash diferente da prévia: nada é publicado');
insert into r select 'p1', pg_temp.publish('idem-prs-pub-0000000003', pg_temp.got('g1')->>'preview_hash');
select is((pg_temp.got('p1')->>'status_code')::int, 201, 'site publicado');
select is((pg_temp.got('p1')->'body'->'published'->>'version_no')::int, 1, 'versão 1 publicada');
select is(pg_temp.got('p1')->'body'->'published'->>'snapshot_hash', pg_temp.got('g1')->>'preview_hash', 'publicado é exatamente o que foi visto');
select is(pg_temp.publish('idem-prs-pub-0000000003', pg_temp.got('g1')->>'preview_hash')->'body'->'published'->>'version_no', '1', 'repetir a chave não cria outra versão');
select is((pg_temp.publish('idem-prs-pub-0000000099', pg_temp.got('g1')->>'preview_hash')->>'status_code')::int, 200, 'mesmo conteúdo com outra chave: já está no ar, nenhuma versão nova');
reset role;
select is((select count(*)::int from public.presence_site_versions where tenant_id = (select tenant_a from ids)), 1, 'uma versão gravada');
select throws_ok($$ update public.presence_site_versions set snapshot = '{}' $$, 'PT403', 'FORBIDDEN', 'versão publicada é append-only');
set local role anon;
select is(pg_temp.pub('barbearia-a')->'site'->>'headline', 'Corte e barba no Centro', 'página pública mostra a versão aprovada');
select throws_ok($$ select pg_temp.pub('outro-slug') $$, 'PT404', 'NOT_FOUND', 'endereço sem site publicado: 404');
reset role;

-- ------------------------------------------------------------------ preço novo não muda o publicado; nova aprovação muda
update public.provider_services set base_price_cents = 4500, min_price_cents = 3000 where id = (select barba_a from ids);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'g2', pg_temp.get_a();
select isnt(pg_temp.got('g2')->>'preview_hash', pg_temp.got('g1')->>'preview_hash', 'mudou o preço: a prévia muda de hash');
select is((pg_temp.got('g2')->'published'->'snapshot'->'services'->0->>'price_cents')::int, 4000, 'versão publicada não muda sozinha');
select throws_ok(format($$ select pg_temp.publish('idem-prs-pub-0000000004', %L) $$, pg_temp.got('g1')->>'preview_hash'), 'PT409', 'STALE_VERSION', 'aprovação antiga não publica conteúdo novo');
insert into r select 'p2', pg_temp.publish('idem-prs-pub-0000000005', pg_temp.got('g2')->>'preview_hash');
select is((pg_temp.got('p2')->'body'->'published'->>'version_no')::int, 2, 'versão 2 publicada');
set local role anon;
select is((pg_temp.pub('barbearia-a')->'site'->'services'->0->>'price_cents')::int, 4500, 'público vê o preço aprovado na versão 2');
reset role;

-- ------------------------------------------------------------------ reversível: tirar do ar e voltar uma versão
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'u1', public.presence_site_unpublish((select tenant_a from ids), (pg_temp.get_a()->'site'->>'version')::int, 'idem-prs-unpub-00000001', pg_temp.h('u1'));
select is(pg_temp.got('u1')->'body'->'site'->>'status', 'unpublished', 'site fora do ar');
set local role anon;
select throws_ok($$ select pg_temp.pub('barbearia-a') $$, 'PT404', 'NOT_FOUND', 'fora do ar: página pública some');
set local role authenticated;
insert into r select 'rs1', public.presence_site_restore((select tenant_a from ids), 1, (pg_temp.get_a()->'site'->>'version')::int, 'idem-prs-rest-000000001', pg_temp.h('rs1'));
select is((pg_temp.got('rs1')->'body'->'published'->>'version_no')::int, 1, 'voltou para a versão 1');
set local role anon;
select is((pg_temp.pub('barbearia-a')->'site'->'services'->0->>'price_cents')::int, 4000, 'público vê de novo a versão 1 como foi aprovada');
reset role;
update public.public_profiles set published_at = null where tenant_id = (select tenant_a from ids);
set local role anon;
select throws_ok($$ select pg_temp.pub('barbearia-a') $$, 'PT404', 'NOT_FOUND', 'perfil retirado do ar derruba o site (escopo do P09)');
reset role;
update public.public_profiles set published_at = now() where tenant_id = (select tenant_a from ids);
select is((select string_agg(kind, ',' order by created_at, id) from public.presence_deliveries where tenant_id = (select tenant_a from ids)),
  'site_published,site_published,site_unpublished,site_restored', 'cada passo vira entrega registrada');
select ok((select bool_and(evidence ? 'version_no') from public.presence_deliveries where tenant_id = (select tenant_a from ids)), 'entregas do site trazem a versão como evidência');

-- ------------------------------------------------------------------ domínio do cliente
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'd1', public.presence_domain_add((select tenant_a from ids), ' Barbearia-A.com.br ', 'idem-prs-dom-0000000001', pg_temp.h('d1'));
select is(pg_temp.got('d1')->'body'->'domain'->>'hostname', 'barbearia-a.com.br', 'nome normalizado');
select is(pg_temp.got('d1')->'body'->'domain'->>'status', 'pending', 'aguarda verificação');
select is(pg_temp.got('d1')->'body'->'domain'->>'txt_name', '_tinindo-verify.barbearia-a.com.br', 'registro TXT a criar');
select throws_ok(format($$ select public.presence_domain_add(%L, 'outro.com.br', 'idem-prs-dom-0000000002', %L) $$, (select tenant_a from ids), pg_temp.h('d2')),
  'PT422', 'POLICY_REJECTED', 'um domínio por negócio');
reset role;
set local role service_role;
insert into r select 'c1', public.presence_domain_record_check((pg_temp.got('d1')->'body'->'domain'->>'id')::uuid, array['v=spf1 -all', 'tinindo-verify=errado']);
select is(pg_temp.got('c1')->>'result', 'not_found', 'TXT errado: não verifica');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.presence_domain_check_target(%L, %L) $$, (select tenant_a from ids), pg_temp.got('d1')->'body'->'domain'->>'id'),
  'PT429', 'QUOTA_EXCEEDED', 'nova consulta só depois do intervalo');
reset role;
set local role service_role;
insert into r select 'c2', public.presence_domain_record_check((pg_temp.got('d1')->'body'->'domain'->>'id')::uuid, array[pg_temp.got('d1')->'body'->'domain'->>'txt_value']);
select is(pg_temp.got('c2')->>'result', 'found', 'TXT certo: verificado pelo backend');
select is(pg_temp.host('BARBEARIA-A.com.br')->'site'->>'slug', 'barbearia-a', 'domínio verificado abre o site publicado');
reset role;
select is((select evidence->>'txt_value' from public.presence_deliveries where kind = 'domain_verified'), pg_temp.got('d1')->'body'->'domain'->>'txt_value', 'entrega do domínio traz o registro observado');
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.presence_domain_add(%L, 'barbearia-a.com.br', 'idem-prs-dom-b00000001', %L) $$, (select tenant_b from ids), pg_temp.h('db1')),
  'PT422', 'POLICY_REJECTED', 'nome verificado por outro negócio não pode ser ligado');
select throws_ok(format($$ select public.presence_domain_add(%L, 'site.tinindo.app', 'idem-prs-dom-b00000002', %L) $$, (select tenant_b from ids), pg_temp.h('db2')),
  'PT422', 'POLICY_REJECTED', 'domínio da Tinindo não é domínio do cliente');
-- B prepara o mesmo nome enquanto A ainda não verificou de novo: quem verificar primeiro fica; o outro vê "taken".
reset role;
insert into r select 'dv', to_jsonb((select version from public.presence_domains where id = (pg_temp.got('d1')->'body'->'domain'->>'id')::uuid));
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rm1', public.presence_domain_remove((select tenant_a from ids), (pg_temp.got('d1')->'body'->'domain'->>'id')::uuid,
  pg_temp.got('dv')::text::int, 'idem-prs-dom-rm0000001', pg_temp.h('rm1'));
select is(pg_temp.got('rm1')->'body'->'domain', 'null'::jsonb, 'domínio desligado');
set local role anon;
select throws_ok($$ select pg_temp.host('barbearia-a.com.br') $$, 'PT404', 'NOT_FOUND', 'desligado: o nome não abre mais o site');
set local role authenticated;
insert into r select 'd3', public.presence_domain_add((select tenant_a from ids), 'barbearia-a.com.br', 'idem-prs-dom-0000000003', pg_temp.h('d3'));
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
insert into r select 'db3', public.presence_domain_add((select tenant_b from ids), 'barbearia-a.com.br', 'idem-prs-dom-b00000003', pg_temp.h('db3'));
reset role;
set local role service_role;
select is(public.presence_domain_record_check((pg_temp.got('db3')->'body'->'domain'->>'id')::uuid, array[pg_temp.got('db3')->'body'->'domain'->>'txt_value'])->>'result', 'found', 'B verificou primeiro');
select is(public.presence_domain_record_check((pg_temp.got('d3')->'body'->'domain'->>'id')::uuid, array[pg_temp.got('d3')->'body'->'domain'->>'txt_value'])->>'result', 'taken', 'A vê o nome tomado: um dono por nome verificado');
reset role;

-- ------------------------------------------------------------------ Google: acesso delegado e revogável
insert into public.platform_operators (user_id, display_name) values ((select op1 from ids), 'Operadora (exemplo)');
select pg_temp.login_as((select op1 from ids));
set local role authenticated;
select throws_ok(format($$ select public.presence_delivery_record(%L, 'google_post', 'Post de horário de feriado', 'https://maps.app.goo.gl/exemplo', null, 'idem-prs-op-00000000001', %L) $$,
  (select tenant_a from ids), pg_temp.h('op1')), 'PT422', 'POLICY_REJECTED', 'sem acesso concedido pelo dono, nada no Google');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.presence_google_set(%L, 'grant', 'Barbearia Exemplo A', 'https://exemplo.test/maps', 0, 'idem-prs-g-000000000001', %L) $$, (select tenant_a from ids), pg_temp.h('g1')),
  'PT400', 'VALIDATION_ERROR', 'link do perfil precisa ser do Google Maps');
insert into r select 'gg', public.presence_google_set((select tenant_a from ids), 'grant', 'Barbearia Exemplo A', 'https://maps.app.goo.gl/exemplo', 0, 'idem-prs-g-000000000002', pg_temp.h('g2'));
select is(pg_temp.got('gg')->'body'->'google'->>'status', 'granted', 'acesso de gerente registrado');
select is(pg_temp.got('gg')->'body'->'google'->>'access_level', 'manager', 'gerente, nunca proprietária');
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.presence_delivery_record(%L, 'google_post', 'x', 'https://maps.app.goo.gl/exemplo', null, 'idem-prs-op-b0000000001', %L) $$,
  (select tenant_a from ids), pg_temp.h('opb')), 'PT403', 'FORBIDDEN', 'quem não é operador não registra entrega');
select throws_ok(format($$ select public.presence_get(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'dono de B não vê a presença de A');
select is((select count(*)::int from public.presence_deliveries where tenant_id = (select tenant_a from ids)), 0, 'RLS: dono de B não lê entregas de A');
reset role;
select pg_temp.login_as((select op1 from ids));
set local role authenticated;
select throws_ok(format($$ select public.presence_delivery_record(%L, 'google_post', 'x', 'http://sem-tls.exemplo', null, 'idem-prs-op-00000000002', %L) $$,
  (select tenant_a from ids), pg_temp.h('op2')), 'PT400', 'VALIDATION_ERROR', 'evidência precisa de link https');
insert into r select 'op3', public.presence_delivery_record((select tenant_a from ids), 'google_post', 'Post de horário de feriado publicado no perfil.', 'https://maps.app.goo.gl/exemplo', null,
  'idem-prs-op-00000000003', pg_temp.h('op3'));
select is(pg_temp.got('op3')->'body'->'delivery'->>'actor', 'operator', 'entrega registrada pela operação com evidência');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'gr', public.presence_google_set((select tenant_a from ids), 'revoke', null, null, (pg_temp.got('gg')->'body'->'google'->>'version')::int, 'idem-prs-g-000000000003', pg_temp.h('g3'));
select is(pg_temp.got('gr')->'body'->'google'->>'status', 'revoked', 'dono revogou');
reset role;
select pg_temp.login_as((select op1 from ids));
set local role authenticated;
select throws_ok(format($$ select public.presence_delivery_record(%L, 'google_post', 'x', 'https://maps.app.goo.gl/exemplo', null, 'idem-prs-op-00000000004', %L) $$,
  (select tenant_a from ids), pg_temp.h('op4')), 'PT422', 'POLICY_REJECTED', 'revogado: nada mais no Google');
reset role;

-- ------------------------------------------------------------------ eventos
select is((select count(*)::int from public.outbox_events where event_type = 'presence.site.published.v1' and tenant_id = (select tenant_a from ids)), 2, 'evento por publicação aprovada');
select is((select count(*)::int from public.outbox_events where event_type = 'presence.domain.verified.v1'), 2, 'evento por domínio verificado');

select * from finish();
rollback;

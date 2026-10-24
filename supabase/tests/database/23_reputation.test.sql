-- P24 · Avaliações e verificação: só quem teve atendimento concluído e vínculo ativo avalia, uma vez, dentro de 30 dias;
-- outra pessoa nem descobre o atendimento; profissional responde mas não muda nota nem texto; denúncia não esconde
-- sozinha, só a moderação (backend); média só com 3+; selos separados (identidade, atendimentos, competência = falso);
-- público nunca vê o autor; perfil público (P09) passa a refletir as avaliações; isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'c0000000-0000-4000-8000-0000000000ab'::uuid as cust_user,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as outsider,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as cust_a,
  '30000000-0000-4000-8000-0000000000a2'::uuid as walkin_a,
  '80000000-0000-4000-8000-0000000000b1'::uuid as bk1,
  '80000000-0000-4000-8000-0000000000b2'::uuid as bk2,
  '80000000-0000-4000-8000-0000000000b3'::uuid as bk_old,
  '80000000-0000-4000-8000-0000000000b4'::uuid as bk_future,
  '80000000-0000-4000-8000-0000000000b5'::uuid as bk_walkin;
grant select on ids to anon, authenticated, service_role;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated, service_role;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
grant execute on function pg_temp.h(text), pg_temp.got(text) to anon, authenticated, service_role;

-- Atendimentos de A: dois concluídos recentes da cliente vinculada, um antigo (fora da janela), um confirmado no futuro,
-- um concluído de cliente sem login.
insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at)
values ((select tenant_a from ids), (select cust_a from ids), (select cust_user from ids), 'owner_invite_code', now());
insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source)
select x.id, (select tenant_a from ids), (select res_a from ids), x.cust, (select corte_a from ids), x.s, x.s + interval '30 minutes',
  tstzrange(x.s, x.s + interval '40 minutes', '[)'), x.st in ('confirmed', 'completed'), x.st, 'owner'
from (values
  ((select bk1 from ids), (select cust_a from ids), now() - interval '3 days', 'completed'),
  ((select bk2 from ids), (select cust_a from ids), now() - interval '10 days', 'completed'),
  ((select bk_old from ids), (select cust_a from ids), now() - interval '45 days', 'completed'),
  ((select bk_future from ids), (select cust_a from ids), now() + interval '3 days', 'confirmed'),
  ((select bk_walkin from ids), (select walkin_a from ids), now() - interval '5 days', 'completed')) as x(id, cust, s, st);
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
values ((select tenant_a from ids), 'barbearia-a', 'barber', 'Pinheiros', array['display_name', 'category', 'area'], now());

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('reviews', 'review_reports', 'identity_verifications')), 'RLS ligada');
select ok(not has_table_privilege('authenticated', 'public.reviews', 'select'), 'avaliações não são legíveis direto (autor protegido)');
select ok(not has_table_privilege('authenticated', 'public.reviews', 'update'), 'ninguém edita avaliação direto');
select ok(not has_function_privilege('authenticated', 'public.review_moderate(uuid, text, text)', 'execute'), 'moderação só pelo backend');
select ok(not has_function_privilege('authenticated', 'public.identity_verify_set(uuid, text, text, text)', 'execute'), 'identidade verificada só pela equipe');
select ok(has_function_privilege('anon', 'public.review_public_list(text)', 'execute'), 'lista pública sem login');

-- ------------------------------------------------------------------ quem pode avaliar
select pg_temp.login_as((select cust_user from ids));
set local role authenticated;
insert into r select 'pend', public.review_pending();
select is(jsonb_array_length(pg_temp.got('pend')->'pending'), 2, 'só os dois concluídos recentes aparecem para avaliar');
select ok((pg_temp.got('pend'))::text !~ (select bk_old::text from ids), 'fora da janela de 30 dias não aparece');
select throws_ok(format($$ select public.review_submit(%L, 5, 'Ótimo') $$, (select bk_old from ids)), 'PT422', 'POLICY_REJECTED', 'mais de 30 dias: recusado');
select throws_ok(format($$ select public.review_submit(%L, 5, 'Ótimo') $$, (select bk_future from ids)), 'PT422', 'POLICY_REJECTED', 'atendimento não concluído: recusado');
select throws_ok(format($$ select public.review_submit(%L, 6, 'Ótimo') $$, (select bk1 from ids)), 'PT400', 'VALIDATION_ERROR', 'nota de 1 a 5');
insert into r select 'rv1', public.review_submit((select bk1 from ids), 5, '  Corte impecável e no horário.  ');
select is(pg_temp.got('rv1')->'review'->>'body', 'Corte impecável e no horário.', 'avaliação registrada');
select is(pg_temp.got('rv1')->'review'->>'verified_booking', 'true', 'marcada como atendimento verificado');
select is(public.review_submit((select bk1 from ids), 5, 'Corte impecável e no horário.')->'review'->>'id', pg_temp.got('rv1')->'review'->>'id', 'repetir o mesmo envio devolve a mesma');
select throws_ok(format($$ select public.review_submit(%L, 1, 'Mudei de ideia') $$, (select bk1 from ids)), 'PT422', 'POLICY_REJECTED', 'uma avaliação por atendimento');
reset role;
select pg_temp.login_as((select outsider from ids));
set local role authenticated;
select throws_ok(format($$ select public.review_submit(%L, 1, 'Péssimo') $$, (select bk2 from ids)), 'PT404', 'NOT_FOUND', 'quem não é a cliente nem descobre o atendimento');
select throws_ok(format($$ select public.review_submit(%L, 1, 'Péssimo') $$, (select bk_walkin from ids)), 'PT404', 'NOT_FOUND', 'cliente sem login vinculado não é avaliável por terceiros');
select is(jsonb_array_length(public.review_pending()->'pending'), 0, 'sem vínculo, nada para avaliar');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.review_submit(%L, 5, 'Sou ótimo') $$, (select bk2 from ids)), 'PT404', 'NOT_FOUND', 'o profissional não avalia o próprio atendimento');
reset role;

-- ------------------------------------------------------------------ dono: responde, não edita
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'own', public.review_owner_list((select tenant_a from ids));
select is(jsonb_array_length(pg_temp.got('own')->'reviews'), 1, 'dono vê a avaliação recebida');
select ok((pg_temp.got('own'))::text !~ (select cust_user::text from ids) and (pg_temp.got('own'))::text !~ 'Cliente AB', 'nem o dono vê quem escreveu (só "atendimento verificado")');
insert into r select 'rp', public.review_reply((select tenant_a from ids), (pg_temp.got('rv1')->'review'->>'id')::uuid, 1, 'Obrigado pela visita!', 'idem-rep-reply-0000001', pg_temp.h('rp'));
select is(pg_temp.got('rp')->'body'->'review'->'reply'->>'body', 'Obrigado pela visita!', 'resposta publicada');
select is((pg_temp.got('rp')->'body'->'review'->>'rating')::int, 5, 'nota do cliente intacta');
select throws_ok(format($$ select public.review_reply(%L, %L, 1, 'outra', 'idem-rep-reply-0000002', %L) $$, (select tenant_a from ids), pg_temp.got('rv1')->'review'->>'id', pg_temp.h('rp2')),
  'PT409', 'STALE_VERSION', 'responder com versão antiga não passa');
reset role;

-- ------------------------------------------------------------------ denúncia e moderação
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'rep1', public.review_report((pg_temp.got('rv1')->'review'->>'id')::uuid, 'personal_data', 'Cita meu telefone');
select is(pg_temp.got('rep1')->'report'->>'status', 'open', 'denúncia aberta');
select is(public.review_report((pg_temp.got('rv1')->'review'->>'id')::uuid, 'personal_data', null)->'report'->>'id', pg_temp.got('rep1')->'report'->>'id', 'denunciar de novo não duplica');
reset role;
set local role anon;
select is(jsonb_array_length(public.review_public_list('barbearia-a')->'reviews'), 1, 'denunciar não esconde nada sozinho');
reset role;
set local role service_role;
select throws_ok(format($$ select public.review_moderate(%L, 'upheld', null) $$, pg_temp.got('rep1')->'report'->>'id'), 'PT400', 'VALIDATION_ERROR', 'moderação exige motivo');
select is(public.review_moderate((pg_temp.got('rep1')->'report'->>'id')::uuid, 'dismissed', 'Sem dado pessoal no texto')->>'report_status', 'dismissed', 'improcedente: continua publicada');
reset role;

-- ------------------------------------------------------------------ média, selos e perfil público
select pg_temp.login_as((select cust_user from ids));
set local role authenticated;
insert into r select 'rv2', public.review_submit((select bk2 from ids), 3, null);
reset role;
set local role anon;
insert into r select 'pub', public.review_public_list('barbearia-a');
select is((pg_temp.got('pub')->'summary'->>'reviews_count')::int, 2, 'duas avaliações publicadas');
select is(pg_temp.got('pub')->'summary'->>'rating_average', null, 'menos de 3 avaliações: sem média');
select is(pg_temp.got('pub')->'summary'->>'certified_competence', 'false', 'competência certificada não existe ainda (P39)');
select is(pg_temp.got('pub')->'summary'->>'identity_verified', 'false', 'identidade não verificada');
select is((pg_temp.got('pub')->'summary'->>'completed_bookings')::int, 4, 'atendimentos verificados contam o que foi concluído');
select ok((pg_temp.got('pub'))::text !~ '(c0000000|Cliente AB|exemplo\.test)', 'público nunca vê o autor');
select is((public.network_public_profile('barbearia-a')->'reputation'->>'reviews_count')::int, 2, 'perfil público (P09) mostra as avaliações verificadas');
reset role;
set local role service_role;
select is(public.identity_verify_set((select tenant_a from ids), 'verify', 'gov_br', 'Equipe Tinindo')->>'identity_verified', 'true', 'equipe verifica a identidade');
reset role;
set local role anon;
select is(public.network_public_profile('barbearia-a')->'reputation'->>'identity_verified', 'true', 'perfil mostra identidade verificada, separada de avaliações');
reset role;

-- ------------------------------------------------------------------ autor retira; isolamento
select pg_temp.login_as((select cust_user from ids));
set local role authenticated;
select is(public.review_withdraw((pg_temp.got('rv2')->'review'->>'id')::uuid)->'review'->>'status', 'withdrawn', 'autor retira a própria avaliação');
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.review_owner_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'dono de B não vê avaliações de A pelo painel');
reset role;

select * from finish();
rollback;

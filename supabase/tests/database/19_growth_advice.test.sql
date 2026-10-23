-- P22 · Metas e conteúdo: meta mensal por indicador do P18 com progresso = o indicador (denominador explícito;
-- insuficiente ≠ zero); uma meta ativa por indicador e mês; versão; arquivar. Sugestões só por regras sobre dado
-- existente e suficiente, com evidência; decisão do dono registrada uma vez por mês; acompanhamento em 30 dias como
-- variação observada. Conteúdo pré-aprovado por profissão; publicação só com perfil publicado e campo `bio` escolhido
-- (P09); projeção pública ganha `bio`; isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.goal(p_k text, p_id uuid, p_ver integer, p_metric text, p_target numeric, p_note text) returns jsonb language sql as $$
  select public.goal_save((select tenant_a from ids), p_id, p_ver, p_metric, p_target, null, p_note, p_k, pg_temp.h(p_k))
$$;
create function pg_temp.gid(p_k text) returns uuid language sql as $$ select (v->'body'->'goal'->>'id')::uuid from r where k = p_k $$;
create function pg_temp.rules() returns text language sql as $$
  select coalesce(string_agg(x->>'rule_code', ',' order by x->>'rule_code'), '') from jsonb_array_elements(public.advice_list((select tenant_a from ids))->'suggestions') x
$$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.goal(text, uuid, integer, text, numeric, text), pg_temp.gid(text), pg_temp.rules() to anon, authenticated;

-- ------------------------------------------------------------------ estrutura
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('goals', 'advice_decisions', 'content_templates', 'profile_contents')), 'RLS ligada em metas e conteúdo');
select ok(not has_table_privilege('authenticated', 'public.goals', 'insert'), 'dono não cria meta direto');
select ok(not has_table_privilege('authenticated', 'public.content_templates', 'insert'), 'conteúdo aprovado só entra por migration');
select ok(not has_table_privilege('authenticated', 'public.profile_contents', 'insert'), 'publicação só pela RPC (escopo do P09)');
select ok(not has_function_privilege('authenticated', 'app.ga_tick(integer)', 'execute'), 'acompanhamento só do backend');
select is((select count(*)::int from public.content_templates), 9, 'nove textos aprovados');

-- ------------------------------------------------------------------ metas sem dado: insuficiente ≠ zero
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'g1', pg_temp.goal('idem-goal-000000000001', null, null, 'no_show', 0.1, 'Menos faltas');
select is((pg_temp.got('g1')->>'status_code')::int, 201, 'meta criada');
select is(pg_temp.got('g1')->'body'->'goal'->'progress'->>'status', 'insufficient', 'sem atendimentos no mês: progresso insuficiente, não zero');
select is(pg_temp.got('g1')->'body'->'goal'->'progress'->>'attainment', null, 'sem dado não há percentual da meta');
select is(pg_temp.got('g1')->'body'->'goal'->>'direction', 'down', 'faltas: quanto menor melhor (derivado do indicador)');
select is(pg_temp.goal('idem-goal-000000000001', null, null, 'no_show', 0.1, 'Menos faltas')->'body'->'goal'->>'id', pg_temp.gid('g1')::text, 'repetir a chave devolve a mesma meta');
select throws_ok(format($$ select public.goal_save(%L, null, null, 'no_show', 0.2, null, null, 'idem-goal-000000000002', %L) $$, (select tenant_a from ids), pg_temp.h('dup')),
  'PT422', 'POLICY_REJECTED', 'uma meta ativa por indicador e mês');
select throws_ok(format($$ select public.goal_save(%L, null, null, 'occupancy', 1.5, null, null, 'idem-goal-000000000003', %L) $$, (select tenant_a from ids), pg_temp.h('bad')),
  'PT400', 'VALIDATION_ERROR', 'taxa acima de 1 é recusada');
select throws_ok(format($$ select public.goal_save(%L, null, null, 'human_minutes', 1, null, null, 'idem-goal-000000000004', %L) $$, (select tenant_a from ids), pg_temp.h('hm')),
  'PT400', 'VALIDATION_ERROR', 'indicador fora da lista de metas é recusado');
select throws_ok(format($$ select public.goal_save(%L, %L, 9, 'no_show', 0.05, null, null, 'idem-goal-000000000005', %L) $$, (select tenant_a from ids), pg_temp.gid('g1'), pg_temp.h('st')),
  'PT409', 'STALE_VERSION', 'editar com versão antiga não passa');
insert into r select 'g1b', pg_temp.goal('idem-goal-000000000006', pg_temp.gid('g1'), 1, 'no_show', 0.05, 'Menos faltas ainda');
select is((pg_temp.got('g1b')->'body'->'goal'->>'target')::numeric, 0.05, 'meta ajustada');
select is((pg_temp.got('g1b')->'body'->'goal'->>'version')::int, 2, 'versão avança');
select is(pg_temp.rules(), '', 'sem dado existente, nenhuma sugestão (regras não inventam)');
reset role;

-- ------------------------------------------------------------------ dado real do mês: progresso com denominador e sugestões por regra
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
select (select tenant_a from ids), (select res_a from ids), d, '08:00', '20:00' from generate_series(1, 5) d;
-- 10 atendimentos já ocorridos hoje: 3 faltas, 7 concluídos sem cobrança registrada.
insert into public.bookings (tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
select (select tenant_a from ids), (select res_a from ids), (select ana from ids), (select corte_a from ids),
  now() - (g * 40 || ' minutes')::interval, now() - (g * 40 || ' minutes')::interval + interval '30 minutes',
  tstzrange(now() - (g * 40 || ' minutes')::interval, now() - (g * 40 || ' minutes')::interval + interval '30 minutes', '[)'), g > 3,
  case when g <= 3 then 'no_show' else 'completed' end, 6000, 'owner' from generate_series(1, 10) g;
-- Ana veio hoje (não está inativa); Carlos consentiu marketing e não vem há tempo: público da campanha = 1.
insert into public.lifecycle_consents (tenant_id, customer_id, purpose) values ((select tenant_a from ids), (select ana from ids), 'marketing'), ((select tenant_a from ids), '30000000-0000-4000-8000-0000000000a2', 'marketing');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'list', public.goal_list((select tenant_a from ids));
select is((select x->'progress'->>'value' from jsonb_array_elements(pg_temp.got('list')->'goals') x where x->>'id' = pg_temp.gid('g1')::text), '0.3000', 'progresso = faltas 3 de 10');
select is((select x->'progress'->>'denominator' from jsonb_array_elements(pg_temp.got('list')->'goals') x where x->>'id' = pg_temp.gid('g1')::text), '10', 'denominador explícito');
select is((select x->'progress'->>'attainment' from jsonb_array_elements(pg_temp.got('list')->'goals') x where x->>'id' = pg_temp.gid('g1')::text), '0.1667', 'meta 5%: 0,05/0,30 do caminho');
select is((select x->'progress'->>'achieved' from jsonb_array_elements(pg_temp.got('list')->'goals') x where x->>'id' = pg_temp.gid('g1')::text), 'false', 'ainda não atingida');
select is(jsonb_array_length(pg_temp.got('list')->'metrics'), 10, 'indicadores do mês junto com as metas');
insert into r select 'g2', pg_temp.goal('idem-goal-000000000007', null, null, 'charge_coverage', 0.9, null);
select is(pg_temp.got('g2')->'body'->'goal'->'progress'->>'value', '0.0000', 'cobrança registrada: 0 de 7 (dado existe, valor zero)');
select is(pg_temp.got('g2')->'body'->'goal'->'progress'->>'status', 'ok', 'zero com denominador é dado, não insuficiência');
-- Regras: faltas 30% com lembretes 0% → lembretes; ocupação baixa com público autorizado → campanha; cobrança 0% → Caixa.
select is(pg_temp.rules(), 'charge_coverage,no_show_reminders,occupancy_campaign', 'três sugestões, todas com dado existente e suficiente');
insert into r select 'adv', public.advice_list((select tenant_a from ids));
select is((select x->'evidence'->>'no_show_n' from jsonb_array_elements(pg_temp.got('adv')->'suggestions') x where x->>'rule_code' = 'no_show_reminders'), '10', 'evidência traz o denominador');
select is((select x->>'route' from jsonb_array_elements(pg_temp.got('adv')->'suggestions') x where x->>'rule_code' = 'occupancy_campaign'), '/app/campanhas', 'sugestão aponta a tela, nunca age sozinha');
select ok(not (pg_temp.got('adv')::text ~ 'Ana|Beatriz'), 'sugestões sem nomes de clientes');
insert into r select 'dec', public.advice_decide((select tenant_a from ids), 'no_show_reminders', 'accepted', 'idem-advice-00000000001', pg_temp.h('dec'));
select is(pg_temp.got('dec')->'body'->'decision'->'metric_before'->>'value', '0.3000', 'decisão congela o indicador de agora');
select throws_ok(format($$ select public.advice_decide(%L, 'no_show_reminders', 'dismissed', 'idem-advice-00000000002', %L) $$, (select tenant_a from ids), pg_temp.h('dec2')),
  'PT422', 'POLICY_REJECTED', 'uma decisão por regra e mês');
select throws_ok(format($$ select public.advice_decide(%L, 'quote_recurrence', 'accepted', 'idem-advice-00000000003', %L) $$, (select tenant_a from ids), pg_temp.h('dec3')),
  'PT422', 'POLICY_REJECTED', 'regra que não está em vigor não aceita decisão');
reset role;
-- Acompanhamento 30 dias depois pelo worker: mede de novo; variação observada, nunca efeito.
update public.advice_decisions set follow_up_at = clock_timestamp() - interval '1 minute';
insert into r select 'tick', public.jobs_run(50);
select is((pg_temp.got('tick')->'advice'->>'followed_up')::int, 1, 'worker acompanha a decisão vencida');
select is((select outcome from public.advice_decisions), 'unchanged', 'mesmos 30% depois: variação observada = sem mudança');
select is((public.jobs_run(50)->'advice'->>'followed_up')::int, 0, 'rodar de novo não repete');

-- ------------------------------------------------------------------ conteúdo aprovado e escopo do perfil (P09)
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
insert into r select 'cl', public.content_list((select tenant_a from ids));
select is(jsonb_array_length(pg_temp.got('cl')->'templates'), 5, 'barbeiro vê os textos da profissão e os gerais (5)');
select is(pg_temp.got('cl')->'scope'->>'profile_published', 'false', 'sem perfil publicado');
select throws_ok(format($$ select public.content_publish(%L, 'bio_barber_classico', 'idem-content-0000000001', %L) $$, (select tenant_a from ids), pg_temp.h('c1')),
  'PT422', 'POLICY_REJECTED', 'sem perfil publicado com campo bio, não publica');
reset role;
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
values ((select tenant_a from ids), 'barbearia-a', 'barber', 'Pinheiros', array['area', 'display_name'], now());
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.content_publish(%L, 'bio_barber_classico', 'idem-content-0000000002', %L) $$, (select tenant_a from ids), pg_temp.h('c2')),
  'PT422', 'POLICY_REJECTED', 'perfil publicado mas sem o campo bio escolhido: não publica');
select is(pg_temp.rules() ~ 'profile_bio', false, 'sem o campo bio escolhido, a regra de apresentação não aparece');
reset role;
update public.public_profiles set public_fields = array['area', 'bio', 'display_name'] where tenant_id = (select tenant_a from ids);
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(pg_temp.rules() ~ 'profile_bio', true, 'campo bio escolhido e vazio: sugestão de publicar aparece');
select throws_ok(format($$ select public.content_publish(%L, 'bio_pt_resultado', 'idem-content-0000000003', %L) $$, (select tenant_a from ids), pg_temp.h('c3')),
  'PT422', 'POLICY_REJECTED', 'texto de outra profissão não publica');
select throws_ok(format($$ select public.content_publish(%L, 'post_retorno', 'idem-content-0000000004', %L) $$, (select tenant_a from ids), pg_temp.h('c4')),
  'PT422', 'POLICY_REJECTED', 'texto de post não vira apresentação');
insert into r select 'pub', public.content_publish((select tenant_a from ids), 'bio_barber_classico', 'idem-content-0000000005', pg_temp.h('c5'));
select is(pg_temp.got('pub')->'body'->'published'->>'body', 'Barbearia Exemplo A em Pinheiros: cortes, barba e cuidado com horário marcado. Agende pelo link e chegue na hora combinada.', 'texto aprovado preenchido com dados públicos do negócio');
select is(pg_temp.rules() ~ 'profile_bio', false, 'publicado: a sugestão some');
insert into r select 'pub2', public.content_publish((select tenant_a from ids), 'bio_barber_familia', 'idem-content-0000000006', pg_temp.h('c6'));
select is((pg_temp.got('pub2')->'body'->'published'->>'version')::int, 2, 'trocar o texto avança a versão (um por negócio)');
reset role;
set local role anon;
select is(public.network_public_profile('barbearia-a')->'values'->>'bio', pg_temp.got('pub2')->'body'->'published'->>'body', 'projeção pública mostra a apresentação (campo escolhido)');
reset role;
update public.public_profiles set public_fields = array['area', 'display_name'] where tenant_id = (select tenant_a from ids);
set local role anon;
select is(public.network_public_profile('barbearia-a')->'values' ? 'bio', false, 'tirar o campo bio do perfil esconde a apresentação (escopo do dono)');
reset role;
select is((select count(*)::int from public.outbox_events where event_type = 'content.published.v1'), 2, 'dois eventos de publicação');
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok(format($$ select public.content_unpublish(%L, 1, 'idem-content-0000000007', %L) $$, (select tenant_a from ids), pg_temp.h('c7')), 'PT409', 'STALE_VERSION', 'despublicar exige a versão atual');
select is(public.content_unpublish((select tenant_a from ids), 2, 'idem-content-0000000008', pg_temp.h('c8'))->'body'->>'published', null, 'despublicado');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.goal_list(%L) $$, (select tenant_a from ids)), 'PT403', 'FORBIDDEN', 'B não vê as metas de A');
select throws_ok(format($$ select public.content_publish(%L, 'bio_barber_classico', 'idem-content-0000000009', %L) $$, (select tenant_a from ids), pg_temp.h('c9')), 'PT403', 'FORBIDDEN', 'B não publica no perfil de A');
select is((select count(*) from public.goals where tenant_id = (select tenant_a from ids)), 0::bigint, 'RLS: B não lê metas de A');

select * from finish();
rollback;

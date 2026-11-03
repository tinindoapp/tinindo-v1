-- P44 · Configuração guiada: estado de cada passo calculado pelos dados reais (sem flag gravada à mão), modelos só por
-- migration, criar serviços e aplicar o rascunho pelas RPCs do P02/P03 (tudo ou nada, idempotentes), passo obrigatório
-- não se dispensa, evento uma vez por passo, "pronto em 24 h" pela data real dos dados, isolamento e RLS.
-- Corridas em tests/db-concurrency/29_setup.sh.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  'd0000000-0000-4000-8000-0000000000dd'::uuid as owner_c,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '10000000-0000-4000-8000-00000000000c'::uuid as tenant_c,
  '20000000-0000-4000-8000-00000000000c'::uuid as res_c;
grant select on ids to anon, authenticated;
create temp table r (k text primary key, v jsonb);
grant select, insert, update on r to anon, authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;
create function pg_temp.step(p_k text, p_path text, p_step text) returns jsonb language sql as $$
  select s from r, jsonb_array_elements(v #> p_path::text[]) s where k = p_k and s->>'step' = p_step $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return v_state || '/' || v_msg || '/' || coalesce(nullif(v_hint, ''), '-');
end $$;
grant execute on function pg_temp.h(text), pg_temp.got(text), pg_temp.step(text, text, text), pg_temp.err(text) to anon, authenticated;

-- Negócio C recém-criado (2 h atrás), do usuário sem vínculo: nada configurado ainda.
insert into public.tenants (id, name, profession, timezone, created_at) select tenant_c, 'Barbearia Nova C', 'barber', 'America/Sao_Paulo', now() - interval '2 hours' from ids;
insert into public.tenant_memberships (tenant_id, user_id, role) select tenant_c, owner_c, 'owner' from ids;
insert into public.resources (id, tenant_id, name) select res_c, tenant_c, 'Profissional C' from ids;

-- ------------------------------------------------------------------ estrutura, grants e modelos só por migration
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'setup\_%'), 'RLS ligada nas tabelas da configuração');
select ok(not has_table_privilege('authenticated', 'public.setup_service_templates', 'insert'), 'modelos: sem escrita pela Data API');
select ok(not has_table_privilege('authenticated', 'public.setup_step_completions', 'select'), 'medição é backend-only');
select ok(not has_table_privilege('authenticated', 'public.setup_dismissals', 'insert'), 'dispensa só por RPC');
select ok(not has_function_privilege('anon', 'public.setup_progress(uuid)', 'execute'), 'anon não lê o progresso');
select ok(not has_function_privilege('authenticated', 'app.setup_record_completions(uuid)', 'execute'), 'medição só por dentro');
select is((select count(*)::int from public.setup_service_templates), 11, '11 modelos semeados (barbearia 3, cabeleireira 4, personal 3, outra 1)');
select is(pg_temp.err($$ update public.setup_service_templates set price_to_cents = 1 where code = 'barber_corte' $$) like 'ok%', false, 'modelo não muda por update (append-only)');
select is((select count(*)::int from public.setup_service_templates where price_from_cents > price_to_cents), 0, 'faixa de preço sempre de ≤ até');

-- ------------------------------------------------------------------ negócio novo: nada feito, próximo = horários, nenhum evento
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
insert into r select 'p0', public.setup_progress((select tenant_c from ids));
select is((pg_temp.got('p0')->>'done_count')::int, 0, 'negócio novo: 0 de 8');
select is(pg_temp.got('p0')->>'total', '8', '8 passos');
select is(pg_temp.got('p0')->>'next', 'hours', 'próximo passo: horários');
select is(pg_temp.got('p0')->>'ready', 'false', 'não está pronto');
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('p0')->'steps') s where s->>'why' is null), 0, 'todo passo pendente diz por quê');
select is((select string_agg(s->>'link', ',' order by o) from jsonb_array_elements(pg_temp.got('p0')->'steps') with ordinality x(s, o)),
  '/app/agenda/horarios,/app/clientes/servicos,/app/conta,/app/perfil,/app/clientes,/app/perfil,/app/mensagens,/app/caixa', 'cada passo leva à tela que resolve');
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('p0')->'steps') s where (s->>'required')::boolean), 4, 'quatro obrigatórios');
reset role;
select is((select count(*)::int from public.outbox_events e where e.tenant_id = (select tenant_c from ids) and e.event_type = 'setup.step_completed.v1'), 0, 'sem evento enquanto nada foi feito');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.setup_progress(%L) $$, (select tenant_c from ids))), 'PT403/FORBIDDEN/-', 'dono B não lê o progresso de C');
select is(pg_temp.err(format($$ select public.setup_templates(%L) $$, (select tenant_c from ids))), 'PT403/FORBIDDEN/-', 'dono B não lê os modelos de C');
select is(pg_temp.err(format($$ select public.setup_dismiss(%L, 'channel', true, 'idem-setup-b-dismiss-0001', %L) $$, (select tenant_c from ids), pg_temp.h('x'))), 'PT403/FORBIDDEN/-', 'dono B não dispensa passo de C');
select is(pg_temp.err(format($$ select public.setup_services_apply(%L, '[{"name":"X","duration_min":30,"base_price_cents":100}]', 'idem-setup-b-apply-00001', %L) $$, (select tenant_c from ids), pg_temp.h('x'))), 'PT403/FORBIDDEN/-', 'dono B não cria serviço em C');
select is((select count(*)::int from public.setup_dismissals), 0, 'RLS: B não vê dispensas de ninguém');
reset role;

-- ------------------------------------------------------------------ horários pela RPC do P03: passo feito pela data real, evento uma vez
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
select lives_ok(format($$ select public.scheduling_rules_save(%L, %L, 1, '[{"weekday":2,"local_start":"09:00","local_end":"19:00"},{"weekday":3,"local_start":"09:00","local_end":"19:00"}]', 'idem-setup-rules-00001', %L) $$,
  (select tenant_c from ids), (select res_c from ids), pg_temp.h('rules')), 'expediente salvo pela agenda');
insert into r select 'p1', public.setup_progress((select tenant_c from ids));
select is(pg_temp.step('p1', '{steps}', 'hours')->>'done', 'true', 'horários: feito');
select is(pg_temp.step('p1', '{steps}', 'hours')->>'why', null, 'feito não precisa de por quê');
select is(pg_temp.got('p1')->>'next', 'service', 'próximo passo: serviço');
insert into r select 'p1b', public.setup_progress((select tenant_c from ids));
reset role;
select is((select to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.availability_rules where tenant_id = (select tenant_c from ids)),
  pg_temp.step('p1', '{steps}', 'hours')->>'done_at', 'done_at é a data real da regra, não a da leitura');
select is((select count(*)::int from public.outbox_events e where e.tenant_id = (select tenant_c from ids) and e.event_type = 'setup.step_completed.v1'), 1, 'um evento depois de duas leituras');
select is((select e.payload->>'step' from public.outbox_events e where e.tenant_id = (select tenant_c from ids) and e.event_type = 'setup.step_completed.v1'), 'hours', 'evento do passo horários');
select ok((select (e.payload->>'seconds_since_signup')::bigint between 7000 and 7300 from public.outbox_events e where e.tenant_id = (select tenant_c from ids) and e.event_type = 'setup.step_completed.v1'),
  'segundos desde o cadastro medidos pelo dado (negócio criado há 2 h)');

-- ------------------------------------------------------------------ modelos e criação confirmada (tudo ou nada, idempotente)
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
insert into r select 't0', public.setup_templates((select tenant_c from ids));
select is(pg_temp.got('t0')->>'profession', 'barber', 'modelos da profissão do negócio');
select is((select string_agg(t->>'code', ',' order by o) from jsonb_array_elements(pg_temp.got('t0')->'templates') with ordinality x(t, o)), 'barber_corte,barber_barba,barber_corte_barba', 'três modelos de barbearia em ordem');
select is((select bool_or((t->>'exists')::boolean) from jsonb_array_elements(pg_temp.got('t0')->'templates') t), false, 'nenhum existe ainda');
-- Lote com nome repetido no meio: nada é criado (tudo ou nada).
select is(pg_temp.err(format($$ select public.setup_services_apply(%L, '[{"template_code":"barber_corte","name":"Corte","duration_min":30,"base_price_cents":5000},{"name":"corte","duration_min":30,"base_price_cents":1}]', 'idem-setup-apply-dup-00001', %L) $$,
  (select tenant_c from ids), pg_temp.h('dup'))), 'PT400/VALIDATION_ERROR/name', 'nome repetido dentro do lote: 400 no campo name');
select is(pg_temp.err(format($$ select public.setup_services_apply(%L, '[{"template_code":"pt_pacote_10","name":"Pacote","duration_min":60,"base_price_cents":70000}]', 'idem-setup-apply-pkg-00001', %L) $$,
  (select tenant_c from ids), pg_temp.h('pkg'))), 'PT400/VALIDATION_ERROR/template_code', 'pacote não vira serviço');
select is(pg_temp.err(format($$ select public.setup_services_apply(%L, '[]', 'idem-setup-apply-emp-00001', %L) $$, (select tenant_c from ids), pg_temp.h('emp'))),
  'PT400/VALIDATION_ERROR/services', 'lista vazia recusada');
select is(pg_temp.err(format($$ select public.setup_services_apply(%L, '[{"name":"X","duration_min":4,"base_price_cents":100}]', 'idem-setup-apply-dur-00001', %L) $$, (select tenant_c from ids), pg_temp.h('dur'))),
  'PT400/VALIDATION_ERROR/duration_min', 'duração fora do limite recusada');
reset role;
select is((select count(*)::int from public.provider_services where tenant_id = (select tenant_c from ids)), 0, 'nada criado pelos lotes recusados');
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
insert into r select 'a1', public.setup_services_apply((select tenant_c from ids),
  '[{"template_code":"barber_corte","name":"Corte","duration_min":30,"base_price_cents":5000},{"template_code":"barber_barba","name":"Barba","duration_min":20,"base_price_cents":3000}]',
  'idem-setup-apply-ok-000001', pg_temp.h('ok'));
select is(pg_temp.got('a1')->>'status_code', '201', 'criação responde 201');
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('a1')->'body'->'created')), 2, 'dois serviços criados');
select is(pg_temp.step('a1', '{body,progress,steps}', 'service')->>'done', 'true', 'passo serviço feito na mesma resposta');
insert into r select 'a1r', public.setup_services_apply((select tenant_c from ids),
  '[{"template_code":"barber_corte","name":"Corte","duration_min":30,"base_price_cents":5000},{"template_code":"barber_barba","name":"Barba","duration_min":20,"base_price_cents":3000}]',
  'idem-setup-apply-ok-000001', pg_temp.h('ok'));
select is(pg_temp.got('a1r'), pg_temp.got('a1'), 'repetição com a mesma chave devolve a mesma resposta');
select is(pg_temp.err(format($$ select public.setup_services_apply(%L, '[{"name":"Outro","duration_min":30,"base_price_cents":5000}]', 'idem-setup-apply-ok-000001', %L) $$,
  (select tenant_c from ids), pg_temp.h('outro'))), 'PT409/IDEMPOTENCY_MISMATCH/-', 'mesma chave com outro corpo: 409');
insert into r select 't1', public.setup_templates((select tenant_c from ids));
select is((select string_agg((t->>'exists')::text, ',' order by o) from jsonb_array_elements(pg_temp.got('t1')->'templates') with ordinality x(t, o)), 'true,true,false', 'modelos já criados aparecem como existentes');
reset role;
select is((select count(*)::int from public.provider_services where tenant_id = (select tenant_c from ids) and active), 2, 'catálogo com os dois serviços (uma vez)');
select is((select count(*)::int from public.provider_services s where s.tenant_id = (select tenant_c from ids) and s.name = 'Barba' and s.buffer_after_min = 5), 1, 'intervalo veio do modelo');

-- ------------------------------------------------------------------ dispensa: só opcional
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
select is(pg_temp.err(format($$ select public.setup_dismiss(%L, 'cancellation_policy', true, 'idem-setup-dismiss-req-01', %L) $$, (select tenant_c from ids), pg_temp.h('req'))),
  'PT400/VALIDATION_ERROR/step', 'passo obrigatório não se dispensa');
select is(pg_temp.err(format($$ select public.setup_dismiss(%L, 'inventado', true, 'idem-setup-dismiss-inv-01', %L) $$, (select tenant_c from ids), pg_temp.h('inv'))),
  'PT400/VALIDATION_ERROR/step', 'passo inexistente: 400');
insert into r select 'd1', public.setup_dismiss((select tenant_c from ids), 'channel', true, 'idem-setup-dismiss-ch-001', pg_temp.h('ch'));
select is(pg_temp.step('d1', '{body,progress,steps}', 'channel')->>'dismissed', 'true', 'canal dispensado');
select is((pg_temp.got('d1')->'body'->'progress'->>'resolved_count')::int, 3, 'resolvidos = feitos + dispensados');
select is(pg_temp.got('d1')->'body'->'progress'->>'next', 'cancellation_policy', 'próximo continua sendo o obrigatório que falta');
insert into r select 'd2', public.setup_dismiss((select tenant_c from ids), 'channel', false, 'idem-setup-dismiss-ch-002', pg_temp.h('ch2'));
select is(pg_temp.step('d2', '{body,progress,steps}', 'channel')->>'dismissed', 'false', 'voltar a mostrar');

-- ------------------------------------------------------------------ rascunho revisado: profissão + expediente (P03) + serviço (P02), tudo ou nada
select is(pg_temp.err(format($$ select public.setup_draft_apply(%L, 'hairdresser', '[{"weekday":1,"local_start":"19:00","local_end":"09:00"}]', '[{"name":"Escova","duration_min":40,"base_price_cents":6000}]', 'idem-setup-draft-bad-0001', %L) $$,
  (select tenant_c from ids), pg_temp.h('bad'))), 'PT400/VALIDATION_ERROR/rules', 'expediente invertido: recusado pela regra da agenda');
reset role;
select is((select profession from public.tenants where id = (select tenant_c from ids)), 'barber', 'rascunho recusado não muda a profissão (tudo ou nada)');
select is((select count(*)::int from public.provider_services where tenant_id = (select tenant_c from ids) and name = 'Escova'), 0, 'rascunho recusado não cria serviço');
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
insert into r select 'dr', public.setup_draft_apply((select tenant_c from ids), 'hairdresser',
  '[{"weekday":1,"local_start":"08:00","local_end":"12:00"},{"weekday":1,"local_start":"13:00","local_end":"18:00"},{"weekday":2,"local_start":"08:00","local_end":"18:00"}]',
  '[{"name":"Escova","duration_min":40,"base_price_cents":6000}]', 'idem-setup-draft-ok-00001', pg_temp.h('draft'));
select is(pg_temp.got('dr')->'body'->>'profession', 'hairdresser', 'profissão aplicada');
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('dr')->'body'->'hours')), 3, 'expediente devolvido como a agenda guarda');
select is(pg_temp.got('dr')->'body'->'created'->0->>'name', 'Escova', 'serviço do rascunho criado');
insert into r select 'drr', public.setup_draft_apply((select tenant_c from ids), 'hairdresser',
  '[{"weekday":1,"local_start":"08:00","local_end":"12:00"},{"weekday":1,"local_start":"13:00","local_end":"18:00"},{"weekday":2,"local_start":"08:00","local_end":"18:00"}]',
  '[{"name":"Escova","duration_min":40,"base_price_cents":6000}]', 'idem-setup-draft-ok-00001', pg_temp.h('draft'));
select is(pg_temp.got('drr'), pg_temp.got('dr'), 'rascunho repetido com a mesma chave: mesma resposta, nada duplicado');
reset role;
select is((select count(*)::int from public.availability_rules where tenant_id = (select tenant_c from ids)), 3, 'expediente substituído (2 regras viraram 3)');
select is((select count(*)::int from public.provider_services where tenant_id = (select tenant_c from ids) and active), 3, 'três serviços ativos, Escova uma vez só');

-- ------------------------------------------------------------------ pronto: política + perfil publicado, pela data real; ready_in_24h; eventos
insert into public.tenant_onboarding (tenant_id, goal, cancellation_notice_hours) select tenant_c, 'fill_schedule', 24 from ids;
insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at)
  select tenant_c, 'barbearia-nova-c', 'barber', 'Centro', array['display_name', 'area', 'booking_link'], now() - interval '30 minutes' from ids;
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
insert into r select 'p2', public.setup_progress((select tenant_c from ids));
select is(pg_temp.got('p2')->>'ready', 'true', 'obrigatórios feitos: pronto');
select is(pg_temp.got('p2')->>'ready_in_24h', 'true', 'pronto em menos de 24 h do cadastro');
select is((pg_temp.got('p2')->>'done_count')::int, 4, '4 de 8 feitos');
select is(pg_temp.got('p2')->>'next', 'first_customer', 'próximo é o primeiro opcional');
reset role;
select is((select string_agg(e.payload->>'step', ',' order by e.occurred_at, e.aggregate_version) from public.outbox_events e where e.tenant_id = (select tenant_c from ids) and e.event_type = 'setup.step_completed.v1'),
  'hours,service,cancellation_policy,profile', 'um evento por passo, na ordem em que foram vistos');
select is((select e.payload->>'ready' from public.outbox_events e where e.tenant_id = (select tenant_c from ids) and e.event_type = 'setup.step_completed.v1' and e.payload->>'step' = 'profile'), 'true', 'o evento do último obrigatório diz que ficou pronto');
select is((select count(*)::int from public.setup_step_completions where tenant_id = (select tenant_c from ids)), 4, 'medição guarda uma conclusão por passo');

-- ------------------------------------------------------------------ P18: indicador "negócios prontos em 24 h" só para o operador
insert into public.platform_operators (user_id, display_name) values ((select owner_b from ids), 'Operadora (exemplo)');
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
insert into r select 'cost', public.analytics_cost_to_serve(now() - interval '1 day', now(), 6000);
select ok((pg_temp.got('cost')->'setup_ready_24h'->>'businesses')::int >= 3, 'conta os negócios criados no período (A, B e C)');
select is((pg_temp.got('cost')->'setup_ready_24h'->>'ready_in_24h')::int, 1, 'só C ficou pronto em 24 h');
reset role;
select pg_temp.login_as((select owner_c from ids));
set local role authenticated;
select is(pg_temp.err($$ select public.analytics_cost_to_serve(now() - interval '1 day', now(), 6000) $$), 'PT403/FORBIDDEN/-', 'dono comum não vê o indicador da operação');
reset role;

select * from finish();
rollback;

-- Assistente parte 2, item 3 (revisão 06/11, T8): leituras do assistente para explicar e ajudar a configurar.
-- Acesso conferido no banco; só o mínimo; lista de espera sem nome, telefone nem janelas da pessoa; isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a,
  '30000000-0000-4000-8000-0000000000a1'::uuid as ana;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Estrutura e acesso
select ok(not has_function_privilege('anon', 'public.agent_setup_read(uuid)', 'execute'), 'anon não lê a configuração');
select ok(not has_function_privilege('anon', 'public.agent_insights_read(uuid)', 'execute'), 'anon não lê as sugestões');
select ok(not has_function_privilege('anon', 'public.agent_waitlist_read(uuid)', 'execute'), 'anon não lê a lista de espera');
select ok(not has_function_privilege('anon', 'public.agent_lifecycle_read(uuid)', 'execute'), 'anon não lê a régua');
select ok(has_function_privilege('authenticated', 'public.agent_waitlist_read(uuid)', 'execute'), 'authenticated chama (o vínculo é conferido dentro)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('agent_setup_read', 'agent_insights_read', 'agent_waitlist_read', 'agent_lifecycle_read')
     and p.prosecdef and p.provolatile = 's' and array_to_string(p.proconfig, ',') = 'search_path=""'), 4,
  'as quatro são security definer, só leitura e com search_path vazio');

-- Uma pessoa na lista de espera do negócio A (com recado e janelas: nada disso pode sair)
insert into public.contact_consents (id, tenant_id, customer_id, purpose, channel)
select '80000000-0000-4000-8000-0000000000c1', tenant_a, ana, 'waitlist_offer', 'manual_share' from ids;
insert into public.waitlist_entries (tenant_id, customer_id, service_id, acceptable_windows, consent_id, valid_until)
select tenant_a, ana, corte_a, '[{"weekday": 2, "local_start": "09:00", "local_end": "12:00"}]'::jsonb,
  '80000000-0000-4000-8000-0000000000c1', now() + interval '30 days' from ids;

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
create temp table w as select public.agent_waitlist_read((select tenant_a from ids)) as v;
select is((select (v->'by_service'->0->>'active')::int from w), 1, 'contagem por serviço');
select ok((select v::text !~* 'Ana|Cliente Exemplo|telefone|phone|acceptable_windows|consent|local_start|note' from w),
  'sem nome, telefone, consentimento, janelas nem recado');
select is((select jsonb_typeof(v->'open_offers') from w), 'array', 'ofertas abertas (sem dono da oferta)');
select ok((public.agent_setup_read((select tenant_a from ids))->'progress') ? 'steps', 'configuração: passos da configuração guiada');
select ok((public.agent_lifecycle_read((select tenant_a from ids))->'settings') ? 'reminder_hours', 'régua: como está hoje');
select ok(not ((public.agent_lifecycle_read((select tenant_a from ids))->'settings') ? 'version'), 'régua sem versão (o assistente não grava)');
select is(jsonb_typeof(public.agent_insights_read((select tenant_a from ids))->'insights'), 'array', 'sugestões abertas com evidência');

-- Isolamento: dono de A não lê B; dono de B não lê A
select throws_ok(format($$ select public.agent_waitlist_read(%L) $$, (select tenant_b from ids)), 'PT403', null, 'A não lê a lista de espera de B');
reset role;
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.agent_insights_read(%L) $$, (select tenant_a from ids)), null, null, 'B não lê as sugestões de A');
select throws_ok(format($$ select public.agent_setup_read(%L) $$, (select tenant_a from ids)), 'PT403', null, 'B não lê a configuração de A');
reset role;

select * from finish();
rollback;

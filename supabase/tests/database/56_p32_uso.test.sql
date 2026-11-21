-- P32 bloco 1 · uso do app sem dado pessoal: isolamento, vocabulário fechado, lote sem duplicar, desligar e retenção.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.ev(p_kind text, p_name text, p_outcome text default null, p_code text default null) returns jsonb
language sql as $$ select jsonb_build_object('kind', p_kind, 'name', p_name, 'outcome', p_outcome, 'code', p_code, 'at', now()) $$;

-- ------------------------------------------------------------------ estrutura
select is((select relrowsecurity from pg_class where oid = 'public.usage_events'::regclass), true, 'RLS ligada nos eventos');
select ok(not has_table_privilege('authenticated', 'public.usage_events', 'select'), 'ninguém lê os eventos direto');
select ok(not has_table_privilege('authenticated', 'public.usage_events', 'insert'), 'ninguém grava direto');
select ok(not has_function_privilege('anon', 'public.usage_record(uuid, uuid, jsonb)', 'execute'), 'anônimo não grava uso');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'usage_events'),
  array['id', 'tenant_id', 'kind', 'name', 'outcome', 'code', 'occurred_at', 'recorded_at'],
  'sem coluna de usuário, IP, valor, texto ou corpo');
select is((select days from public.retention_policies where category = 'usage_events'), 30, 'retenção de 30 dias na tabela de prazos do P57');
select is((select days from public.retention_policies where category = 'usage_batches'), 2, 'lotes guardados 2 dias');

-- ------------------------------------------------------------------ gravação
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(public.usage_record((select tenant_a from ids), 'c3200000-0000-4000-8000-000000000001', jsonb_build_array(
  pg_temp.ev('screen', '/app/agenda'),
  pg_temp.ev('screen', '/app/clientes/30000000-0000-4000-8000-0000000000a1'),
  pg_temp.ev('command', 'scheduling/booking.create', 'ok'),
  pg_temp.ev('command', 'scheduling/booking.cancel', 'refused', 'POLICY_REJECTED')
)) ->> 'recorded', '4', 'grava tela e comando');
select is(public.usage_record((select tenant_a from ids), 'c3200000-0000-4000-8000-000000000001', jsonb_build_array(
  pg_temp.ev('screen', '/app/agenda'))) ->> 'duplicate', 'true', 'o mesmo lote de novo não grava');
-- Nada que pareça dado pessoal passa: e-mail, telefone, nome fora de /app, texto livre, código inventado.
select is(public.usage_record((select tenant_a from ids), 'c3200000-0000-4000-8000-000000000002', jsonb_build_array(
  pg_temp.ev('screen', '/p/maria-da-silva'),
  pg_temp.ev('screen', 'Maria da Silva'),
  pg_temp.ev('command', 'crm/customer.upsert maria@exemplo.com', 'ok'),
  pg_temp.ev('command', 'crm/customer.upsert', 'refused', 'Telefone 11 99999-0000'),
  pg_temp.ev('command', 'crm/customer.upsert', 'talvez'),
  '"texto solto"'::jsonb
)) ->> 'recorded', '0', 'vocabulário fechado: seis eventos com dado ou fora do formato, nenhum gravado');
reset role;
select is((select name from public.usage_events where kind = 'screen' and name like '/app/clientes%'), '/app/clientes/:id',
  'o id da rota vira :id');
select is((select count(*)::int from public.usage_events where name ~ '@|[0-9]{3,}' or code ~ '[a-z ]'), 0,
  'nenhum @ ou número longo gravado');

-- ------------------------------------------------------------------ isolamento
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select throws_ok(format($$ select public.usage_record(%L, gen_random_uuid(), '[]'::jsonb) $$, (select tenant_a from ids)),
  'PT403', null, 'dono de B não grava no negócio A');
select throws_ok(format($$ select public.usage_settings_get(%L) $$, (select tenant_a from ids)), 'PT403', null,
  'dono de B não lê a configuração de A');
select throws_ok(format($$ select public.usage_settings_set(%L, false, 0, 'chave-uso-desligar-b-000001', repeat('a', 64)) $$,
  (select tenant_a from ids)), 'PT403', null, 'dono de B não desliga a medição de A');
reset role;

-- ------------------------------------------------------------------ desligar
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(public.usage_settings_get((select tenant_a from ids)) ->> 'enabled', 'true', 'ligada por padrão');
select throws_ok(format($$ select public.usage_settings_set(%L, false, 3, 'chave-uso-desligar-a-000001', repeat('a', 64)) $$,
  (select tenant_a from ids)), 'PT409', null, 'versão velha não desliga');
select is(public.usage_settings_set((select tenant_a from ids), false, 0, 'chave-uso-desligar-a-000002', repeat('a', 64))
  #>> '{body,enabled}', 'false', 'o dono desliga');
select is(public.usage_record((select tenant_a from ids), 'c3200000-0000-4000-8000-000000000003',
  jsonb_build_array(pg_temp.ev('screen', '/app/agenda'))) ->> 'recorded', '0', 'desligada, nada é gravado');
reset role;
select is((select count(*)::int from public.usage_events where tenant_id = (select tenant_a from ids)), 0,
  'desligar apaga o que já foi medido do negócio');

-- ------------------------------------------------------------------ teto por hora
insert into public.usage_settings (tenant_id, enabled) values ((select tenant_b from ids), true);
insert into public.usage_events (tenant_id, kind, name, occurred_at)
  select (select tenant_b from ids), 'screen', '/app/agenda', now() from generate_series(1, 1999);
select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is(public.usage_record((select tenant_b from ids), 'c3200000-0000-4000-8000-000000000004', jsonb_build_array(
  pg_temp.ev('screen', '/app/agenda'), pg_temp.ev('screen', '/app/caixa'))) ->> 'recorded', '1',
  'teto de 2.000 por hora: só cabe um');
reset role;

-- ------------------------------------------------------------------ retenção
update public.usage_events set occurred_at = now() - interval '31 days' where tenant_id = (select tenant_b from ids);
update public.usage_batches set created_at = now() - interval '3 days';
select is(app.usage_tick(5000) ->> 'usage_events', '2000', 'a rotina apaga os eventos com mais de 30 dias');
select is((select count(*)::int from public.usage_batches), 0, 'e os lotes com mais de 2 dias');
select is((select affected from public.retention_runs where category = 'usage_events' order by ran_at desc limit 1), 2000,
  'o relatório da retenção registra só a contagem');

select * from finish();
rollback;

-- Assistente parte 2, item 5 (revisão 06/11, T15): medição sem conteúdo, só acrescenta, só o dono lê, isolamento.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'b0000000-0000-4000-8000-00000000000b'::uuid as owner_b,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '10000000-0000-4000-8000-00000000000b'::uuid as tenant_b;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select is((select relrowsecurity from pg_class where oid = 'public.assist_events'::regclass), true, 'RLS ligada');
select ok(not has_table_privilege('authenticated', 'public.assist_events', 'insert'), 'sem escrita direta');
select ok(not has_function_privilege('anon', 'public.assist_event_record(uuid, text, text, integer)', 'execute'), 'anon não grava');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'assist_events'),
  array['id', 'tenant_id', 'event', 'surface', 'filled', 'created_at'], 'só evento, superfície e contagem: nenhuma coluna de conteúdo');

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(public.assist_event_record((select tenant_a from ids), 'assist.applied.v1', 'form:service', 3)->>'recorded', 'true', 'grava aplicado com a contagem');
select is(public.assist_event_record((select tenant_a from ids), 'assist.shown.v1', 'explain', 5)->>'recorded', 'true', 'grava mostrado');
select is((select filled from public.assist_events where event = 'assist.shown.v1'), null, 'contagem só em aplicado');
select throws_ok(format($$ select public.assist_event_record(%L, 'assist.clicked.v1', 'draft') $$, (select tenant_a from ids)), 'PT400', null, 'evento fora da lista');
select throws_ok(format($$ select public.assist_event_record(%L, 'assist.shown.v1', 'draft') $$, (select tenant_b from ids)), 'PT403', null, 'não grava em outro negócio');
reset role;
select throws_ok($$ update public.assist_events set filled = 0 $$, null, null, 'só acrescenta');

select pg_temp.login_as((select owner_b from ids));
set local role authenticated;
select is((select count(*)::int from public.assist_events), 0, 'dono de B não vê os eventos de A');
reset role;
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is((select count(*)::int from public.assist_events), 2, 'dono de A vê os próprios');
reset role;

select * from finish();
rollback;

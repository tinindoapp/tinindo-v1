-- P32 bloco 3 · painel do piloto: só a equipe Tinindo, período validado, só números e nomes de tela/operação.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'c3200000-0000-4000-8000-0000000000f3'::uuid as op,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.biz(p jsonb, t uuid) returns jsonb language sql as $$
  select b from jsonb_array_elements(p -> 'businesses') b where (b ->> 'tenant_id')::uuid = t
$$;

insert into auth.users (id) values ((select op from ids)) on conflict do nothing;
insert into public.platform_operators (user_id, display_name) values ((select op from ids), 'Operadora (exemplo)');
-- Uso de A na semana: duas telas, um comando ok e uma recusa.
insert into public.usage_events (tenant_id, kind, name, outcome, code, occurred_at) values
  ((select tenant_a from ids), 'screen', '/app/agenda', null, null, now() - interval '1 day'),
  ((select tenant_a from ids), 'screen', '/app/agenda', null, null, now() - interval '2 days'),
  ((select tenant_a from ids), 'command', 'scheduling/booking.create', 'ok', null, now() - interval '1 day'),
  ((select tenant_a from ids), 'command', 'scheduling/booking.cancel', 'refused', 'POLICY_REJECTED', now() - interval '1 day');
insert into public.usage_days (tenant_id, day) values ((select tenant_a from ids), current_date - 1);

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok($$ select public.pilot_panel(now() - interval '7 days', now()) $$, 'PT403', null, 'dono de negócio não lê o painel');
reset role;
select ok(not has_function_privilege('anon', 'public.pilot_panel(timestamptz, timestamptz)', 'execute'), 'anônimo não lê');

select pg_temp.login_as((select op from ids));
set local role authenticated;
select throws_ok($$ select public.pilot_panel(now(), now() - interval '1 day') $$, 'PT400', null, 'período invertido é recusado');
select throws_ok($$ select public.pilot_panel(now() - interval '120 days', now()) $$, 'PT400', null, 'período de mais de 92 dias é recusado');
create temp table p on commit drop as select public.pilot_panel(now() - interval '7 days', now()) as j;
reset role;

select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.biz((select j from p), (select tenant_a from ids))) k),
  array['cost', 'counts', 'funnel', 'name', 'profession', 'tenant_id', 'usage', 'usage_enabled'], 'cada negócio: só as seções do painel');
select is(pg_temp.biz((select j from p), (select tenant_a from ids)) #> '{usage,screens}',
  '[{"name": "/app/agenda", "count": 2}]'::jsonb, 'telas abertas na semana, com contagem');
select is(pg_temp.biz((select j from p), (select tenant_a from ids)) #> '{usage,problems}' -> 0 ->> 'code', 'POLICY_REJECTED',
  'onde recebeu recusa: operação e código');
select is(pg_temp.biz((select j from p), (select tenant_a from ids)) #>> '{usage,active_days}', '1', 'dias com uso na semana');
select ok(pg_temp.biz((select j from p), (select tenant_a from ids)) #> '{usage,opened_30d}' ? '/app/agenda', 'telas abertas em 30 dias, para achar as nunca abertas');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.biz((select j from p), (select tenant_a from ids)) -> 'counts') k),
  array['bookings_created', 'cancelled', 'no_shows', 'payments', 'services_done'], 'atendimentos e recebimentos só em número');
select ok((select j::text from p) !~ '(Cliente AB|cliente\.ab@|\+55|amount|cents)', 'nada de cliente, contato ou valor no painel');
select is((select j from p) #>> '{truncated,businesses}', 'false', 'avisa se cortou em 200');

select * from finish();
rollback;

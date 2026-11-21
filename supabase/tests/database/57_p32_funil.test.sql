-- P32 bloco 2 · funil do primeiro dia: passos pela data real dos dados, tempos entre passos, "voltou no dia seguinte",
-- só a equipe Tinindo lê, nenhum conteúdo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'c3200000-0000-4000-8000-0000000000f1'::uuid as op,
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  'c3200000-0000-4000-8000-0000000000e1'::uuid as tenant_new;
grant select on ids to authenticated;
create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.step(p jsonb, k text) returns jsonb language sql as $$
  select s from jsonb_array_elements(p -> 'steps') s where s ->> 'key' = k
$$;

insert into auth.users (id) values ((select op from ids)) on conflict do nothing;
insert into public.platform_operators (user_id, display_name) values ((select op from ids), 'Operadora (exemplo)');
-- Negócio novo, criado às 09:00 de São Paulo de 20/11.
insert into public.tenants (id, name, profession, timezone, created_at)
  values ((select tenant_new from ids), 'Negócio novo (exemplo)', 'barber', 'America/Sao_Paulo', '2026-11-20 12:00:00+00');

-- ------------------------------------------------------------------ só leitura de dados, sem conteúdo
select is((select array_agg(k order by k) from jsonb_object_keys(app.pilot_funnel_of((select tenant_new from ids))) k),
  array['done', 'signup_at', 'steps', 'tenant_id', 'timezone', 'total'], 'o funil só tem datas e contagens');
select is((select array_agg(s ->> 'key' order by n) from jsonb_array_elements(app.pilot_funnel_of((select tenant_new from ids)) -> 'steps') with ordinality x(s, n)),
  array['signup', 'configured', 'link_published', 'first_booking', 'first_service', 'first_payment', 'returned'],
  'sete passos, na ordem do primeiro dia');
select is(app.pilot_funnel_of((select tenant_new from ids)) ->> 'done', '1', 'negócio que só criou a conta: 1 de 7');
select is(pg_temp.step(app.pilot_funnel_of((select tenant_new from ids)), 'configured') ->> 'done', 'false', 'configurar não está feito');
select is(pg_temp.step(app.pilot_funnel_of((select tenant_new from ids)), 'returned') ->> 'done', 'false', 'ainda não voltou');

-- Voltou no dia seguinte (21/11 no fuso do negócio) por uso do app.
insert into public.usage_days (tenant_id, day) values ((select tenant_new from ids), '2026-11-21');
select is(pg_temp.step(app.pilot_funnel_of((select tenant_new from ids)), 'returned') ->> 'done', 'true', 'uso no dia seguinte conta como voltou');
delete from public.usage_days where tenant_id = (select tenant_new from ids);
-- No mesmo dia não conta.
insert into public.usage_days (tenant_id, day) values ((select tenant_new from ids), '2026-11-20');
select is(pg_temp.step(app.pilot_funnel_of((select tenant_new from ids)), 'returned') ->> 'done', 'false', 'uso no mesmo dia não conta');

-- ------------------------------------------------------------------ negócio do seed (com um agendamento)
insert into public.bookings (tenant_id, resource_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source, created_at)
values ((select tenant_a from ids), '20000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-0000000000a1',
  '2031-05-05 13:00:00+00', '2031-05-05 13:30:00+00', tstzrange('2031-05-05 13:00:00+00', '2031-05-05 13:40:00+00', '[)'),
  true, 'confirmed', 'owner', now());
select is(pg_temp.step(app.pilot_funnel_of((select tenant_a from ids)), 'signup') ->> 'minutes_since_previous', null,
  'a conta não tem passo anterior');
select ok((pg_temp.step(app.pilot_funnel_of((select tenant_a from ids)), 'first_booking') ->> 'done')::boolean, 'com um agendamento, o passo fica feito');
select ok(
  (select bool_and((s ->> 'minutes_since_signup')::bigint >= 0) from jsonb_array_elements(app.pilot_funnel_of((select tenant_a from ids)) -> 'steps') s
   where (s ->> 'done')::boolean and s ->> 'key' <> 'returned'),
  'tempo desde a conta nunca negativo');
select is(pg_temp.step(app.pilot_funnel_of((select tenant_a from ids)), 'first_booking') ->> 'at',
  app.sched_ts((select min(created_at) from public.bookings where tenant_id = (select tenant_a from ids))),
  'primeiro agendamento pela data real');

-- ------------------------------------------------------------------ acesso
select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select throws_ok($$ select public.pilot_funnel() $$, 'PT403', null, 'dono de negócio não lê o funil do piloto');
reset role;
select ok(not has_function_privilege('anon', 'public.pilot_funnel()', 'execute'), 'anônimo não lê');
select ok(not has_function_privilege('authenticated', 'app.pilot_funnel_of(uuid)', 'execute'), 'o cálculo por negócio não é público');

select pg_temp.login_as((select op from ids));
set local role authenticated;
select ok((select count(*) from jsonb_array_elements(public.pilot_funnel() -> 'businesses')) >= 3, 'a equipe vê todos os negócios');
select is(public.pilot_funnel() #>> '{truncated,businesses}', 'false', 'avisa se cortou em 200');
reset role;

select * from finish();
rollback;

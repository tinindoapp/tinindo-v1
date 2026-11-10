-- Recado #88: public.my_is_operator() diz só se o próprio usuário é operador ativo; anon não chama.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create temp table ids as select
  'a0000000-0000-4000-8000-00000000000a'::uuid as owner_a,
  'c0000000-0000-4000-8000-0000000000c1'::uuid as op_active,
  'c0000000-0000-4000-8000-0000000000c2'::uuid as op_inactive;
grant select on ids to anon, authenticated;

insert into public.platform_operators (user_id, display_name, active) values
  ((select op_active from ids), 'Operadora ativa', true),
  ((select op_inactive from ids), 'Operador inativo', false);

create function pg_temp.login_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select is(
  (select prosecdef from pg_proc where oid = 'public.my_is_operator()'::regprocedure), true,
  'my_is_operator é security definer (lê platform_operators sem política de leitura)'
);
select ok(not has_function_privilege('anon', 'public.my_is_operator()', 'execute'), 'anon não chama my_is_operator');
select ok(has_function_privilege('authenticated', 'public.my_is_operator()', 'execute'), 'authenticated chama my_is_operator');

select pg_temp.login_as((select op_active from ids));
set local role authenticated;
select is(public.my_is_operator(), true, 'operadora ativa: true');
reset role;

select pg_temp.login_as((select op_inactive from ids));
set local role authenticated;
select is(public.my_is_operator(), false, 'operador inativo: false');
reset role;

select pg_temp.login_as((select owner_a from ids));
set local role authenticated;
select is(public.my_is_operator(), false, 'dono de negócio sem cadastro na equipe: false');
select throws_ok($$ select count(*) from public.platform_operators $$, '42501', null,
  'o sinal não abre a tabela da equipe para o cliente');
reset role;

select * from finish();
rollback;

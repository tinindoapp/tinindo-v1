-- P56 · Rotinas periódicas isoladas (be-banco-03, linha P): a rotina que falha não derruba as outras da rodada,
-- o que ela escreveu é desfeito, o erro sai em `tick_errors` e fica registrado em job_ticks; rotina desligada não roda;
-- as chaves do retorno de jobs_run continuam as mesmas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create temp table ids as select
  '10000000-0000-4000-8000-00000000000a'::uuid as tenant_a,
  '20000000-0000-4000-8000-00000000000a'::uuid as res_a,
  '40000000-0000-4000-8000-0000000000a1'::uuid as corte_a;
create temp table r (k text primary key, v jsonb);
create function pg_temp.got(p_k text) returns jsonb language sql as $$ select v from r where k = p_k $$;

-- Estrutura e acesso
select has_table('public', 'job_ticks', 'registro de rotinas existe');
select is((select relrowsecurity from pg_class where oid = 'public.job_ticks'::regclass), true, 'RLS ligada no registro');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'job_ticks'), 0, 'sem política: fechado para leitura direta');
select ok(not has_table_privilege('authenticated', 'public.job_ticks', 'select'), 'authenticated não lê o registro');
select ok(not has_table_privilege('anon', 'public.job_ticks', 'select'), 'anon não lê o registro');
select ok(not has_function_privilege('authenticated', 'app.jobs_run_ticks(text)', 'execute'), 'authenticated não roda as rotinas');
select ok(not has_function_privilege('anon', 'public.jobs_run(integer)', 'execute'), 'anon não chama o worker');
select is(
  (select array_agg(j.name order by j.phase desc, j.position) from public.job_ticks j),
  array['expired_offers', 'expired_holds', 'recurrence', 'referrals', 'campaigns', 'advice', 'lifecycle', 'insights', 'retention', 'privacy_erasure', 'ops_watch', 'usage_retention'],
  'as oito rotinas de antes, na mesma ordem (seis antes da fila, duas depois), mais retenção e eliminação do P57 e o alerta do P58 e a retenção do uso (P32) no fim');
select is(
  (select count(*)::int from public.job_ticks j where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname = j.fn
      and case when j.takes_batch then p.pronargs >= 1 and p.proargtypes[0] = 'integer'::regtype and p.pronargs - p.pronargdefaults <= 1
               else p.pronargs = p.pronargdefaults end)),
  0, 'toda rotina registrada aponta para uma função que existe e aceita a chamada declarada (com ou sem lote)');
select throws_ok($$ insert into public.job_ticks (name, fn, phase, position) values ('x', 'pg_catalog.pg_sleep', 'before_outbox', 1) $$,
  '23514', null, 'só funções de app e public entram no registro');
select throws_ok($$ insert into public.job_ticks (name, fn, phase, position) values ('x', 'app.rc_tick(1); drop table x', 'before_outbox', 1) $$,
  '23514', null, 'nome de função com qualquer coisa além de letras é recusado');

-- Rodada sem falha: mesmas chaves de antes e tick_errors vazio
insert into r select 'ok', public.jobs_run(100);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.got('ok')) k),
  array['advice', 'campaigns', 'dead', 'done', 'expired_holds', 'expired_offers', 'insights', 'lifecycle', 'ops_watch', 'privacy_erasure', 'recurrence', 'referrals', 'retention', 'retried', 'tick_errors', 'usage_retention'],
  'retorno com as chaves de sempre mais tick_errors (e as rotinas do P57, do P58 e do P32)');
select is(pg_temp.got('ok')->'tick_errors', '{}'::jsonb, 'sem falha: tick_errors vazio');

-- Cenário: um hold vencido e um evento pendente esperando a rodada; três rotinas de teste, uma que falha no começo de
-- cada fase (depois de escrever) e uma que só anota que rodou, no fim.
create table public.zz_tick_log (who text not null, at timestamptz not null default clock_timestamp());
create function app.zz_boom(p_batch integer) returns jsonb language plpgsql as $$
begin
  insert into public.zz_tick_log (who) values ('boom');
  raise exception 'falha simulada na rotina';
end $$;
create function app.zz_mark() returns integer language plpgsql as $$
begin
  insert into public.zz_tick_log (who) values ('mark');
  return 1;
end $$;
insert into public.job_ticks (name, fn, takes_batch, phase, position) values
  ('zz_boom_before', 'app.zz_boom', true, 'before_outbox', 1),
  ('zz_boom_after', 'app.zz_boom', true, 'after_outbox', 1),
  ('zz_mark', 'app.zz_mark', false, 'after_outbox', 99);

insert into public.bookings (id, tenant_id, resource_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status,
  hold_expires_at, agreed_price_cents, source)
select '62000000-0000-4000-8000-0000000000a1', tenant_a, res_a, corte_a, now() + interval '3 days', now() + interval '3 days 30 minutes',
  tstzrange(now() + interval '3 days', now() + interval '3 days 30 minutes', '[)'), true, 'held', now() - interval '1 minute', 6000, 'owner'
from ids;
select is((select count(*)::int from public.outbox_events o where o.status = 'pending' and o.next_run_at <= clock_timestamp()), 0,
  'fila vazia antes do cenário');
insert into public.outbox_events (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, payload)
select tenant_a, 'booking.completed.v1', '62000000-0000-4000-8000-0000000000a1', 1, gen_random_uuid(), '{}'::jsonb from ids;

insert into r select 'boom', public.jobs_run(100);
select is(pg_temp.got('boom')->'tick_errors', jsonb_build_object('zz_boom_before', 'falha simulada na rotina', 'zz_boom_after', 'falha simulada na rotina'),
  'as duas falhas saem em tick_errors, com a mensagem');
select is(pg_temp.got('boom')->'zz_boom_before', 'null'::jsonb, 'rotina que falhou devolve null');
select is((pg_temp.got('boom')->>'expired_holds')::int, 1, 'o hold vencido expirou mesmo com a falha antes dele');
select is((select status from public.bookings where id = '62000000-0000-4000-8000-0000000000a1'), 'expired', 'reserva liberada');
select is((pg_temp.got('boom')->>'done')::int + (pg_temp.got('boom')->>'retried')::int, 1, 'a fila de eventos rodou depois da falha');
select is((pg_temp.got('boom')->>'zz_mark')::int, 1, 'rotina depois da que falhou, na mesma fase, rodou');
select is((select array_agg(who) from public.zz_tick_log), array['mark'], 'o que a rotina que falhou escreveu foi desfeito; o das outras ficou');
select ok(pg_temp.got('boom') ? 'lifecycle' and pg_temp.got('boom')->'lifecycle' <> 'null'::jsonb and pg_temp.got('boom')->'insights' <> 'null'::jsonb,
  'régua e insights rodaram depois da falha da própria fase');

-- Registro da falha para a operação; zera quando volta a passar
select is((select consecutive_failures from public.job_ticks where name = 'zz_boom_before'), 1, 'falha contada');
select ok((select last_error = 'falha simulada na rotina' and last_failed_at is not null from public.job_ticks where name = 'zz_boom_before'), 'último erro guardado');
create or replace function app.zz_boom(p_batch integer) returns jsonb language sql as $$ select '{"fixed": true}'::jsonb $$;
insert into r select 'fixed', public.jobs_run(100);
select ok(pg_temp.got('fixed')->'tick_errors' = '{}'::jsonb and (select consecutive_failures from public.job_ticks where name = 'zz_boom_before') = 0,
  'rotina corrigida: sem erro e contador zerado (o último erro fica como histórico)');

-- Desligar no registro
update public.job_ticks set enabled = false where name in ('zz_mark', 'insights');
delete from public.zz_tick_log;
insert into r select 'off', public.jobs_run(100);
select ok(not (pg_temp.got('off') ? 'zz_mark') and not (pg_temp.got('off') ? 'insights'), 'rotina desligada não aparece no retorno');
select is((select count(*)::int from public.zz_tick_log), 0, 'rotina desligada não roda');

select * from finish();
rollback;

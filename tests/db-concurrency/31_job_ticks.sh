#!/usr/bin/env bash
# P56 · Concorrência real das rotinas periódicas isoladas (job_ticks):
#  1. Quatro workers (jobs_run) ao mesmo tempo, com uma rotina que sempre falha no começo de cada fase → nenhum worker
#     aborta; todos devolvem o erro em tick_errors; o hold vencido expira uma vez; o evento pendente é entregue uma vez;
#     a rotina seguinte roda em todos; o que a rotina que falha escreveu não fica.
#  2. A rotina que falha segura um bloqueio de linha que outra rotina usa → sem deadlock, todos terminam.
#  3. Desligar a rotina no registro enquanto os workers rodam → nenhum erro; depois disso ela não roda mais.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
SVC_A=40000000-0000-4000-8000-0000000000a1
HOLD=62000000-0000-4000-8000-0000000000a1

psql -qX -v ON_ERROR_STOP=1 >/dev/null <<SQL
create table public.zz_tick_log (who text not null, at timestamptz not null default clock_timestamp());
create table public.zz_tick_counter (id integer primary key, n integer not null);
insert into public.zz_tick_counter values (1, 0);
-- Escreve, segura o bloqueio da linha do contador por um instante e falha: tudo isso tem de ser desfeito.
create function app.zz_boom(p_batch integer) returns jsonb language plpgsql as \$\$
begin
  insert into public.zz_tick_log (who) values ('boom');
  update public.zz_tick_counter set n = n + 1000 where id = 1;
  perform pg_sleep(0.05);
  raise exception 'falha simulada na rotina';
end \$\$;
-- Rotina boa que disputa a mesma linha.
create function app.zz_mark() returns integer language plpgsql as \$\$
begin
  insert into public.zz_tick_log (who) values ('mark');
  update public.zz_tick_counter set n = n + 1 where id = 1;
  return 1;
end \$\$;
insert into public.job_ticks (name, fn, takes_batch, phase, position) values
  ('zz_boom_before', 'app.zz_boom', true, 'before_outbox', 1),
  ('zz_mark_before', 'app.zz_mark', false, 'before_outbox', 2),
  ('zz_boom_after', 'app.zz_boom', true, 'after_outbox', 1),
  ('zz_mark_after', 'app.zz_mark', false, 'after_outbox', 99);
insert into public.bookings (id, tenant_id, resource_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status,
  hold_expires_at, agreed_price_cents, source)
values ('$HOLD', '$TENANT_A', '$RES_A', '$SVC_A', now() + interval '3 days', now() + interval '3 days 30 minutes',
  tstzrange(now() + interval '3 days', now() + interval '3 days 30 minutes', '[)'), true, 'held', now() - interval '1 minute', 6000, 'owner');
insert into public.outbox_events (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, payload)
values ('$TENANT_A', 'zz.tick.test.v1', '$HOLD', 1, gen_random_uuid(), '{}'::jsonb);
SQL

W=4
for w in $(seq 1 $W); do
  psql -qXtA -c "set role service_role; select public.jobs_run(50)" >"$TMP/p56j.$w" 2>&1 &
done
wait
sum() { cat "$TMP"/p56j.* | grep -o "\"$1\": [0-9]*" | awk -F': ' '{s+=$2} END {print s+0}'; }
check "nenhum worker abortou" "$(cat "$TMP"/p56j.* | grep -c ERROR || true)" 0
check "todos os workers devolveram a rodada" "$(cat "$TMP"/p56j.* | grep -c '"tick_errors"')" "$W"
check "todos relataram a falha das duas fases" "$(cat "$TMP"/p56j.* | grep -o '"zz_boom_[a-z]*": "falha simulada na rotina"' | wc -l | tr -d ' ')" "$((W * 2))"
check "hold vencido expirou" "$(psql -qXtA -c "select status from public.bookings where id = '$HOLD'")" expired
check "expiração contada uma vez entre os workers" "$(sum expired_holds)" 1
check "evento entregue uma vez entre os workers" "$(( $(sum done) + $(sum retried) + $(sum dead) ))" 1
check "evento saiu de pendente sem ficar preso" "$(psql -qXtA -c "select count(*) from public.outbox_events where aggregate_id = '$HOLD' and status = 'processing'")" 0
check "a rotina seguinte rodou em todos os workers, nas duas fases" "$(psql -qXtA -c "select count(*) from public.zz_tick_log where who = 'mark'")" "$((W * 2))"
check "nada do que a rotina que falha escreveu ficou" "$(psql -qXtA -c "select count(*) from public.zz_tick_log where who = 'boom'")" 0
check "contador: só as rotinas boas somaram (sem atualização perdida nem deadlock)" "$(psql -qXtA -c "select n from public.zz_tick_counter")" "$((W * 2))"
check "falha registrada para a operação (workers em paralelo não esperam um pelo outro para anotar)" "$(psql -qXtA -c "select consecutive_failures between 1 and $W and last_error = 'falha simulada na rotina' from public.job_ticks where name = 'zz_boom_before'")" t
check "rotinas do app seguiram rodando (régua e insights com resultado)" "$(cat "$TMP"/p56j.* | grep -c '"lifecycle": {' || true)" "$W"

# Desligar no meio: quatro workers rodando e o registro mudando ao mesmo tempo.
for w in $(seq 1 $W); do
  psql -qXtA -c "set role service_role; select public.jobs_run(50)" >"$TMP/p56k.$w" 2>&1 &
done
psql -qXtA -c "update public.job_ticks set enabled = false where name like 'zz_boom%'" >"$TMP/p56k.off" 2>&1 &
wait
check "desligar durante a rodada não derruba worker" "$(cat "$TMP"/p56k.* | grep -c ERROR || true)" 0
psql -qXtA -c "set role service_role; select public.jobs_run(50)" >"$TMP/p56l" 2>&1
check "depois de desligada, a rotina não roda nem aparece" "$(grep -c 'zz_boom' "$TMP/p56l" || true)" 0
check "rodada sem a rotina ruim: tick_errors vazio" "$(grep -c '"tick_errors": {}' "$TMP/p56l")" 1

finish "P56 concorrência"

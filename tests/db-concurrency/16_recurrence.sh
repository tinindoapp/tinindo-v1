#!/usr/bin/env bash
# P20 · Concorrência real da recorrência:
#  1. Renovação vencida com 3 workers em paralelo → UM ciclo novo (um pacote, um recebível, um evento).
#  2. Duas adesões da mesma cliente ao mesmo plano em paralelo → uma só.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
CORTE=40000000-0000-4000-8000-0000000000a1
ANA=30000000-0000-4000-8000-0000000000a1
H=$(printf 'a%.0s' $(seq 1 64))

PLAN=$(as_user "$OWNER_A" "select public.recurrence_plan_save('$TENANT_A', null, null, '$CORTE', 'Corte mensal', 4, 30, 20000, true, 'conc-rc-plan-000000001', '$H') #>> '{body,plan,id}'" | grep -E '^[0-9a-f-]{36}$')

# 2 · adesão dupla em paralelo (chaves diferentes)
for w in 1 2; do
  as_user "$OWNER_A" "select public.recurrence_subscribe('$TENANT_A', '$PLAN', '$ANA', 'conc-rc-sub-00000000$w', '$H')" >"$TMP/s.$w" 2>&1 &
done
wait
check "uma assinatura ativa da cliente no plano" "$(psql -qXtA -c "select count(*) from public.recurrence_subscriptions where status = 'active'")" 1
check "a segunda recusada por política" "$(cat "$TMP"/s.* | grep -c POLICY_REJECTED || true)" 1
check "um ciclo, um pacote, um recebível" "$(psql -qXtA -c "select (select count(*) from public.recurrence_cycles) || '/' || (select count(*) from public.session_packages) || '/' || (select count(*) from public.receivables where package_id is not null)")" "1/1/1"

# 1 · renovação vencida, 3 workers
psql -qX -c "update public.recurrence_subscriptions set next_renewal_at = now() - interval '1 minute'" >/dev/null
for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(100)" >"$TMP/j.$w" 2>&1 &
done
wait
check "um ciclo novo (2 no total)" "$(psql -qXtA -c "select count(*) from public.recurrence_cycles")" 2
check "ciclo 2 único" "$(psql -qXtA -c "select count(*) from public.recurrence_cycles where cycle_no = 2")" 1
check "dois pacotes e dois recebíveis" "$(psql -qXtA -c "select (select count(*) from public.session_packages) || '/' || (select count(*) from public.receivables where package_id is not null)")" "2/2"
check "um evento de ciclo aberto para o ciclo 2" "$(psql -qXtA -c "select count(*) from public.outbox_events where event_type = 'recurrence.cycle.opened.v1' and aggregate_version = 2")" 1
check "próxima renovação no futuro" "$(psql -qXtA -c "select (next_renewal_at > now())::int from public.recurrence_subscriptions")" 1
check "nenhum worker falhou" "$(cat "$TMP"/j.* | grep -c ERROR || true)" 0

finish "P20 concorrência"

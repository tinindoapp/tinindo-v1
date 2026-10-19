#!/usr/bin/env bash
# P18 · Concorrência real: 5 criações simultâneas da MESMA baseline (mesma chave) → 1 baseline, mesma resposta.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
for i in $(seq 1 5); do
  as_user "$OWNER_A" "select public.analytics_baseline_create('$TENANT_A', 'Antes', date_trunc('day', now()) - interval '28 days',
    date_trunc('day', now()), 'conc-an-baseline-0001', repeat('a', 64)) #>> '{body,baseline,id}'" >"$TMP/b.$i" 2>&1 &
done
wait
check "uma baseline" "$(psql -qXtA -c "select count(*) from public.analytics_baselines where tenant_id = '$TENANT_A'")" 1
check "todos recebem a mesma" "$(cat "$TMP"/b.* | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' ')" 1
check "nenhuma falhou" "$(cat "$TMP"/b.* | grep -c ERROR || true)" 0
finish "P18 concorrência"

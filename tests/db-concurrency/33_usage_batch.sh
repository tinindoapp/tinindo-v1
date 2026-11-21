#!/usr/bin/env bash
# P32 · Concorrência do lote de uso (usage_record):
#  1. O mesmo lote enviado por 8 abas ao mesmo tempo → gravado uma vez só.
#  2. 8 lotes diferentes ao mesmo tempo → todos gravados, nenhum perdido.
#  3. Desligar a medição enquanto lotes chegam → nenhum erro; depois de desligada, nada fica gravado.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
BATCH=c3300000-0000-4000-8000-000000000001
EV='[{"kind":"screen","name":"/app/agenda","at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"},{"kind":"command","name":"scheduling/booking.create","outcome":"ok","at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}]'

psql -qX -v ON_ERROR_STOP=1 -c "delete from public.usage_events where tenant_id = '$TENANT_A'; delete from public.usage_batches where tenant_id = '$TENANT_A'; delete from public.usage_settings where tenant_id = '$TENANT_A';" >/dev/null

W=8
for w in $(seq 1 $W); do
  as_user "$OWNER_A" "select public.usage_record('$TENANT_A', '$BATCH', '$EV'::jsonb)" >"$TMP/p32a.$w" 2>&1 &
done
wait
check "nenhuma aba recebeu erro com o mesmo lote" "$(cat "$TMP"/p32a.* | grep -c ERROR || true)" 0
check "o mesmo lote gravou uma vez (2 eventos)" "$(psql -qXtA -c "select count(*) from public.usage_events where tenant_id = '$TENANT_A'")" 2
check "as outras abas souberam que era repetido" "$(cat "$TMP"/p32a.* | grep -c '"duplicate": true' || true)" "$((W - 1))"

for w in $(seq 1 $W); do
  as_user "$OWNER_A" "select public.usage_record('$TENANT_A', gen_random_uuid(), '$EV'::jsonb)" >"$TMP/p32b.$w" 2>&1 &
done
wait
check "lotes diferentes em paralelo: nenhum erro" "$(cat "$TMP"/p32b.* | grep -c ERROR || true)" 0
check "lotes diferentes em paralelo: nenhum perdido" "$(psql -qXtA -c "select count(*) from public.usage_events where tenant_id = '$TENANT_A'")" "$((2 + W * 2))"

for w in $(seq 1 $W); do
  as_user "$OWNER_A" "select public.usage_record('$TENANT_A', gen_random_uuid(), '$EV'::jsonb)" >"$TMP/p32c.$w" 2>&1 &
done
as_user "$OWNER_A" "select public.usage_settings_set('$TENANT_A', false, 0, 'chave-concorrencia-uso-0001', repeat('a', 64))" >"$TMP/p32c.off" 2>&1 &
wait
check "desligar durante os envios não derruba ninguém" "$(cat "$TMP"/p32c.* | grep -c ERROR || true)" 0
check "desligada: a medição ficou desligada" "$(psql -qXtA -c "select enabled from public.usage_settings where tenant_id = '$TENANT_A'")" f
as_user "$OWNER_A" "select public.usage_record('$TENANT_A', gen_random_uuid(), '$EV'::jsonb)" >/dev/null 2>&1
check "depois de desligada, nenhum evento novo fica gravado" "$(psql -qXtA -c "select count(*) from public.usage_events where tenant_id = '$TENANT_A' and recorded_at > (select updated_at from public.usage_settings where tenant_id = '$TENANT_A')")" 0

psql -qX -c "delete from public.usage_settings where tenant_id = '$TENANT_A'; delete from public.usage_events where tenant_id = '$TENANT_A';" >/dev/null
finish "P32 concorrência do lote de uso"

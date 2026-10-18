#!/usr/bin/env bash
# P05 · Concorrência real das regras de preço:
#  1. 5 publicações simultâneas com a MESMA aprovação (chaves diferentes) → 1 regra publicada.
#  2. 2 propostas publicadas ao mesmo tempo para o mesmo serviço → 1 regra ativa (sem empilhar).
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
CORTE_A=40000000-0000-4000-8000-0000000000a1

propose() { # $1 chave, $2 desconto
  as_user "$OWNER_A" "select public.pricing_propose_rule('$TENANT_A', '$CORTE_A',
    '[{\"weekday\":2,\"local_start\":\"13:00\",\"local_end\":\"17:00\"}]', $2, $2, 0, now(), now() + interval '30 days',
    '$1', repeat('a', 64)) #>> '{body,proposal_id}'" | grep -E '^[0-9a-f-]{36}$'
}
approve() { # $1 proposta, $2 chave
  local hash
  hash=$(psql -qXtA -c "select payload_hash from public.pricing_rule_proposals where id = '$1'")
  as_user "$OWNER_A" "select public.pricing_approve_rule('$TENANT_A', '$1', '$hash', 1, '$2', repeat('b', 64)) #>> '{body,approval_id}'" \
    | grep -E '^[0-9a-f-]{36}$'
}

# 1 · mesma aprovação, 5 publicações simultâneas
P1=$(propose proposta-corrida-0000001 1500)
A1=$(approve "$P1" aprovacao-corrida-000001)
for i in $(seq 1 5); do
  as_user "$OWNER_A" "select public.pricing_publish_rule('$TENANT_A', '$P1', '$A1', 1, 'publica-corrida-$(printf '%08d' "$i")',
    repeat('c', 64))" >"$TMP/pub.$i" 2>&1 &
done
wait
check "uma aprovação publica uma regra" "$(psql -qXtA -c "select count(*) from public.pricing_rules where proposal_id = '$P1'")" 1
check "as outras 4 são recusadas" "$(cat "$TMP"/pub.* | grep -cE 'POLICY_REJECTED|STALE_VERSION' || true)" 4

# 2 · duas propostas publicadas ao mesmo tempo
P2=$(propose proposta-corrida-0000002 1000)
P3=$(propose proposta-corrida-0000003 2000)
A2=$(approve "$P2" aprovacao-corrida-000002)
A3=$(approve "$P3" aprovacao-corrida-000003)
as_user "$OWNER_A" "select public.pricing_publish_rule('$TENANT_A', '$P2', '$A2', 1, 'publica-paralela-000002', repeat('d', 64))" >"$TMP/par.2" 2>&1 &
as_user "$OWNER_A" "select public.pricing_publish_rule('$TENANT_A', '$P3', '$A3', 1, 'publica-paralela-000003', repeat('e', 64))" >"$TMP/par.3" 2>&1 &
wait
check "as duas publicações foram aceitas, em sequência" "$(cat "$TMP"/par.* | grep -c '"status_code": 200' || true)" 2
check "uma regra ativa por serviço" "$(psql -qXtA -c "select count(*) from public.pricing_rules where service_id = '$CORTE_A' and active")" 1
check "versões de regra não se repetem" "$(psql -qXtA -c "select count(*) = count(distinct rule_version) from public.pricing_rules where service_id = '$CORTE_A'")" t

finish "P05 concorrência"

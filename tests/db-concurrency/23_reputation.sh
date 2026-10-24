#!/usr/bin/env bash
# P24 · Concorrência real das avaliações: dois envios em paralelo para o mesmo atendimento (notas diferentes) → uma
# avaliação; o outro é recusado como regra (POLICY_REJECTED), nunca erro interno.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

CUST_USER=c0000000-0000-4000-8000-0000000000ab
TENANT_A=10000000-0000-4000-8000-00000000000a
CUST_A=30000000-0000-4000-8000-0000000000a1
BK=80000000-0000-4000-8000-0000000000c1

psql -qX -c "insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at) values ('$TENANT_A', '$CUST_A', '$CUST_USER', 'owner_invite_code', now());
  insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source)
  values ('$BK', '$TENANT_A', '20000000-0000-4000-8000-00000000000a', '$CUST_A', '40000000-0000-4000-8000-0000000000a1', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes',
    tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '40 minutes', '[)'), true, 'completed', 'owner')" >/dev/null
as_user "$CUST_USER" "select public.review_submit('$BK', 5, 'Ótimo atendimento')" >"$TMP/rep-s.1" 2>&1 &
as_user "$CUST_USER" "select public.review_submit('$BK', 2, 'Poderia ser melhor')" >"$TMP/rep-s.2" 2>&1 &
wait
check "uma avaliação por atendimento" "$(psql -qXtA -c "select count(*) from public.reviews where booking_id = '$BK'")" 1
check "o outro envio recusado como regra" "$(cat "$TMP"/rep-s.* | grep -c POLICY_REJECTED || true)" 1
check "nenhum erro interno" "$(cat "$TMP"/rep-s.* | grep -ci 'duplicate key' || true)" 0

finish "P24 concorrência"

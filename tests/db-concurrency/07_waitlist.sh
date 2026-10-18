#!/usr/bin/env bash
# P06 · Concorrência real da lista de espera e do worker:
#  1. 5 aceites simultâneos do MESMO link → 1 reserva confirmada e a mesma resposta para todos.
#  2. 3 workers rodando ao mesmo tempo sobre o mesmo cancelamento → candidatos sem duplicação.
#  3. 3 workers ao mesmo tempo com uma oferta vencida → 1 expiração (um evento).
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE_A=40000000-0000-4000-8000-0000000000a1
ANA=30000000-0000-4000-8000-0000000000a1
BRUNO=30000000-0000-4000-8000-0000000000a2
at() { echo "((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 8) + time '$1') at time zone 'America/Sao_Paulo'"; }
anon() { psql -qXtA -v ON_ERROR_STOP=1 -c "set role anon; $1"; }
worker() { psql -qXtA -v ON_ERROR_STOP=1 -c "select public.jobs_run(100)"; }

as_user "$OWNER_A" "select public.scheduling_rules_save('$TENANT_A', '$RES_A', (select version from public.resources where id = '$RES_A'),
  '[{\"weekday\":2,\"local_start\":\"09:00\",\"local_end\":\"19:00\"}]', 'conc-wl-regras-000001', repeat('a', 64))" >/dev/null
join_list() { # $1 cliente, $2 chave
  local consent
  consent=$(as_user "$OWNER_A" "select public.consent_record('$TENANT_A', '$1', 'waitlist_offer', 'manual_share', '$2-c', repeat('b', 64))
    #>> '{body,consent_id}'" | grep -E '^[0-9a-f-]{36}$')
  as_user "$OWNER_A" "select public.waitlist_join('$TENANT_A', '$1', '$CORTE_A', '[{\"weekday\":2,\"local_start\":\"09:00\",\"local_end\":\"19:00\"}]',
    '$consent', now() + interval '30 days', '$2-j', repeat('c', 64)) #>> '{body,id}'" | grep -E '^[0-9a-f-]{36}$'
}
E_ANA=$(join_list "$ANA" conc-wl-ana-000000001)
E_BRUNO=$(join_list "$BRUNO" conc-wl-bruno-0000001)

# 2 · três workers sobre o mesmo cancelamento
BID=$(as_user "$OWNER_A" "select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE_A', null, 'Visitante',
  $(at 10:00), $(at 10:00) + interval '30 minutes', null, 'confirm', 'conc-wl-reserva-000001', repeat('d', 64)) #>> '{body,booking,id}'" \
  | grep -E '^[0-9a-f-]{36}$')
as_user "$OWNER_A" "select public.scheduling_booking_cancel('$TENANT_A', '$BID', 1, 'Desmarcou', 'conc-wl-cancela-000001', repeat('e', 64))" >/dev/null
for i in 1 2 3; do worker >"$TMP/w.$i" 2>&1 & done
wait
check "workers paralelos não falham" "$(cat "$TMP"/w.* | grep -c ERROR || true)" 0
check "candidatos sem duplicação" "$(psql -qXtA -c "select count(*) from public.waitlist_candidates")" 2
check "evento processado uma vez (done)" "$(psql -qXtA -c "select status from public.outbox_events where aggregate_id = '$BID'
  and event_type = 'booking.cancelled.v1'")" done

# 1 · cinco aceites do mesmo link
quote() { as_user "$OWNER_A" "select public.pricing_quote('$TENANT_A', '$CORTE_A', '$RES_A', $(at "$1"), $(at "$1") + interval '30 minutes')
  #>> '{quote_id}'" | grep -E '^[0-9a-f-]{36}$'; }
offer() { # $1 entrada, $2 HH:MM, $3 chave → token
  as_user "$OWNER_A" "select public.waitlist_prepare_offer('$TENANT_A', '$1', $(at "$2"), $(at "$2") + interval '30 minutes',
    '$(quote "$2")', '$3', repeat('f', 64)) #>> '{body,token}'" | grep -E '^[A-Za-z0-9_-]{43}$'
}
TOKEN=$(offer "$E_ANA" 10:00 conc-wl-oferta-ana-001)
for i in $(seq 1 5); do anon "select public.waitlist_accept_offer('$TOKEN')" >"$TMP/acc.$i" 2>&1 & done
wait
check "uma reserva confirmada no horário" "$(psql -qXtA -c "select count(*) from public.bookings where starts_at = $(at 10:00)
  and status = 'confirmed'")" 1
check "todos recebem a mesma reserva" "$(cat "$TMP"/acc.* | grep -o '"id": "[0-9a-f-]*"' | sort -u | wc -l | tr -d ' ')" 1
check "nenhum aceite falhou" "$(cat "$TMP"/acc.* | grep -c ERROR || true)" 0

# 3 · oferta vencida com três workers
T2=$(offer "$E_BRUNO" 14:00 conc-wl-oferta-bru-001)
psql -qXtA -c "update public.waitlist_offers set expires_at = clock_timestamp() - interval '1 second' where status = 'offered'" >/dev/null
for i in 4 5 6; do worker >"$TMP/w.$i" 2>&1 & done
wait
check "uma expiração por oferta" "$(psql -qXtA -c "select count(*) from public.outbox_events where event_type = 'waitlist.offer.expired.v1'")" 1
check "hold liberado" "$(psql -qXtA -c "select count(*) from public.bookings where starts_at = $(at 14:00) and blocks_capacity")" 0
check "aceite tardio negado" "$(anon "select public.waitlist_accept_offer('$T2')" 2>&1 | grep -c POLICY_REJECTED || true)" 1

finish "P06 concorrência"

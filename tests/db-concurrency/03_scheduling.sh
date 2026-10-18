#!/usr/bin/env bash
# P03 · Concorrência real do motor de agenda (várias conexões ao mesmo tempo):
#  1. 20 pedidos simultâneos, chaves diferentes, MESMO horário → 1 reserva e 19 SLOT_CONFLICT.
#  2. 10 repetições simultâneas com a MESMA chave → 1 reserva e 10 respostas iguais.
#  3. Reagendar e reservar em paralelo para o mesmo horário → só um ganha; o perdedor fica como estava.
#  4. 2 cancelamentos simultâneos (chaves diferentes) → 1 evento de cancelamento.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
# Roda via scripts/db-concurrency.sh, que prepara PGDATABASE (migrations + seed) e exporta TMP.
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE_A=40000000-0000-4000-8000-0000000000a1
CUST_A=30000000-0000-4000-8000-0000000000a1
# Segunda-feira da próxima semana, horário de São Paulo.
at() { echo "((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + $1) + time '$2') at time zone 'America/Sao_Paulo'"; }
create() { # $1 chave, $2 dia, $3 HH:MM
  as_user "$OWNER_A" "select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE_A', '$CUST_A', null,
    $(at "$2" "$3"), $(at "$2" "$3") + interval '30 minutes', null, 'confirm', '$1', repeat('${1: -1}', 64))"
}

as_user "$OWNER_A" "select public.scheduling_rules_save('$TENANT_A', '$RES_A',
  (select version from public.resources where id = '$RES_A'),
  '[{\"weekday\":1,\"local_start\":\"09:00\",\"local_end\":\"19:00\"},{\"weekday\":2,\"local_start\":\"09:00\",\"local_end\":\"19:00\"}]',
  'chave-expediente-000001', repeat('e', 64))" >/dev/null

# 1 · 20 disputas
for i in $(seq 1 20); do
  create "disputa-$(printf '%013d' "$i")" 0 "10:00" >"$TMP/dispute.$i" 2>&1 &
done
wait
check "20 disputas geram 1 reserva" "$(psql -qXtA -c "select count(*) from public.bookings
  where starts_at = $(at 0 10:00) and status = 'confirmed'")" 1
check "19 recebem SLOT_CONFLICT" "$(cat "$TMP"/dispute.* | grep -c 'SLOT_CONFLICT' || true)" 19
check "1 evento de confirmação" "$(psql -qXtA -c "select count(*) from public.outbox_events e
  join public.bookings b on b.id = e.aggregate_id where b.starts_at = $(at 0 10:00)")" 1

# 2 · mesma chave
for i in $(seq 1 10); do
  create "mesma-chave-000000001" 0 "11:00" >"$TMP/same.$i" 2>&1 &
done
wait
check "mesma chave concorrente cria 1 reserva" "$(psql -qXtA -c "select count(*) from public.bookings
  where starts_at = $(at 0 11:00)")" 1
check "10 respostas idênticas" "$(cat "$TMP"/same.* | grep status_code | sort -u | wc -l | tr -d ' ')" 1
check "nenhuma das 10 falhou" "$(cat "$TMP"/same.* | grep -c 'ERROR' || true)" 0

# 3 · reagendar × reservar o mesmo horário
create "base-reagendar-0000001" 1 "09:00" >/dev/null
BID=$(psql -qXtA -c "select id from public.bookings where starts_at = $(at 1 09:00)")
as_user "$OWNER_A" "select public.scheduling_booking_reschedule('$TENANT_A', '$BID', 1,
  $(at 1 15:00), $(at 1 15:00) + interval '30 minutes', null, 'reagenda-corrida-000001', repeat('c', 64))" \
  >"$TMP/race.resch" 2>&1 &
create "reserva-corrida-0000001" 1 "15:00" >"$TMP/race.create" 2>&1 &
wait
check "só uma reserva ocupa o horário disputado" "$(psql -qXtA -c "select count(*) from public.bookings
  where starts_at = $(at 1 15:00) and blocks_capacity")" 1
check "o perdedor recebeu SLOT_CONFLICT" "$(cat "$TMP"/race.* | grep -c 'SLOT_CONFLICT' || true)" 1
if grep -q SLOT_CONFLICT "$TMP/race.resch"; then
  check "reagendamento perdedor preserva o horário original" "$(psql -qXtA -c "select starts_at = $(at 1 09:00)
    from public.bookings where id = '$BID'")" t
else
  check "reagendamento vencedor liberou o horário antigo" "$(psql -qXtA -c "select starts_at = $(at 1 15:00)
    from public.bookings where id = '$BID'")" t
fi

# 4 · dois cancelamentos simultâneos
CID=$(psql -qXtA -c "select id from public.bookings where starts_at = $(at 0 11:00)")
for k in a b; do
  as_user "$OWNER_A" "select public.scheduling_booking_cancel('$TENANT_A', '$CID', 1, 'Corrida',
    'cancela-corrida-00000$k', repeat('$k', 64))" >"$TMP/cancel.$k" 2>&1 &
done
wait
check "1 evento de cancelamento" "$(psql -qXtA -c "select count(*) from public.outbox_events
  where aggregate_id = '$CID' and event_type = 'booking.cancelled.v1'")" 1
check "o segundo cancelamento recebe STALE_VERSION" "$(cat "$TMP"/cancel.* | grep -c 'STALE_VERSION' || true)" 1

finish "P03 concorrência"

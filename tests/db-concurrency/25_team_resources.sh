#!/usr/bin/env bash
# P28 · Concorrência real das reservas compostas (várias conexões ao mesmo tempo):
#  1. 10 reservas simultâneas, cada uma com um profissional diferente e a MESMA cadeira → 1 reserva; nenhum
#     profissional perdedor fica com alocação (nada comprometido pela metade).
#  2. 10 reservas simultâneas com os mesmos recursos em ordens diferentes → 1 reserva e nenhum deadlock.
#  3. 10 repetições simultâneas com a MESMA chave → 1 reserva e respostas iguais.
#  4. Agenda individual vinculada: reserva da equipe × reserva solo no mesmo horário, 5 rodadas → nunca as duas.
#  5. Turma com 3 vagas e 10 inscrições simultâneas → 3 vagas, 7 recusas por lotação.
#  6. 5 conclusões simultâneas da mesma reserva (chaves diferentes) → 1 comissão e 1 recebível.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE=40000000-0000-4000-8000-0000000000a1
H=$(printf 'a%.0s' $(seq 1 64))
at() { echo "(((now() at time zone 'America/Sao_Paulo')::date + 3) + time '$1') at time zone 'America/Sao_Paulo'"; }
save() { # $1 chave, $2 tipo, $3 nome, $4 vincular agenda
  as_user "$OWNER_A" "select public.resources_save('$TENANT_A', null, null, '$2', '$3', true, null, $4, '$1', '$H') #>> '{body,resource,id}'" | grep -E '^[0-9a-f-]{36}$'
}
book() { # $1 chave, $2 profissional, $3 array de recursos, $4 HH:MM
  as_user "$OWNER_A" "$WAIT select public.resources_booking_create('$TENANT_A', '$CORTE', null, '$2', $3, $(at "$4"), '$1', '$H')"
}
# Largada: uma conexão segura um advisory lock; as concorrentes esperam por ele (WAIT) e saem juntas quando ele é solto.
# Sem isso, o tempo de abrir cada conexão serializa as transações e a corrida não acontece de verdade.
WAIT="select pg_advisory_lock_shared(2828); select pg_advisory_unlock_shared(2828);"
gate() {
  psql -qXtA -c "select pg_advisory_lock(2828); select pg_sleep(1.5); select pg_advisory_unlock(2828);" >/dev/null &
  until [ "$(psql -qXtA -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 2828 and granted")" = 1 ]; do :; done
}

psql -qX -c "insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
  select '$TENANT_A', '$RES_A', d, '08:00', '20:00' from generate_series(0, 6) d" >/dev/null
CHAIR=$(save conc-tm-chair-000000001 chair 'Cadeira 1' false)
ROOM=$(save conc-tm-room-0000000001 room 'Sala 1' false)
LINKED=$(save conc-tm-linked-00000001 professional 'Caio' true)
PROS=()
for i in $(seq 1 10); do PROS+=("$(save "conc-tm-prof-$(printf '%010d' "$i")" professional "Profissional $i" false)"); done

# 1 · mesma cadeira, profissionais diferentes
gate
for i in $(seq 0 9); do
  book "conc-tm-chair-race-$(printf '%04d' "$i")" "${PROS[$i]}" "array['$CHAIR']::uuid[]" "10:00" >"$TMP/c.$i" 2>&1 &
done
wait
check "uma reserva com a cadeira" "$(psql -qXtA -c "select count(*) from public.team_bookings where starts_at = $(at 10:00)")" 1
check "9 recusas por cadeira ocupada" "$(cat "$TMP"/c.* | grep -c 'SLOT_CONFLICT' || true)" 9
check "só 2 alocações (a do vencedor): nenhum profissional preso pela metade" "$(psql -qXtA -c "select count(*) from public.team_allocations where active")" 2

# 2 · mesmos recursos em ordens diferentes: sem deadlock
gate
for i in $(seq 0 9); do
  if (( i % 2 )); then arr="array['$CHAIR','$ROOM']::uuid[]"; else arr="array['$ROOM','$CHAIR']::uuid[]"; fi
  book "conc-tm-order-race-$(printf '%04d' "$i")" "${PROS[$i]}" "$arr" "13:00" >"$TMP/o.$i" 2>&1 &
done
wait
check "uma reserva com sala e cadeira" "$(psql -qXtA -c "select count(*) from public.team_bookings where starts_at = $(at 13:00)")" 1
check "nenhum deadlock" "$(cat "$TMP"/o.* | grep -ci 'deadlock' || true)" 0
check "9 conflitos" "$(cat "$TMP"/o.* | grep -c 'SLOT_CONFLICT' || true)" 9
check "3 alocações da reserva das 13h" "$(psql -qXtA -c "select count(*) from public.team_allocations a join public.team_bookings b on b.id = a.booking_id where b.starts_at = $(at 13:00)")" 3

# 3 · mesma chave
gate
for i in $(seq 1 10); do
  book "conc-tm-same-key-0000001" "${PROS[0]}" "null" "15:00" >"$TMP/k.$i" 2>&1 &
done
wait
check "mesma chave: 1 reserva" "$(psql -qXtA -c "select count(*) from public.team_bookings where starts_at = $(at 15:00)")" 1
check "10 respostas idênticas" "$(cat "$TMP"/k.* | grep status_code | sort -u | wc -l | tr -d ' ')" 1

# 4 · agenda individual × equipe
for round in 1 2 3 4 5; do
  gate
  t=$(printf '%02d:00' $((7 + round * 2)))
  book "conc-tm-linked-race-00$round" "$LINKED" "null" "$t" >"$TMP/l.$round.team" 2>&1 &
  as_user "$OWNER_A" "$WAIT select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE', null, null, $(at "$t"), $(at "$t") + interval '30 minutes',
    null, 'confirm', 'conc-tm-solo-race-0000$round', '$H')" >"$TMP/l.$round.solo" 2>&1 &
  wait
  won=$(( $(grep -c status_code "$TMP/l.$round.team" || true) + $(grep -c status_code "$TMP/l.$round.solo" || true) ))
  check "rodada $round: só uma das agendas fica com o horário" "$won" 1
done
check "nenhum erro fora de SLOT_CONFLICT" "$(cat "$TMP"/l.* | grep ERROR | grep -vc SLOT_CONFLICT || true)" 0

# 5 · turma com 3 vagas
psql -qX -c "insert into public.customers (tenant_id, name, declared_source) select '$TENANT_A', 'Aluna ' || g, 'walk_in' from generate_series(1, 10) g" >/dev/null
CLASS=$(as_user "$OWNER_A" "select public.resources_class_create('$TENANT_A', '$CORTE', '${PROS[5]}', null, 'Turma', $(at 18:00), 3, 2000, 'conc-tm-class-00000001', '$H') #>> '{body,class,id}'" | grep -E '^[0-9a-f-]{36}$')
i=0
gate
for c in $(psql -qXtA -c "select id from public.customers where name like 'Aluna %'"); do
  i=$((i + 1))
  as_user "$OWNER_A" "$WAIT select public.resources_class_enroll('$TENANT_A', '$CLASS', '$c', 'conc-tm-enroll-$(printf '%07d' "$i")', '$H')" >"$TMP/e.$i" 2>&1 &
done
wait
check "3 vagas ocupadas" "$(psql -qXtA -c "select count(*) from public.team_class_seats where class_id = '$CLASS' and status = 'booked'")" 3
check "7 recusas por lotação" "$(cat "$TMP"/e.* | grep -c 'POLICY_REJECTED' || true)" 7

# 6 · conclusões simultâneas
BID=$(psql -qXtA -c "select id from public.team_bookings where starts_at = $(at 10:00)")
psql -qX -c "update public.team_bookings set starts_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes',
  occupied_range = tstzrange(now() - interval '1 hour', now() - interval '20 minutes', '[)') where id = '$BID'" >/dev/null
V=$(psql -qXtA -c "select version from public.team_bookings where id = '$BID'")
gate
for i in $(seq 1 5); do
  as_user "$OWNER_A" "$WAIT select public.resources_booking_complete('$TENANT_A', '$BID', $V, 'conc-tm-done-$(printf '%09d' "$i")', '$H')" >"$TMP/d.$i" 2>&1 &
done
wait
check "uma comissão" "$(psql -qXtA -c "select count(*) from public.team_commission_entries where booking_id = '$BID'")" 1
check "um recebível" "$(psql -qXtA -c "select count(*) from public.receivables r join public.team_bookings b on b.receivable_id = r.id where b.id = '$BID'")" 1
check "uma conclusão aceita" "$(cat "$TMP"/d.* | grep -c status_code || true)" 1

finish "P28 concorrência"

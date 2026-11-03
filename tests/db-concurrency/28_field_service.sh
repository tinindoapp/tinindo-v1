#!/usr/bin/env bash
# P29 · Concorrência real do atendimento a domicílio (várias conexões ao mesmo tempo):
#  1. Marcar visita (o deslocamento ocupa a agenda) × reserva no mesmo horário pelo P03 → nunca os dois.
#  2. 5 marcações simultâneas de visitas do mesmo dia → um bloqueio de deslocamento por visita, sem sobreposição.
#  3. 10 repetições da mesma marcação com a mesma chave → uma visita, respostas idênticas.
#  4. 5 recálculos simultâneos do roteiro → um deslocamento por visita (nada duplicado).
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"
# Pasta própria: o $TMP do runner é o mesmo para todos os scripts (arquivos p.*, k.* de outros não entram na contagem).
TMP=$(mktemp -d "${TMP:-/tmp}/conc.XXXXXX")

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE=40000000-0000-4000-8000-0000000000a1
ANA=30000000-0000-4000-8000-0000000000a1
H=$(printf 'a%.0s' $(seq 1 64))
DAY=$(psql -qXtA -c "select (now() at time zone 'America/Sao_Paulo')::date + 4")
WAIT="select pg_advisory_lock_shared(2929); select pg_advisory_unlock_shared(2929);"
gate() {
  psql -qXtA -c "select pg_advisory_lock(2929); select pg_sleep(1.5); select pg_advisory_unlock(2929);" >/dev/null &
  until [ "$(psql -qXtA -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 2929 and granted")" = 1 ]; do :; done
}
at() { echo "(('$DAY'::date + '$1'::time) at time zone 'America/Sao_Paulo')"; }
book() { # $1 chave, $2 hh:mm, $3 espera?
  as_user "$OWNER_A" "${3:-} select public.scheduling_booking_create('$TENANT_A', '$RES_A', '$CORTE', '$ANA', null, $(at "$2"), $(at "$2") + interval '30 minutes', null, 'confirm', '$1', '$H') #>> '{body,booking,id}'"
}
attach() { # $1 chave, $2 reserva
  as_user "$OWNER_A" "$WAIT select public.field_visit_attach('$TENANT_A', '$2', '$ZONE', null, '$1', '$H')"
}

psql -qX -c "insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end)
  select '$TENANT_A', '$RES_A', d, '07:00', '21:00' from generate_series(0, 6) d" >/dev/null
as_user "$OWNER_A" "select public.field_settings_save('$TENANT_A', null, true, 30, 10, 30, null, 'conc-fs-settings-00001', '$H')" >/dev/null
ZONE=$(as_user "$OWNER_A" "select public.field_zone_save('$TENANT_A', null, null, 'Centro', array['01000'], 2, 40, true, 'conc-fs-zone-000000001', '$H') #>> '{body,zone,id}'" | grep -E '^[0-9a-f-]{36}$')
travel_blocks() { psql -qXtA -c "select count(*) from public.availability_blocks b join public.field_visits v on v.travel_block_id = b.id"; }

# 1 · visita às 10h (deslocamento 9h20–10h) × reserva às 9h30 pelo P03, 5 rodadas
both=0
for r in $(seq 1 5); do
  h=$(printf '%02d' $((7 + r * 2)))
  V=$(book "conc-fs-visit-r$r-000000" "$h:00" | grep -E '^[0-9a-f-]{36}$')
  gate
  attach "conc-fs-race-attach-r$r" "$V" >"$TMP/a.$r" 2>&1 &
  book "conc-fs-race-book-r$r-00" "$((10#$h - 1)):30" "$WAIT" >"$TMP/b.$r" 2>&1 &
  wait
  ok_a=$(grep -cE '"status_code": 20[01]' "$TMP/a.$r" || true)
  ok_b=$(grep -cE '^[0-9a-f-]{36}$' "$TMP/b.$r" || true)
  [ "$ok_a" -ge 1 ] && [ "$ok_b" -ge 1 ] && both=$((both + 1))
  [ "$ok_a" -ge 1 ] || [ "$ok_b" -ge 1 ] || both=$((both + 100))
done
check "deslocamento × reserva: nunca os dois, sempre um" "$both" 0
check "nenhum bloqueio sobreposto a reserva ativa" "$(psql -qXtA -c "select count(*) from public.availability_blocks a join public.bookings b on b.resource_id = a.resource_id and b.blocks_capacity and b.occupied_range && a.period where a.removed_at is null and a.tenant_id = '$TENANT_A'")" 0

# 2 · 5 visitas do outro dia marcadas ao mesmo tempo
DAY=$(psql -qXtA -c "select (now() at time zone 'America/Sao_Paulo')::date + 5")
mapfile -t B < <(for h in 08 10 12 14 16; do book "conc-fs-many-$h-00000000" "$h:00" | grep -E '^[0-9a-f-]{36}$'; done)
gate
for i in 0 1 2 3 4; do attach "conc-fs-many-attach-$i" "${B[$i]}" >"$TMP/m.$i" 2>&1 & done
wait
check "5 visitas marcadas" "$(psql -qXtA -c "select count(*) from public.field_visits where booking_id = any(array['${B[0]}','${B[1]}','${B[2]}','${B[3]}','${B[4]}']::uuid[])")" 5
check "um deslocamento por visita do dia" "$(psql -qXtA -c "select count(*) from public.availability_blocks b join public.field_visits v on v.travel_block_id = b.id where v.booking_id = any(array['${B[0]}','${B[1]}','${B[2]}','${B[3]}','${B[4]}']::uuid[])")" 5
check "nenhum deslocamento solto" "$(psql -qXtA -c "select count(*) from public.availability_blocks where label like 'Deslocamento%' and removed_at is null and id not in (select travel_block_id from public.field_visits where travel_block_id is not null)")" 0

# 3 · mesma chave
V3=$(book conc-fs-same-key-book-01 "18:30" | grep -E '^[0-9a-f-]{36}$')
gate
for i in $(seq 1 10); do attach conc-fs-same-key-000001 "$V3" >"$TMP/k.$i" 2>&1 & done
wait
check "uma visita com a chave" "$(psql -qXtA -c "select count(*) from public.field_visits where booking_id = '$V3'")" 1
check "respostas idênticas" "$(cat "$TMP"/k.* | grep status_code | sort -u | wc -l | tr -d ' ')" 1

# 4 · recálculos simultâneos
BEFORE=$(travel_blocks)
gate
for i in $(seq 1 5); do as_user "$OWNER_A" "$WAIT select public.field_route_rebuild('$TENANT_A', '$DAY', 'conc-fs-rebuild-00000$i', '$H')" >"$TMP/r.$i" 2>&1 & done
wait
check "recálculo não duplica deslocamento" "$(travel_blocks)" "$BEFORE"
check "nenhum deslocamento solto depois do recálculo" "$(psql -qXtA -c "select count(*) from public.availability_blocks where label like 'Deslocamento%' and removed_at is null and id not in (select travel_block_id from public.field_visits where travel_block_id is not null)")" 0

finish "P29 concorrência"

#!/usr/bin/env bash
# Agenda do personal · série e "cancelar os próximos" com várias conexões ao mesmo tempo:
#  1. 6 pedidos simultâneos da MESMA série (mesma chave) com terça e quinta → uma série só, 8 atendimentos, respostas iguais.
#  2. 6 séries diferentes disputando os mesmos horários → cada horário com um atendimento só (a exclusão é a barreira).
#  3. 6 "cancelar os próximos" simultâneos do mesmo atendimento com chaves diferentes → um cancela; os outros recebem
#     STALE_VERSION; cada atendimento é cancelado uma vez só (um evento por atendimento).
#  4. "Cancelar os próximos" e "concluir" o mesmo atendimento ao mesmo tempo → nunca os dois.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
CORTE_A=40000000-0000-4000-8000-0000000000a1
CUST_A=30000000-0000-4000-8000-0000000000a1
# Terça da próxima semana (+ $1 dias), às $2, em São Paulo.
at() { echo "((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 8 + $1) + time '$2') at time zone 'America/Sao_Paulo'"; }
series() { # $1 chave, $2 HH:MM
  as_user "$OWNER_A" "select public.scheduling_booking_create_series('$TENANT_A', '$RES_A', '$CORTE_A', '$CUST_A', null,
    $(at 0 "$2"), $(at 0 "$2") + interval '30 minutes', 4, false, '$1', encode(sha256(convert_to('$1', 'UTF8')), 'hex'), null, array[2, 4])"
}

as_user "$OWNER_A" "select public.scheduling_rules_save('$TENANT_A', '$RES_A',
  (select version from public.resources where id = '$RES_A'),
  (select jsonb_agg(jsonb_build_object('weekday', d, 'local_start', '06:00', 'local_end', '21:00')) from generate_series(1, 6) d),
  'chave-expediente-conc-32', repeat('e', 64))" >/dev/null

# 1 · mesma chave
for i in 1 2 3 4 5 6; do series "serie-concorrente-mesma-01" "07:00" >"$TMP/agsame.$i" 2>&1 & done
wait
check "mesma chave: uma série só" "$(psql -qXtA -c "select count(distinct series_id) from public.bookings
  where starts_at >= $(at 0 07:00) and to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') = '07:00' and series_id is not null")" 1
check "mesma chave: 8 atendimentos (terça e quinta, 4 semanas)" "$(psql -qXtA -c "select count(*) from public.bookings
  where to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') = '07:00' and starts_at >= $(at 0 07:00)")" 8
check "mesma chave: as 6 respostas são iguais" "$(for i in 1 2 3 4 5 6; do grep -o '"series_id": "[^"]*"' "$TMP/agsame.$i" | head -1; done | sort -u | wc -l | tr -d ' ')" 1

# 2 · séries diferentes, mesmos horários
for i in 1 2 3 4 5 6; do series "serie-concorrente-disp-0$i" "10:00" >"$TMP/agdisp.$i" 2>&1 || true & done
wait
check "disputa: cada horário das 10h com um atendimento só" "$(psql -qXtA -c "select coalesce(max(n), 0) from (select count(*) n from public.bookings
  where blocks_capacity and to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00' group by starts_at) x")" 1
check "disputa: os 8 horários foram ocupados" "$(psql -qXtA -c "select count(*) from public.bookings
  where blocks_capacity and to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00'")" 8

# 3 · cancelar os próximos ao mesmo tempo
FIRST=$(psql -qXtA -c "select id from public.bookings where to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') = '07:00'
  and starts_at >= $(at 0 07:00) order by starts_at offset 2 limit 1")
VER=$(psql -qXtA -c "select version from public.bookings where id = '$FIRST'")
for i in 1 2 3 4 5 6; do
  as_user "$OWNER_A" "select public.scheduling_booking_cancel_series_from('$TENANT_A', '$FIRST', $VER, 'Aluno saiu',
    'cancela-conc-0000$i', encode(sha256(convert_to('c$i', 'UTF8')), 'hex'))" >"$TMP/agcx.$i" 2>&1 || true &
done
wait
check "cancelar ao mesmo tempo: um só cancela" "$(cat "$TMP"/agcx.* | grep -c '"status_code" *: *200' || true)" 1
check "os outros recebem STALE_VERSION" "$(cat "$TMP"/agcx.* | grep -c 'STALE_VERSION' || true)" 5
check "6 cancelados (do 3º em diante)" "$(psql -qXtA -c "select count(*) from public.bookings where status = 'cancelled'
  and series_id = (select series_id from public.bookings where id = '$FIRST')")" 6
check "um evento por atendimento" "$(psql -qXtA -c "select count(*) from public.outbox_events where event_type = 'booking.cancelled.v1'
  and payload->>'series_id' = (select series_id::text from public.bookings where id = '$FIRST')")" 6

# 4 · cancelar os próximos × concluir o mesmo atendimento
TARGET=$(psql -qXtA -c "select id from public.bookings where blocks_capacity and status = 'confirmed'
  and to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00' order by starts_at limit 1")
psql -qXc "update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes',
  occupied_range = tstzrange(now() - interval '2 hours', now() - interval '80 minutes', '[)') where id = '$TARGET'" >/dev/null
TV=$(psql -qXtA -c "select version from public.bookings where id = '$TARGET'")
as_user "$OWNER_A" "select public.scheduling_booking_cancel_series_from('$TENANT_A', '$TARGET', $TV, 'x', 'corrida-cancela-0001', repeat('a', 64)); select pg_sleep(0.3)" >"$TMP/agrace.1" 2>&1 || true &
as_user "$OWNER_A" "select public.scheduling_booking_complete('$TENANT_A', '$TARGET', $TV, 'corrida-conclui-0001', repeat('b', 64)); select pg_sleep(0.3)" >"$TMP/agrace.2" 2>&1 || true &
wait
check "cancelar × concluir: um só vence" "$(cat "$TMP"/agrace.* | grep -cE '"status_code" *: *200' || true)" 1
check "o atendimento termina num estado só" "$(psql -qXtA -c "select status in ('cancelled', 'completed') from public.bookings where id = '$TARGET'")" t

finish "Agenda do personal · concorrência"

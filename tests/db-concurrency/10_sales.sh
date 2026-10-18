#!/usr/bin/env bash
# P11 · Concorrência real dos orçamentos (várias conexões ao mesmo tempo):
#  1. 5 aceites simultâneos do MESMO link → 1 decisão, 1 reserva e a mesma resposta para todos.
#  2. Dois orçamentos para o MESMO horário aceitos ao mesmo tempo → 1 aceito, o outro SLOT_CONFLICT sem decisão.
#  3. Aceite × revisão do dono ao mesmo tempo → nunca os dois: aceito com a versão vista ou revisado sem decisão.
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
ITEMS="'[{\"service_id\":\"$CORTE_A\",\"description\":\"Corte\",\"quantity\":1,\"unit_price_cents\":6000}]'"

as_user "$OWNER_A" "select public.scheduling_rules_save('$TENANT_A', '$RES_A', (select version from public.resources where id = '$RES_A'),
  '[{\"weekday\":2,\"local_start\":\"09:00\",\"local_end\":\"19:00\"}]', 'conc-qt-regras-000001', repeat('a', 64))" >/dev/null

# Cria e envia; imprime "quote_id token hash".
new_quote() { # $1 cliente, $2 HH:MM, $3 prefixo da chave
  local qid token hash
  qid=$(as_user "$OWNER_A" "select public.sales_quote_create('$TENANT_A', '$1', 'Corte', $ITEMS, now() + interval '7 days',
    '$CORTE_A', $(at "$2"), null, '$3-create', repeat('b', 64)) #>> '{body,quote,id}'" | grep -E '^[0-9a-f-]{36}$')
  token=$(as_user "$OWNER_A" "select public.sales_quote_send('$TENANT_A', '$qid', 1, '$3-send-0', repeat('c', 64))
    #>> '{body,token}'" | grep -E '^[A-Za-z0-9_-]{43}$')
  hash=$(psql -qXtA -c "select snapshot_hash from public.sales_quote_versions where quote_id = '$qid' and version_no = 1")
  echo "$qid $token $hash"
}

# 1 · cinco aceites do mesmo link
read -r Q1 T1 H1 <<<"$(new_quote "$ANA" 10:00 conc-qt-um-000000001)"
for i in $(seq 1 5); do anon "select public.sales_quote_accept('$T1', 1, '$H1')" >"$TMP/acc.$i" 2>&1 & done
wait
check "uma decisão" "$(psql -qXtA -c "select count(*) from public.sales_quote_decisions where quote_id = '$Q1'")" 1
check "uma reserva confirmada no horário" "$(psql -qXtA -c "select count(*) from public.bookings where starts_at = $(at 10:00)
  and status = 'confirmed'")" 1
check "todos recebem a mesma reserva" "$(cat "$TMP"/acc.* | grep -o '"id": "[0-9a-f-]*"' | sort -u | wc -l | tr -d ' ')" 1
check "nenhum aceite falhou" "$(cat "$TMP"/acc.* | grep -c ERROR || true)" 0
check "um evento de aceite" "$(psql -qXtA -c "select count(*) from public.outbox_events where aggregate_id = '$Q1'
  and event_type = 'sales.quote.accepted.v1'")" 1

# 2 · dois orçamentos, mesmo horário, aceites simultâneos
read -r QA TA HA <<<"$(new_quote "$ANA" 14:00 conc-qt-dois-a-00001)"
read -r QB TB HB <<<"$(new_quote "$BRUNO" 14:00 conc-qt-dois-b-00001)"
anon "select public.sales_quote_accept('$TA', 1, '$HA')" >"$TMP/two.a" 2>&1 &
anon "select public.sales_quote_accept('$TB', 1, '$HB')" >"$TMP/two.b" 2>&1 &
wait
check "um horário, uma reserva" "$(psql -qXtA -c "select count(*) from public.bookings where starts_at = $(at 14:00)
  and status = 'confirmed'")" 1
check "um aceito" "$(psql -qXtA -c "select count(*) from public.sales_quotes where id in ('$QA', '$QB') and status = 'accepted'")" 1
check "o outro recebe SLOT_CONFLICT" "$(cat "$TMP"/two.* | grep -c 'SLOT_CONFLICT' || true)" 1
check "o outro continua aberto sem decisão" "$(psql -qXtA -c "select count(*) from public.sales_quotes q where q.id in ('$QA', '$QB')
  and q.status = 'sent' and not exists (select 1 from public.sales_quote_decisions d where d.quote_id = q.id)")" 1

# 3 · aceite × revisão (10 rodadas)
bad=0
n=0
for hh in 09:00 11:00 11:45 12:30 13:15 15:00 15:45 16:30 17:15 18:00; do
  n=$((n + 1))
  read -r QR TR HR <<<"$(new_quote "$ANA" "$hh" "conc-qt-rev-$(printf '%010d' "$n")")"
  anon "select public.sales_quote_accept('$TR', 1, '$HR')" >"$TMP/race.acc" 2>&1 &
  as_user "$OWNER_A" "select public.sales_quote_revise('$TENANT_A', '$QR', 1, 'Corte', $ITEMS, now() + interval '8 days',
    null, null, null, 'conc-qt-rev-x-$(printf '%010d' "$n")', repeat('d', 64))" >"$TMP/race.rev" 2>&1 &
  wait
  state=$(psql -qXtA -c "select q.status || ':' || q.current_version || ':' || coalesce(d.version_no::text, '-')
    from public.sales_quotes q left join public.sales_quote_decisions d on d.quote_id = q.id where q.id = '$QR'")
  case "$state" in
    accepted:1:1) grep -q POLICY_REJECTED "$TMP/race.rev" || bad=1 ;;
    sent:2:-) grep -q STALE_VERSION "$TMP/race.acc" || bad=1 ;;
    *) bad=1; echo "estado inesperado: $state" ;;
  esac
done
check "aceite e revisão nunca valem os dois" "$bad" 0

finish "P11 concorrência"

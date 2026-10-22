#!/usr/bin/env bash
# P14 · Concorrência real do pagamento conectado:
#  1. A MESMA notificação "pago" entregue 5× em paralelo → 1 recebimento, 1 evento payment.recorded.v1.
#  2. 5 notificações "pago" DIFERENTES da mesma cobrança em paralelo → ainda 1 recebimento (already_settled).
#  3. Webhook e consulta de status (sync) correndo juntos sobre a mesma cobrança → 1 recebimento.
#  4. Dois pedidos de estorno em paralelo → um só aceito.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
ANA=30000000-0000-4000-8000-0000000000a1

charge() { # $1 = sufixo, $2 = centavos → id da cobrança (já pendente no provedor, external_id sim-$1)
  local rec cid
  rec=$(as_user "$OWNER_A" "select public.finance_receivable_create('$TENANT_A', '$ANA', 'Serviço $1', $2, null, 'conc-pay-rec-$1-0000001', repeat('a', 64)) #>> '{body,receivable,id}'" | grep -E '^[0-9a-f-]{36}$')
  cid=$(as_user "$OWNER_A" "select public.payment_charge_create('$TENANT_A', '$rec', 'simulated', 'conc-pay-charge-$1-000001', repeat('b', 64)) #>> '{body,charge,id}'" | grep -E '^[0-9a-f-]{36}$')
  psql -qXtA -c "select public.payment_charge_result('$cid', 'pending', 'sim-$1', 'pix', null, now() + interval '1 hour', null)" >/dev/null
  echo "$cid"
}
EV() { echo "[{\"external_event_id\":\"$1\",\"kind\":\"charge.paid\",\"external_id\":\"$2\",\"amount_cents\":$3,\"paid_at\":\"$(date -u +%FT%TZ)\"}]"; }

# 1 · mesma notificação 5×
C1=$(charge c1 6000)
for i in $(seq 1 5); do
  psql -qXtA -c "set role service_role; select public.payment_webhook_ingest('simulated', '$(EV evt-same sim-c1 6000)')" >"$TMP/w1.$i" 2>&1 &
done
wait
check "um recebimento" "$(psql -qXtA -c "select count(*) from public.payment_entries where charge_id = '$C1'")" 1
check "um evento payment.recorded.v1 da cobrança" "$(psql -qXtA -c "select count(*) from public.outbox_events where event_type = 'payment.recorded.v1' and payload->>'charge_id' = '$C1'")" 1
check "recebível pago uma vez (6000)" "$(psql -qXtA -c "select r.paid_cents from public.receivables r join public.payment_charges c on c.receivable_id = r.id where c.id = '$C1'")" 6000
check "nenhuma ingestão falhou" "$(cat "$TMP"/w1.* | grep -c ERROR || true)" 0

# 2 · notificações diferentes da mesma cobrança
C2=$(charge c2 4000)
for i in $(seq 1 5); do
  psql -qXtA -c "set role service_role; select public.payment_webhook_ingest('simulated', '$(EV evt-diff-$i sim-c2 4000)')" >"$TMP/w2.$i" 2>&1 &
done
wait
check "cinco eventos registrados" "$(psql -qXtA -c "select count(*) from public.payment_webhook_events where external_event_id like 'evt-diff-%'")" 5
check "mas um recebimento" "$(psql -qXtA -c "select count(*) from public.payment_entries where charge_id = '$C2'")" 1
check "quatro marcados como já baixados" "$(psql -qXtA -c "select count(*) from public.payment_webhook_events where external_event_id like 'evt-diff-%' and outcome = 'already_settled'")" 4

# 3 · webhook × consulta
C3=$(charge c3 2500)
psql -qXtA -c "set role service_role; select public.payment_webhook_ingest('simulated', '$(EV evt-race sim-c3 2500)')" >"$TMP/w3.a" 2>&1 &
psql -qXtA -c "set role service_role; select public.payment_sync_result('$C3', 'paid', 2500, now(), 'sim-c3')" >"$TMP/w3.b" 2>&1 &
wait
check "webhook e consulta juntos: um recebimento" "$(psql -qXtA -c "select count(*) from public.payment_entries where charge_id = '$C3'")" 1
check "nenhuma das duas falhou" "$(cat "$TMP"/w3.* | grep -c ERROR || true)" 0

# 4 · estorno em paralelo
for i in 1 2; do
  as_user "$OWNER_A" "select public.payment_refund_request('$TENANT_A', '$C1', 'desistiu', 'conc-pay-refund-00000$i', repeat('c', 64))" >"$TMP/rf.$i" 2>&1 &
done
wait
check "um estorno pedido" "$(psql -qXtA -c "select count(*) from public.payment_refunds where charge_id = '$C1'")" 1
check "o outro recusado por política" "$(cat "$TMP"/rf.* | grep -c POLICY_REJECTED || true)" 1

finish "P14 concorrência"

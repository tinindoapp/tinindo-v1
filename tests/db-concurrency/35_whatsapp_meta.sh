#!/usr/bin/env bash
# Integrações reais, bloco 2 · concorrência real do WhatsApp oficial (várias conexões ao mesmo tempo):
#  1. Status da Meta chegando JUNTO com o resultado do despacho (e repetido): nenhum se perde, nada regride.
#  2. Retentativa por limite com resultado duplicado em paralelo: cada mensagem volta UMA vez; depois, despachos em
#     paralelo não pegam a mesma mensagem duas vezes.
#  3. SAIR da cliente ao mesmo tempo que o despacho: nada fica na fila para ela; só sai o que o despacho já tinha pego.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
ACC=1029384756
svc() { psql -qXtA -v ON_ERROR_STOP=1 -c "set role service_role; $1"; }
inbound() { # $1 = id do evento, $2 = telefone, $3 = texto
  svc "select public.channel_webhook_ingest('whatsapp_cloud', jsonb_build_array(jsonb_build_object('external_event_id', '$1', 'kind', 'inbound', 'external_account_id', '$ACC', 'phone_e164', '$2', 'text', '$3')))"
}
status_ev() { # $1 = id do evento, $2 = id da mensagem na Meta, $3 = estado
  svc "select public.channel_webhook_ingest('whatsapp_cloud', jsonb_build_array(jsonb_build_object('external_event_id', '$1', 'kind', 'status', 'external_account_id', '$ACC', 'provider_message_id', '$2', 'status', '$3')))"
}
queue_text() { # $1 = contato, $2 = quantas
  psql -qXtA -v ON_ERROR_STOP=1 -c "insert into public.channel_messages (tenant_id, contact_id, direction, kind, body, status)
    select '$TENANT_A', '$1', 'outbound', 'text', 'conc ' || g, 'queued' from generate_series(1, $2) g" >/dev/null
}

CID=$(as_user "$OWNER_A" "select public.channel_connect('$TENANT_A', 'whatsapp_cloud', '+5511999990001', '$ACC', 'conc-wa-connect-0001', repeat('a', 64), null, '+5511988880001') #>> '{body,connection,id}'" | grep -E '^[0-9a-f-]{36}$')
psql -qX -c "update public.channel_connections set status = 'active', verified_at = now() where id = '$CID'" >/dev/null
inbound "msg:conc-ana" "+5511988887777" "oi" >/dev/null
inbound "msg:conc-bia" "+5511977776666" "oi" >/dev/null
ANA=$(psql -qXtA -c "select id from public.channel_contacts where phone_e164 = '+5511988887777'")
BIA=$(psql -qXtA -c "select id from public.channel_contacts where phone_e164 = '+5511977776666'")

# 1 · status junto com o resultado do despacho, 10 mensagens, cada uma com entregue ×3 e lido ×2 repetidos
queue_text "$ANA" 10
REFS=$(svc "select x->>'ref' from jsonb_array_elements(public.channel_dispatch_claim(50)->'items') x")
i=0
for ref in $REFS; do
  i=$((i + 1))
  svc "select public.channel_dispatch_result('$ref', 'sent', 'wamid.conc.$i', null)" >"$TMP/dr.$i" 2>&1 &
  for n in 1 2 3; do status_ev "st:wamid.conc.$i:delivered" "wamid.conc.$i" delivered >"$TMP/sd.$i.$n" 2>&1 & done
  for n in 1 2; do status_ev "st:wamid.conc.$i:read" "wamid.conc.$i" read >"$TMP/sr.$i.$n" 2>&1 & done
done
wait
check "10 mensagens reservadas" "$i" 10
check "todas terminam lidas (nenhum status perdido nem regredido)" "$(psql -qXtA -c "select count(*) from public.channel_messages where provider_message_id like 'wamid.conc.%' and status = 'read'")" 10
check "nada fica pendente sem aplicar" "$(psql -qXtA -c "select count(*) from public.channel_webhook_events where outcome = 'unmatched_message'")" 0
check "um registro por evento (repetição deduplicada)" "$(psql -qXtA -c "select count(*) from public.channel_webhook_events where external_event_id like 'st:wamid.conc.%'")" 20
check "nenhuma chamada falhou" "$(cat "$TMP"/dr.* "$TMP"/sd.* "$TMP"/sr.* | grep -c ERROR || true)" 0

# 2 · retentativa com resultado duplicado em paralelo; depois despachos em paralelo
queue_text "$ANA" 20
REFS=$(svc "select x->>'ref' from jsonb_array_elements(public.channel_dispatch_claim(50)->'items') x")
i=0
for ref in $REFS; do
  i=$((i + 1))
  for n in 1 2; do svc "select public.channel_dispatch_result('$ref', 'retry', null, 'throughput_limit') ->> 'status'" >"$TMP/rt.$i.$n" 2>&1 & done
done
wait
check "20 reservadas" "$i" 20
check "cada uma voltou para a fila uma vez só" "$(cat "$TMP"/rt.* | grep -c '^queued$' || true)" 20
check "a duplicata foi ignorada" "$(cat "$TMP"/rt.* | grep -c '^ignored$' || true)" 20
check "uma tentativa gasta e espera marcada" "$(psql -qXtA -c "select count(*) from public.channel_messages where status = 'queued' and attempts = 1 and next_attempt_at > now()")" 20
psql -qX -c "update public.channel_messages set next_attempt_at = now() - interval '1 second' where status = 'queued'" >/dev/null
for w in 1 2 3; do
  svc "select jsonb_array_length(public.channel_dispatch_claim(50)->'items')" >"$TMP/cl.$w" 2>&1 &
done
wait
TOTAL=$(cat "$TMP"/cl.* | grep -E '^[0-9]+$' | paste -sd+ - | bc)
check "despachos em paralelo: cada uma reservada uma vez (20 no total)" "$TOTAL" 20
check "nenhuma reservada duas vezes" "$(psql -qXtA -c "select count(*) from public.channel_messages where status = 'sending' and attempts = 2")" 20
psql -qX -c "update public.channel_messages set status = 'sent', sent_at = now() where status = 'sending'" >/dev/null

# 3 · SAIR ao mesmo tempo que o despacho
queue_text "$BIA" 15
svc "select jsonb_array_length(public.channel_dispatch_claim(50)->'items')" >"$TMP/cb.1" 2>&1 &
inbound "msg:conc-bia-sair" "+5511977776666" "SAIR" >"$TMP/cb.2" 2>&1 &
wait
check "nenhuma chamada falhou" "$(cat "$TMP"/cb.* | grep -c ERROR || true)" 0
check "nada fica na fila para quem saiu" "$(psql -qXtA -c "select count(*) from public.channel_messages where contact_id = '$BIA' and status = 'queued'")" 0
check "cada mensagem: falhou por opt-out ou já estava com o provedor" \
  "$(psql -qXtA -c "select count(*) from public.channel_messages where contact_id = '$BIA' and direction = 'outbound' and not (status = 'sending' or (status = 'failed' and failure_reason = 'opted_out'))")" 0
check "despacho seguinte não entrega nada a ela" "$(svc "select count(*) from jsonb_array_elements(public.channel_dispatch_claim(50)->'items') x where x->>'to' = '+5511977776666'")" 0

finish "WhatsApp oficial concorrência"

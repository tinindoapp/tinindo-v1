#!/usr/bin/env bash
# P12 · Concorrência real do canal (várias conexões ao mesmo tempo):
#  1. O MESMO evento de webhook entregue 5× em paralelo → 1 mensagem recebida, 1 evento no outbox.
#  2. 3 despachos em paralelo sobre 20 mensagens em fila → cada mensagem reservada por UM despacho.
#  3. 5 tentativas simultâneas de código errado → 5 tentativas contadas (nenhuma desfeita), depois bloqueio.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
CID=$(as_user "$OWNER_A" "select public.channel_connect('$TENANT_A', 'simulated', '+5511999990001', null, 'conc-ch-connect-000001', repeat('a', 64)) #>> '{body,connection,id}'" | grep -E '^[0-9a-f-]{36}$')
psql -qX -c "update public.channel_connections set status = 'active', verified_at = now() where id = '$CID'" >/dev/null

# 1 · mesmo evento 5×
EV="[{\"external_event_id\":\"conc-evt-1\",\"kind\":\"inbound\",\"external_account_id\":\"+5511999990001\",\"phone_e164\":\"+5511977776666\",\"text\":\"oi\"}]"
for i in $(seq 1 5); do
  psql -qXtA -c "set role service_role; select public.channel_webhook_ingest('simulated', '$EV')" >"$TMP/wh.$i" 2>&1 &
done
wait
check "uma mensagem recebida" "$(psql -qXtA -c "select count(*) from public.channel_messages where direction = 'inbound'")" 1
check "um contato" "$(psql -qXtA -c "select count(*) from public.channel_contacts")" 1
check "um evento no outbox" "$(psql -qXtA -c "select count(*) from public.outbox_events where event_type = 'channel.message.received.v1'")" 1
check "nenhuma ingestão falhou" "$(cat "$TMP"/wh.* | grep -c ERROR || true)" 0

# 2 · despacho em paralelo
K=$(psql -qXtA -c "select id from public.channel_contacts limit 1")
for i in $(seq 1 20); do
  as_user "$OWNER_A" "select public.channel_send('$TENANT_A', '$K', 'text', 'msg $i', null, null, 'conc-ch-send-$(printf '%010d' "$i")', repeat('b', 64))" >/dev/null
done
for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select jsonb_array_length(public.channel_dispatch_claim(50)->'items')" >"$TMP/cl.$w" 2>&1 &
done
wait
# 20 mensagens + 1 verificação pendente da primeira conexão: cada item sai em UM despacho.
check "21 itens reservados no total, sem repetição" "$(cat "$TMP"/cl.* | grep -E '^[0-9]+$' | paste -sd+ | bc)" 21
check "todas em 'enviando', nenhuma duas vezes" "$(psql -qXtA -c "select count(*) from public.channel_messages where status = 'sending' and attempts = 1")" 20

# 3 · tentativas de código em paralelo
as_user "$OWNER_A" "select public.channel_disconnect('$TENANT_A', 'conc-ch-disc-000001', repeat('c', 64))" >/dev/null
as_user "$OWNER_A" "select public.channel_connect('$TENANT_A', 'simulated', '+5511999990002', null, 'conc-ch-connect-000002', repeat('d', 64))" >/dev/null
for i in $(seq 1 5); do
  as_user "$OWNER_A" "select public.channel_verify('$TENANT_A', '00000$i', 'conc-ch-verify-$(printf '%08d' "$i")', repeat('e', 64)) ->> 'status_code'" >"$TMP/vf.$i" 2>&1 &
done
wait
check "cinco tentativas contadas" "$(psql -qXtA -c "select attempts from public.channel_verifications order by created_at desc limit 1")" 5
check "cinco respostas 422" "$(cat "$TMP"/vf.* | grep -c '^422$' || true)" 5
CODE=$(psql -qXtA -c "select code from public.channel_verifications order by created_at desc limit 1")
check "depois do limite, nem o código certo entra" "$(as_user "$OWNER_A" "select public.channel_verify('$TENANT_A', '$CODE', 'conc-ch-verify-ok-00001', repeat('f', 64))" 2>&1 | grep -c POLICY_REJECTED || true)" 1

finish "P12 concorrência"

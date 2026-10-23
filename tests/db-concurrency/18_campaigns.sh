#!/usr/bin/env bash
# P19 · Concorrência real das campanhas:
#  1. Duas aprovações em paralelo com o MESMO público visto: uma entra; a outra recebe STALE_VERSION ou público vazio
#     (quem entrou na primeira sai do público) — nenhuma cliente em dois braços ou duas campanhas em curso.
#  2. Três workers fecham a campanha vencida em paralelo: fecha uma vez, um evento, resultado congelado uma vez.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
H=$(printf 'a%.0s' $(seq 1 64))

psql -qX -c "insert into public.customers (id, tenant_id, name) select ('50000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, '$TENANT_A', 'Cliente ' || g from generate_series(1, 12) g;
  insert into public.lifecycle_consents (tenant_id, customer_id, purpose) select '$TENANT_A', ('50000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'marketing' from generate_series(1, 12) g" >/dev/null
HASH=$(as_user "$OWNER_A" "select public.campaign_preview('$TENANT_A', '{\"kind\":\"marketing_all\"}')->>'audience_hash'" | tail -n1)

for w in 1 2; do
  as_user "$OWNER_A" "select public.campaign_approve('$TENANT_A', 'Paralela $w', '{\"kind\":\"marketing_all\"}', '$HASH', 50, 100, null, 14, '{\"kind\":\"none\"}', 'conc-cp-approve-0000$w', '$H')" >"$TMP/a.$w" 2>&1 &
done
wait
check "uma campanha aprovada" "$(psql -qXtA -c "select count(*) from public.campaigns where tenant_id = '$TENANT_A'")" 1
check "a outra aprovação foi recusada (público mudou ou ficou vazio)" "$(cat "$TMP"/a.* | grep -cE 'STALE_VERSION|POLICY_REJECTED' || true)" 1
check "cada cliente em um braço só" "$(psql -qXtA -c "select count(*) from (select customer_id from public.campaign_members group by 1 having count(*) > 1) d")" 0
check "12 participantes: 6 controle, 6 tratadas" "$(psql -qXtA -c "select string_agg(arm || '=' || n, ',' order by arm) from (select arm, count(*) n from public.campaign_members group by 1) x")" "control=6,treatment=6"
check "6 passos de campanha" "$(psql -qXtA -c "select count(*) from public.lifecycle_steps where rule = 'campaign'")" 6

psql -qX -c "update public.campaigns set ends_at = clock_timestamp() - interval '1 minute'" >/dev/null
for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(100)" >"$TMP/j.$w" 2>&1 &
done
wait
check "fechada uma vez" "$(psql -qXtA -c "select count(*) from public.campaigns where status = 'closed' and result is not null")" 1
check "um evento de fechamento" "$(psql -qXtA -c "select count(*) from public.outbox_events where event_type = 'campaign.closed.v1'")" 1
check "soma de fechamentos entre os workers = 1" "$(cat "$TMP"/j.* | grep -o '"closed": [0-9]*' | awk -F': ' '{s+=$2} END {print s}')" 1
check "nenhum worker falhou" "$(cat "$TMP"/j.* | grep -c ERROR || true)" 0

finish "P19 concorrência"

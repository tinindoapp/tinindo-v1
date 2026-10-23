#!/usr/bin/env bash
# P22 · Concorrência real de metas e conteúdo:
#  1. Duas criações em paralelo da mesma meta (indicador + mês) com chaves diferentes → uma meta; a outra é recusada
#     como regra (POLICY_REJECTED), nunca erro interno.
#  2. Duas publicações em paralelo de textos diferentes → uma linha por negócio, versão 2, sem erro.
#  3. Três workers acompanham a mesma decisão vencida → acompanhada uma vez.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
H=$(printf 'a%.0s' $(seq 1 64))

for w in 1 2; do
  as_user "$OWNER_A" "select public.goal_save('$TENANT_A', null, null, 'occupancy', 0.6, null, 'Paralela $w', 'conc-goal-save-00000$w', '$H')" >"$TMP/g.$w" 2>&1 &
done
wait
check "uma meta ativa de ocupação" "$(psql -qXtA -c "select count(*) from public.goals where tenant_id = '$TENANT_A' and metric_key = 'occupancy' and status = 'active'")" 1
check "a outra criação foi recusada como regra" "$(cat "$TMP"/g.* | grep -c POLICY_REJECTED || true)" 1
check "nenhum erro interno (unique_violation vazado)" "$(cat "$TMP"/g.* | grep -ci 'duplicate key' || true)" 0

psql -qX -c "insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values ('$TENANT_A', 'barbearia-a', 'barber', 'Pinheiros', array['area','bio','display_name'], now())" >/dev/null
as_user "$OWNER_A" "select public.content_publish('$TENANT_A', 'bio_barber_classico', 'conc-content-000000001', '$H')" >"$TMP/c.1" 2>&1 &
as_user "$OWNER_A" "select public.content_publish('$TENANT_A', 'bio_barber_familia', 'conc-content-000000002', '$H')" >"$TMP/c.2" 2>&1 &
wait
check "um texto publicado por negócio" "$(psql -qXtA -c "select count(*) from public.profile_contents where tenant_id = '$TENANT_A'")" 1
check "duas publicações → versão 2" "$(psql -qXtA -c "select version from public.profile_contents where tenant_id = '$TENANT_A'")" 2
check "nenhuma publicação falhou" "$(cat "$TMP"/c.* | grep -c ERROR || true)" 0

psql -qX -c "insert into public.advice_decisions (tenant_id, rule_code, metric_key, decision, evidence, metric_before, follow_up_at)
  values ('$TENANT_A', 'no_show_reminders', 'no_show', 'accepted', '{}', '{\"value\": 0.3, \"status\": \"ok\"}', clock_timestamp() - interval '1 minute')" >/dev/null
for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(50)" >"$TMP/j.$w" 2>&1 &
done
wait
check "acompanhada uma vez" "$(cat "$TMP"/j.* | grep -o '"followed_up": [0-9]*' | awk -F': ' '{s+=$2} END {print s}')" 1
check "resultado registrado" "$(psql -qXtA -c "select count(*) from public.advice_decisions where outcome is not null")" 1
check "nenhum worker falhou" "$(cat "$TMP"/j.* | grep -c ERROR || true)" 0

finish "P22 concorrência"

#!/usr/bin/env bash
# P45 · Concorrência real do motor de insights:
#  1. Três workers (jobs_run) ao mesmo tempo → uma rodada por negócio no dia, um insight por (regra, assunto), um resumo
#     por semana; nenhum worker falha.
#  2. Duas avaliações diretas do mesmo negócio em paralelo (app.gi_run) → continua um insight por (regra, assunto).
#  3. Dois "Preparar" simultâneos do mesmo insight, com chaves diferentes → uma proposta de preço no P05; o outro é
#     recusado como regra/versão (nunca erro interno nem segunda proposta).
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
SVC_A=40000000-0000-4000-8000-0000000000a1
H=$(printf 'a%.0s' $(seq 1 64))

# Negócio A com 200 dias, expediente de segunda (9–11, cheio) e terça (14–16, vazio) e 10 atendimentos nas 5 semanas.
psql -qX -v ON_ERROR_STOP=1 >/dev/null <<SQL
update public.tenants set created_at = now() - interval '200 days' where id = '$TENANT_A';
insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end) values
  ('$TENANT_A', '$RES_A', 1, '09:00', '11:00'), ('$TENANT_A', '$RES_A', 2, '14:00', '16:00');
insert into public.bookings (tenant_id, resource_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, agreed_price_cents, source)
select '$TENANT_A', '$RES_A', '$SVC_A', s, s + interval '30 minutes', tstzrange(s, s + interval '30 minutes', '[)'), true, 'completed', 6000, 'owner'
from (select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date - 35 + 7 * k)::timestamp + make_interval(hours => hh)) at time zone 'America/Sao_Paulo' as s
      from generate_series(0, 4) k, (values (9), (10)) v(hh)) x;
SQL

for w in 1 2 3; do
  psql -qXtA -c "set role service_role; select public.jobs_run(50)" >"$TMP/j.$w" 2>&1 &
done
wait
check "uma rodada por negócio no dia" "$(psql -qXtA -c "select count(*) from public.insight_runs where tenant_id = '$TENANT_A'")" 1
check "rodadas somadas = negócios (sem avaliação dupla)" "$(cat "$TMP"/j.* | grep -o '"insights": {[^}]*}' | grep -o '"tenants": [0-9]*' | awk -F': ' '{s+=$2} END {print s}')" "$(psql -qXtA -c "select count(*) from public.tenants where status = 'active'")"
check "um insight de horário ocioso" "$(psql -qXtA -c "select count(*) from public.insights where tenant_id = '$TENANT_A' and rule_code = 'idle_slot'")" 1
check "nenhum insight duplicado por (regra, assunto)" "$(psql -qXtA -c "select count(*) from (select 1 from public.insights group by tenant_id, rule_code, subject_key having count(*) > 1) x")" 0
check "nenhum worker falhou" "$(cat "$TMP"/j.* | grep -c ERROR || true)" 0

for w in 1 2; do
  psql -qXtA -c "select app.gi_run('$TENANT_A', now())" >"$TMP/r.$w" 2>&1 &
done
wait
check "duas avaliações em paralelo: ainda um insight" "$(psql -qXtA -c "select count(*) from public.insights where tenant_id = '$TENANT_A' and rule_code = 'idle_slot'")" 1
check "nenhuma avaliação falhou" "$(cat "$TMP"/r.* | grep -c ERROR || true)" 0

ID=$(psql -qXtA -c "select id from public.insights where tenant_id = '$TENANT_A' and rule_code = 'idle_slot'")
VER=$(psql -qXtA -c "select version from public.insights where id = '$ID'")
for w in 1 2; do
  as_user "$OWNER_A" "select public.insight_act('$TENANT_A', '$ID', $VER, 'conc-insight-act-00000$w', '$H')" >"$TMP/a.$w" 2>&1 &
done
wait
check "uma proposta de preço (P05)" "$(psql -qXtA -c "select count(*) from public.pricing_rule_proposals where tenant_id = '$TENANT_A'")" 1
check "o outro clique foi recusado como versão/regra" "$(cat "$TMP"/a.* | grep -cE 'STALE_VERSION|POLICY_REJECTED' || true)" 1
check "nenhuma regra de preço publicada" "$(psql -qXtA -c "select count(*) from public.pricing_rules where tenant_id = '$TENANT_A'")" 0
check "nenhum erro interno" "$(cat "$TMP"/a.* | grep -ciE 'duplicate key|internal' || true)" 0

finish "P45 concorrência"

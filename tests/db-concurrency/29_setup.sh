#!/usr/bin/env bash
# P44 · Concorrência real da configuração guiada (várias conexões ao mesmo tempo):
#  1. 10 repetições de "criar serviços" com a mesma chave → os serviços entram uma vez, respostas idênticas.
#  2. 10 lotes diferentes com o mesmo nome de serviço → só um cria; os outros recebem 400 no campo name (nada duplicado).
#  3. 8 leituras simultâneas do progresso logo depois do expediente → um evento `setup.step_completed.v1` por passo.
#  4. 6 dispensas simultâneas do mesmo passo opcional → uma linha de dispensa.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"
TMP=$(mktemp -d "${TMP:-/tmp}/conc.XXXXXX")

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
RES_A=20000000-0000-4000-8000-00000000000a
H=$(printf 'c%.0s' $(seq 1 64))
WAIT="select pg_advisory_lock_shared(4444); select pg_advisory_unlock_shared(4444);"
gate() {
  psql -qXtA -c "select pg_advisory_lock(4444); select pg_sleep(1.5); select pg_advisory_unlock(4444);" >/dev/null &
  until [ "$(psql -qXtA -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 4444 and granted")" = 1 ]; do :; done
}
SERVICES='[{"template_code":"barber_corte_barba","name":"Corte e barba","duration_min":50,"base_price_cents":7000},{"name":"Sobrancelha conc","duration_min":15,"base_price_cents":2000}]'

# 1. mesma chave, 10 vezes
gate
for i in $(seq 1 10); do
  as_user "$OWNER_A" "$WAIT select public.setup_services_apply('$TENANT_A', '$SERVICES', 'idem-conc-setup-apply-0001', '$H')" > "$TMP/same.$i" 2>&1 &
done
wait
check "1a. os serviços do lote entram uma vez" "$(psql -qXtA -c "select count(*) from public.provider_services where tenant_id = '$TENANT_A' and name in ('Corte e barba', 'Sobrancelha conc')")" "2"
check "1b. as 10 respostas são idênticas" "$(grep -h '^{"body"' "$TMP"/same.* | sort -u | wc -l | tr -d ' ')" "1"
check "1c. as 10 chamadas responderam" "$(grep -l '^{"body"' "$TMP"/same.* | wc -l | tr -d ' ')" "10"

# 2. lotes diferentes (chaves diferentes) com o mesmo nome novo
gate
for i in $(seq 1 10); do
  as_user "$OWNER_A" "$WAIT select public.setup_services_apply('$TENANT_A', '[{\"name\":\"Hidratação conc\",\"duration_min\":45,\"base_price_cents\":9000},{\"name\":\"Extra $i\",\"duration_min\":30,\"base_price_cents\":1000}]', 'idem-conc-setup-dup-00$(printf '%02d' "$i")', '$H')" > "$TMP/dup.$i" 2>&1 || true &
done
wait
check "2a. o nome repetido entra uma vez" "$(psql -qXtA -c "select count(*) from public.provider_services where tenant_id = '$TENANT_A' and name = 'Hidratação conc'")" "1"
check "2b. só o lote vencedor criou o seu Extra (tudo ou nada nos outros)" "$(psql -qXtA -c "select count(*) from public.provider_services where tenant_id = '$TENANT_A' and name like 'Extra %'")" "1"
# O P02 recusa o nome repetido antes de inserir (VALIDATION_ERROR) ou, sob corrida, pelo índice único dos ativos: nos dois
# casos o lote inteiro falha e nada entra.
check "2c. os outros 9 lotes falham inteiros" "$(grep -L '^{"body"' "$TMP"/dup.* | wc -l | tr -d ' ')" "9"
check "2d. um lote responde 201" "$(grep -l '"status_code": 201' "$TMP"/dup.* | wc -l | tr -d ' ')" "1"

# 3. leituras simultâneas do progresso → um evento por passo
psql -qXtA -c "insert into public.availability_rules (tenant_id, resource_id, weekday, local_start, local_end) select '$TENANT_A', '$RES_A', d, '09:00', '18:00' from generate_series(1, 5) d" >/dev/null
gate
for i in $(seq 1 8); do
  as_user "$OWNER_A" "$WAIT select public.setup_progress('$TENANT_A') ->> 'done_count'" > "$TMP/prog.$i" 2>&1 &
done
wait
check "3a. as 8 leituras veem o mesmo total" "$(grep -hx '[0-9][0-9]*' "$TMP"/prog.* | sort -u | wc -l | tr -d ' ')" "1"
check "3b. um evento por passo feito (horários, serviço, cliente)" "$(psql -qXtA -c "select count(*) from public.outbox_events where tenant_id = '$TENANT_A' and event_type = 'setup.step_completed.v1'")" \
  "$(psql -qXtA -c "select count(*) from public.setup_step_completions where tenant_id = '$TENANT_A'")"
check "3c. nenhum passo com dois eventos" "$(psql -qXtA -c "select count(*) from (select payload->>'step' s from public.outbox_events where tenant_id = '$TENANT_A' and event_type = 'setup.step_completed.v1' group by 1 having count(*) > 1) x")" "0"

# 4. dispensas simultâneas do mesmo passo opcional
gate
for i in $(seq 1 6); do
  as_user "$OWNER_A" "$WAIT select public.setup_dismiss('$TENANT_A', 'channel', true, 'idem-conc-setup-dismiss-$(printf '%02d' "$i")', '$H') ->> 'status_code'" > "$TMP/dis.$i" 2>&1 &
done
wait
check "4a. uma dispensa só" "$(psql -qXtA -c "select count(*) from public.setup_dismissals where tenant_id = '$TENANT_A' and step = 'channel'")" "1"
check "4b. todas as 6 respondem 200" "$(cat "$TMP"/dis.* | grep -c '^200$')" "6"

rm -rf "$TMP"
finish "P44 concorrência"

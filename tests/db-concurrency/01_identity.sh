#!/usr/bin/env bash
# Concorrência real (várias conexões ao mesmo tempo), que pgTAP numa transação só não cobre:
#  1. 10 chamadas simultâneas de business.create com a MESMA chave → 1 negócio, 10 respostas iguais.
#  2. 10 chamadas simultâneas com chaves DIFERENTES do mesmo dono → no máximo 3 negócios (cota).
#  3. 2 logins resgatam o MESMO código ao mesmo tempo → exatamente 1 vínculo.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
# Roda via scripts/db-concurrency.sh, que prepara PGDATABASE (migrations + seed) e exporta TMP.
source "$(dirname "$0")/lib.sh"

OUTSIDER=d0000000-0000-4000-8000-0000000000dd
OWNER_A=a0000000-0000-4000-8000-00000000000a
CUSTOMER_AB=c0000000-0000-4000-8000-0000000000ab

# 1 · mesma chave
for i in $(seq 1 10); do
  as_user "$OUTSIDER" "select public.business_create('Concorrente', 'barber', 'America/Sao_Paulo',
    array['termos-piloto-v0'], 'chave-concorrente-000001', repeat('a', 64))" >"$TMP/same.$i" 2>&1 &
done
wait
check "mesma chave concorrente cria 1 negócio" \
  "$(psql -qXtA -c "select count(*) from public.tenant_memberships where user_id = '$OUTSIDER'")" 1
check "10 respostas idênticas" "$(cat "$TMP"/same.* | grep status_code | sort -u | wc -l | tr -d ' ')" 1
check "nenhuma das 10 falhou" "$(cat "$TMP"/same.* | grep -c 'ERROR' || true)" 0

# 2 · cota com chaves diferentes (o dono já tem 1 negócio)
for i in $(seq 1 10); do
  as_user "$OUTSIDER" "select public.business_create('Paralelo $i', 'other', 'America/Sao_Paulo',
    array['termos-piloto-v0'], 'chave-paralela-$(printf '%010d' "$i")', repeat('b', 64))" >"$TMP/quota.$i" 2>&1 &
done
wait
check "cota de 3 negócios respeitada sob concorrência" \
  "$(psql -qXtA -c "select count(*) from public.tenant_memberships where user_id = '$OUTSIDER' and role = 'owner'")" 3
check "recursos = negócios (nada parcial)" \
  "$(psql -qXtA -c "select count(*) from public.resources r join public.tenant_memberships m on m.tenant_id = r.tenant_id where m.user_id = '$OUTSIDER'")" 3

# 3 · dois logins, mesmo código
CODE=$(as_user "$OWNER_A" "select public.customer_link_issue('10000000-0000-4000-8000-00000000000a',
  '30000000-0000-4000-8000-0000000000a1', 'chave-emissao-0000000001', repeat('c', 64)) #>> '{body,code}'" | grep -E '^[A-Za-z0-9_-]{43}$')
for u in "$CUSTOMER_AB" "$OUTSIDER"; do
  as_user "$u" "select public.customer_link_redeem('$CODE', 'chave-resgate-00000000001', repeat('d', 64))" \
    >"$TMP/redeem.$u" 2>&1 &
done
wait
check "código disputado gera 1 vínculo" "$(psql -qXtA -c "select count(*) from public.customer_links where customer_id = '30000000-0000-4000-8000-0000000000a1'")" 1
check "o perdedor recebe NOT_FOUND" "$(cat "$TMP"/redeem.* | grep -c 'NOT_FOUND' || true)" 1

finish "P01 concorrência"

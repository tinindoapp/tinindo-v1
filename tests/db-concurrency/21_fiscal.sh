#!/usr/bin/env bash
# P16 · Concorrência real do fiscal: duas emissões em paralelo para o mesmo recebível (chaves diferentes) → uma nota viva;
# a outra é recusada como regra (POLICY_REJECTED), nunca erro interno.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
REC=60000000-0000-4000-8000-0000000000c1
H=$(printf 'a%.0s' $(seq 1 64))

psql -qX -c "insert into public.receivables (id, tenant_id, description, amount_cents) values ('$REC', '$TENANT_A', 'Corte', 6000);
  insert into public.fiscal_profiles (tenant_id, legal_name, cnpj, regime, municipality_ibge, service_code) values ('$TENANT_A', 'Barbearia Exemplo A ME', '11222333000181', 'mei', '3550308', '06.01');
  insert into public.fiscal_representations (tenant_id, terms_hash, granted_by, valid_until) values ('$TENANT_A', app.fsc_terms_hash(), '$OWNER_A', now() + interval '300 days');
  insert into public.fiscal_credentials (tenant_id, status, valid_until, environment) values ('$TENANT_A', 'valid', now() + interval '1 year', 'homologacao')" >/dev/null
# Data local do negócio: fiscal_emit recusa competência depois dela, e current_date (UTC) já é o dia seguinte
# entre 00:00 e 03:00 UTC em America/Sao_Paulo.
DAY=$(psql -qXtA -c "select (clock_timestamp() at time zone timezone)::date from public.tenants where id = '$TENANT_A'")
for w in 1 2; do
  as_user "$OWNER_A" "select public.fiscal_emit('$TENANT_A', '$REC', 'Cliente', null, 'Corte de cabelo', 6000, '$DAY', 'conc-fsc-emit-00000$w', '$H')" >"$TMP/fsc-e.$w" 2>&1 &
done
wait
check "uma nota viva para o recebível" "$(psql -qXtA -c "select count(*) from public.fiscal_documents where receivable_id = '$REC'")" 1
check "a outra emissão foi recusada como regra" "$(cat "$TMP"/fsc-e.* | grep -c POLICY_REJECTED || true)" 1
check "nenhum erro interno (unique_violation vazado)" "$(cat "$TMP"/fsc-e.* | grep -ci 'duplicate key' || true)" 0
check "recebível intacto" "$(psql -qXtA -c "select status || ':' || paid_cents from public.receivables where id = '$REC'")" "open:0"

finish "P16 concorrência"

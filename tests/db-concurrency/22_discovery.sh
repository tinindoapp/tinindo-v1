#!/usr/bin/env bash
# P23 · Concorrência real do diretório: dois salvamentos em paralelo da mesma listagem com a mesma versão → um vale,
# o outro recebe STALE_VERSION (nunca erro interno nem duas listagens).
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
TENANT_A=10000000-0000-4000-8000-00000000000a
H=$(printf 'a%.0s' $(seq 1 64))

psql -qX -c "insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values ('$TENANT_A', 'barbearia-a', 'barber', 'Pinheiros', array['area','display_name'], now())" >/dev/null
for w in 1 2; do
  as_user "$OWNER_A" "select public.discovery_save('$TENANT_A', 0, 'SP', 'Cidade $w', false, true, 'conc-dsc-save-000000$w', '$H')" >"$TMP/dsc-s.$w" 2>&1 &
done
wait
check "uma listagem por negócio" "$(psql -qXtA -c "select count(*) from public.discovery_listings where tenant_id = '$TENANT_A'")" 1
check "o outro salvamento recusado por versão" "$(cat "$TMP"/dsc-s.* | grep -c STALE_VERSION || true)" 1
check "nenhum erro interno" "$(cat "$TMP"/dsc-s.* | grep -ci 'duplicate key' || true)" 0

# Mesmo padrão corrigido no primeiro salvamento do site (P17) e do perfil fiscal (P16).
for w in 1 2; do
  as_user "$OWNER_A" "select public.presence_site_save('$TENANT_A', 0, 'Título $w', array['services'], 'papel', null, 'conc-prs-save-000000$w', '$H')" >"$TMP/dsc-p.$w" 2>&1 &
  as_user "$OWNER_A" "select public.fiscal_profile_save('$TENANT_A', 0, 'Barbearia $w', '11222333000181', 'mei', '3550308', '06.01', 'conc-fsc-prof-000000$w', '$H')" >"$TMP/dsc-f.$w" 2>&1 &
done
wait
check "site: um rascunho, outro recusado por versão" "$(cat "$TMP"/dsc-p.* | grep -c STALE_VERSION || true)" 1
check "perfil fiscal: um perfil, outro recusado por versão" "$(cat "$TMP"/dsc-f.* | grep -c STALE_VERSION || true)" 1
check "nenhum erro interno no site nem no fiscal" "$(cat "$TMP"/dsc-p.* "$TMP"/dsc-f.* | grep -ci 'duplicate key' || true)" 0

finish "P23 concorrência"

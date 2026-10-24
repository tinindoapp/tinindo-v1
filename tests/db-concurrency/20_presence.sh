#!/usr/bin/env bash
# P17 · Concorrência real da presença digital:
#  1. Duas publicações em paralelo do mesmo conteúdo (mesmo hash, chaves diferentes) → uma versão, nenhum erro.
#  2. Dois negócios verificam o mesmo domínio no mesmo instante → um verificado, o outro "taken"; nada vaza como erro.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
source "$(dirname "$0")/lib.sh"

OWNER_A=a0000000-0000-4000-8000-00000000000a
OWNER_B=b0000000-0000-4000-8000-00000000000b
TENANT_A=10000000-0000-4000-8000-00000000000a
TENANT_B=10000000-0000-4000-8000-00000000000b
H=$(printf 'a%.0s' $(seq 1 64))

psql -qX -c "insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values ('$TENANT_A', 'barbearia-a', 'barber', 'Pinheiros', array['area','display_name'], now())" >/dev/null
HASH=$(as_user "$OWNER_A" "select public.presence_get('$TENANT_A')->>'preview_hash'" | tail -n1)
for w in 1 2; do
  as_user "$OWNER_A" "select public.presence_site_publish('$TENANT_A', '$HASH', 'conc-prs-publish-0000$w', '$H')" >"$TMP/prs-p.$w" 2>&1 &
done
wait
check "uma versão para o mesmo conteúdo" "$(psql -qXtA -c "select count(*) from public.presence_site_versions where tenant_id = '$TENANT_A'")" 1
check "site no ar" "$(psql -qXtA -c "select status from public.presence_sites where tenant_id = '$TENANT_A'")" published
check "nenhuma publicação falhou" "$(cat "$TMP"/prs-p.* | grep -c ERROR || true)" 0

DA=$(as_user "$OWNER_A" "select public.presence_domain_add('$TENANT_A', 'mesmo-nome.com.br', 'conc-prs-domain-a0001', '$H')->'body'->'domain'->>'id'" | tail -n1)
DB=$(as_user "$OWNER_B" "select public.presence_domain_add('$TENANT_B', 'mesmo-nome.com.br', 'conc-prs-domain-b0001', '$H')->'body'->'domain'->>'id'" | tail -n1)
TA=$(psql -qXtA -c "select 'tinindo-verify=' || verify_token from public.presence_domains where id = '$DA'")
TB=$(psql -qXtA -c "select 'tinindo-verify=' || verify_token from public.presence_domains where id = '$DB'")
psql -qXtA -c "set role service_role; select public.presence_domain_record_check('$DA', array['$TA'])->>'result'" >"$TMP/prs-d.a" 2>&1 &
psql -qXtA -c "set role service_role; select public.presence_domain_record_check('$DB', array['$TB'])->>'result'" >"$TMP/prs-d.b" 2>&1 &
wait
check "um negócio verificou o nome" "$(psql -qXtA -c "select count(*) from public.presence_domains where hostname = 'mesmo-nome.com.br' and status = 'verified'")" 1
check "o outro ficou com o nome tomado" "$(cat "$TMP"/prs-d.a "$TMP"/prs-d.b | grep -c '^taken$' || true)" 1
check "nenhum erro vazou (unique_violation)" "$(cat "$TMP"/prs-d.* | grep -ci 'error\|duplicate key' || true)" 0

finish "P17 concorrência"

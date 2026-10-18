#!/usr/bin/env bash
# Testa as propostas do P01 num Postgres local descartável, sem copiar nada para supabase/.
# Mesmo shim de scripts/db-test-local.sh. Roda em duas ordens:
#   limpa:    fundação → P01/001 → stub P02 → P01/002 → seed → testes (como `supabase db reset`)
#   migrada:  fundação → seed → P01/001 → stub P02 → P01/002 → testes (homologação já com dados)
# Em cada ordem roda também os testes da fundação, para provar que nada regrediu.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash db/proposals/P01/tests/run-local.sh
set -euo pipefail
cd "$(dirname "$0")/../../../.."
P=db/proposals/P01

run() { psql -qX -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

suite() {
  local order=$1; shift
  local db="tinindo_p01_${order}_$$"
  PGDATABASE=postgres psql -qX -v ON_ERROR_STOP=1 -c "create database $db" >/dev/null
  # shellcheck disable=SC2064
  trap "PGDATABASE=postgres psql -qX -c 'drop database if exists $db' >/dev/null" RETURN
  export PGDATABASE="$db"
  psql -qX -v ON_ERROR_STOP=1 -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
  run scripts/db-local/supabase_shim.sql
  for f in "$@"; do echo "[$order] aplica: $f"; run "$f"; done

  local status=0 out t
  for t in supabase/tests/database/*.sql "$P"/tests/0*_*.test.sql; do
    out=$(psql -qXtA -v ON_ERROR_STOP=1 -f "$t" 2>&1) || status=1
    local total fails
    total=$(echo "$out" | grep -cE '^(ok|not ok)' || true)
    fails=$(echo "$out" | grep -E '^not ok|^# Looks like|ERROR' || true)
    if [ -n "$fails" ]; then status=1; echo "[$order] FALHOU $t"; echo "$fails"; else echo "[$order] ok $t ($total asserções)"; fi
  done
  return "$status"
}

FOUNDATION=(supabase/migrations/*.sql)
status=0
suite limpa "${FOUNDATION[@]}" "$P/001_identity_onboarding.sql" "$P/tests/000_stub_p02_customers.sql" \
  "$P/002_customer_links.sql" supabase/seed.sql || status=1
suite migrada "${FOUNDATION[@]}" supabase/seed.sql "$P/001_identity_onboarding.sql" \
  "$P/tests/000_stub_p02_customers.sql" "$P/002_customer_links.sql" || status=1
[ "$status" -eq 0 ] && echo "P01 DB: todos os testes passaram" || echo "P01 DB: FALHOU"
exit "$status"

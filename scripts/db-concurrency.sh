#!/usr/bin/env bash
# Testes de concorrência real (tests/db-concurrency/*.sh), cada um num banco recém-migrado.
# Cria um banco descartável (shim + migrations + seed) para cada script, como scripts/db-test-local.sh.
# No CI roda no Postgres do runner, depois do job do stack Supabase (que cobre o pgTAP no PG 17).
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:concurrency
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
export TMP
status=0
for t in tests/db-concurrency/[0-9]*.sh; do
  db="tinindo_conc_$$_$(basename "$t" .sh)"
  PGDATABASE=postgres psql -qX -v ON_ERROR_STOP=1 -c "create database $db" >/dev/null
  PGDATABASE="$db" psql -qX -v ON_ERROR_STOP=1 -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
  for f in scripts/db-local/supabase_shim.sql supabase/migrations/*.sql supabase/seed.sql; do
    PGDATABASE="$db" psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null
  done
  echo "concorrência: $t"
  PGDATABASE="$db" bash "$t" || status=1
  PGDATABASE=postgres psql -qX -c "drop database if exists $db" >/dev/null
done
[ -n "${KEEP_TMP:-}" ] || rm -rf "$TMP"
[ "$status" -eq 0 ] && echo "Concorrência: todos os testes passaram" || echo "Concorrência: FALHOU"
exit "$status"

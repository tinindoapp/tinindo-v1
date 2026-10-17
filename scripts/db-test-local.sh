#!/usr/bin/env bash
# Roda migrations + seed + testes pgTAP num Postgres local SEM o stack Supabase (ex.: sem Docker).
# Usa um banco descartável e o shim scripts/db-local/supabase_shim.sql. O CI usa `supabase test db`.
# Requer: psql e um Postgres >= 15 com extensões btree_gist, pgcrypto e pgtap instaladas.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test:local
set -euo pipefail
cd "$(dirname "$0")/.."

DB="tinindo_test_$$"
export PGDATABASE=postgres
psql -qX -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
trap 'PGDATABASE=postgres psql -qX -c "drop database if exists $DB" >/dev/null' EXIT
export PGDATABASE="$DB"
psql -qX -v ON_ERROR_STOP=1 -c "alter database $DB set search_path = \"\$user\", public, extensions" >/dev/null

run() { psql -qX -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
run scripts/db-local/supabase_shim.sql
for f in supabase/migrations/*.sql; do echo "migration: $f"; run "$f"; done
echo "seed: supabase/seed.sql"; run supabase/seed.sql

status=0
for t in supabase/tests/database/*.sql; do
  echo "teste: $t"
  out=$(psql -qXtA -v ON_ERROR_STOP=1 -f "$t" 2>&1) || status=1
  echo "$out" | grep -E '^(ok|not ok|#)' || true
  if echo "$out" | grep -qE '^not ok|^# Looks like|ERROR'; then status=1; fi
done
[ "$status" -eq 0 ] && echo "DB: todos os testes passaram" || echo "DB: FALHOU"
exit "$status"

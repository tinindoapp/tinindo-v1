#!/usr/bin/env bash
# Testes de integração handler ↔ banco real (tests/integration): cada Edge Function montada com a lógica de
# produção, chamando RPCs num Postgres recém-migrado (shim + migrations + seed) com os papéis do Supabase.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run test:integration
set -euo pipefail
cd "$(dirname "$0")/.."
DB="tinindo_int_$$"
export PGDATABASE=postgres
psql -qX -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
trap '[ -n "${KEEP_DB:-}" ] && echo "banco mantido: $DB" || PGDATABASE=postgres psql -qX -c "drop database if exists $DB" >/dev/null' EXIT
export PGDATABASE="$DB"
psql -qX -v ON_ERROR_STOP=1 -c "alter database $DB set search_path = \"\$user\", public, extensions" >/dev/null
for f in scripts/db-local/supabase_shim.sql supabase/migrations/*.sql supabase/seed.sql; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
TINIDO_INTEGRATION=1 npx vitest run --project integration "$@"

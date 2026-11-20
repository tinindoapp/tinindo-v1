#!/usr/bin/env bash
# Jornada do ciclo na tela com gravação real (tests/e2e/servidor): navegador → porta de servidor do frontend →
# handler de produção → Postgres. Cria um banco descartável (shim + migrations + seed, como scripts/db-integration.sh),
# faz o build do frontend apontando para o gateway de teste (numa pasta temporária fora do repositório, sem pisar no
# dist da demonstração), roda o Playwright (que sobe o gateway e o preview) e apaga o banco e a pasta.
# Uso: PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres bash tests/e2e/servidor/run.sh
# Portas: E2E_SERVIDOR_PORT (preview, padrão 4373) e E2E_GATEWAY_PORT (gateway, padrão 54390).
# KEEP_DB=1 mantém o banco para investigar. Argumentos extras vão para o Playwright (ex.: --project=mobile).
set -euo pipefail
cd "$(dirname "$0")/../../.."
export E2E_SERVIDOR_PORT="${E2E_SERVIDOR_PORT:-4373}"
export E2E_GATEWAY_PORT="${E2E_GATEWAY_PORT:-54390}"
export E2E_SERVIDOR_DIST
E2E_SERVIDOR_DIST="$(mktemp -d "${TMPDIR:-/tmp}/tinindo-e2e-servidor.XXXXXX")"

DB="tinindo_e2e_$$"
export PGDATABASE=postgres
psql -qX -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
cleanup() {
  rm -rf "$E2E_SERVIDOR_DIST"
  if [ -n "${KEEP_DB:-}" ]; then echo "banco mantido: $DB"; else PGDATABASE=postgres psql -qX -c "drop database if exists $DB with (force)" >/dev/null; fi
}
trap cleanup EXIT
export PGDATABASE="$DB"
psql -qX -v ON_ERROR_STOP=1 -c "alter database $DB set search_path = \"\$user\", public, extensions" >/dev/null
for f in scripts/db-local/supabase_shim.sql supabase/migrations/*.sql supabase/seed.sql; do
  psql -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

# Todo VITE_* vai para o bundle: aqui só o endereço do gateway local e uma chave pública de teste (qualquer texto que
# não tenha cara de chave secreta; src/app/env.ts recusa sb_secret_*).
VITE_APP_ENV=local \
VITE_SUPABASE_URL="http://127.0.0.1:${E2E_GATEWAY_PORT}" \
VITE_SUPABASE_PUBLISHABLE_KEY="chave-publica-da-jornada-de-teste" \
  npx vite build --outDir "$E2E_SERVIDOR_DIST" --emptyOutDir --logLevel warn

npx playwright test --config tests/e2e/servidor/playwright.config.ts "$@"

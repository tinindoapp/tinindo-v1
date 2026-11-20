#!/usr/bin/env bash
# Roda o e2e da homologação (smoke + jornada que grava) contra um ambiente LOCAL que imita a homologação: o gateway
# do P59 (tests/e2e/servidor: handlers de produção sobre um Postgres descartável) e o `vite preview` de um build que
# aponta para ele. Serve para validar a suíte sem a homologação no ar; não substitui rodar contra ela.
#
# Uso: PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres bash tests/e2e-staging/local.sh [args do Playwright]
#      (ex.: --project=desktop). Portas: E2E_SERVIDOR_PORT (preview, 4573) e E2E_GATEWAY_PORT (gateway, 54590).
#
# Reaproveita tests/e2e/servidor/run.sh, que cria o banco (shim + migrations + seed), aplica local-preparo.sql (o
# negócio técnico: expediente, perfil publicado e Mensagens ligado), faz o build apontando para o gateway e, no fim,
# apaga o banco e a pasta do build. No lugar do Playwright do P59, run.sh chama este mesmo script com --dentro, que
# sobe o gateway (com o despacho do canal a cada E2E_GATEWAY_DESPACHO_MS, imitando o cron de 1 min) e o preview e
# roda tests/e2e-staging/playwright.config.ts com as variáveis STAGING_* apontando para eles.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${1:-}" != "--dentro" ]; then
  export E2E_SERVIDOR_PORT="${E2E_SERVIDOR_PORT:-4573}"
  export E2E_GATEWAY_PORT="${E2E_GATEWAY_PORT:-54590}"
  export E2E_SERVIDOR_PREPARO="${E2E_SERVIDOR_PREPARO:-tests/e2e-staging/local-preparo.sql}"
  export E2E_SERVIDOR_EXEC="bash tests/e2e-staging/local.sh --dentro"
  exec bash tests/e2e/servidor/run.sh "$@"
fi
shift

: "${E2E_SERVIDOR_DIST:?rode por bash tests/e2e-staging/local.sh, não com --dentro}"
gateway="http://127.0.0.1:${E2E_GATEWAY_PORT}"
preview="http://127.0.0.1:${E2E_SERVIDOR_PORT}"
logs="$(mktemp -d "${TMPDIR:-/tmp}/tinindo-e2e-staging-local.XXXXXX")"

E2E_GATEWAY_DESPACHO_MS="${E2E_GATEWAY_DESPACHO_MS:-5000}" \
  node --experimental-strip-types tests/e2e/servidor/iniciar-gateway.ts >"$logs/gateway.log" 2>&1 &
gateway_pid=$!
node node_modules/vite/bin/vite.js preview --outDir "$E2E_SERVIDOR_DIST" --host 127.0.0.1 --port "$E2E_SERVIDOR_PORT" --strictPort \
  >"$logs/preview.log" 2>&1 &
preview_pid=$!
stop() {
  kill "$gateway_pid" "$preview_pid" 2>/dev/null || true
  wait "$gateway_pid" "$preview_pid" 2>/dev/null || true
  # O log do gateway mostra cada resposta de erro (inclusive o 501 do que ele não imita): fica para investigar.
  echo "logs do gateway e do preview: $logs"
}
trap stop EXIT

for _ in $(seq 1 120); do
  if curl -fsS "$gateway/__saude" >/dev/null 2>&1 && curl -fsS "$preview/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS "$gateway/__saude" >/dev/null || { echo "gateway não subiu:"; cat "$logs/gateway.log"; exit 1; }
curl -fsS "$preview/" >/dev/null || { echo "preview não subiu:"; cat "$logs/preview.log"; exit 1; }

# Conta técnica local = dono do negócio A do seed (senha local do supabase/seed.sql, que só existe no banco
# descartável). Chave pública de teste igual à do build de run.sh. Sem segredo de verdade em lugar nenhum.
STAGING_REQUIRED=1 \
STAGING_WRITE=1 \
STAGING_URL="$preview" \
STAGING_EXPECTED_SHA="$(git rev-parse HEAD)" \
STAGING_SUPABASE_URL="$gateway" \
STAGING_SUPABASE_PUBLISHABLE_KEY="chave-publica-da-jornada-de-teste" \
STAGING_TECH_EMAIL="dono.a@exemplo.test" \
STAGING_TECH_PASSWORD="tinindo-local-123" \
STAGING_PUBLIC_SLUG="tecnico-uat-local" \
  npx playwright test -c tests/e2e-staging/playwright.config.ts "$@"

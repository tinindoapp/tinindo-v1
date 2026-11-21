#!/usr/bin/env bash
# Testes dos scripts de release contra o Postgres local (P58), sem conta nenhuma. O CI roda no job de banco, depois do
# "publicar.sh local". Prova: smoke com a saúde (ok e reprovando com o alerta aceso), reversão (conferir, executar,
# registro, recusa de commit fora da main) e as travas de produção (arquivo ausente, PREENCHER, sem terminal, palavra
# errada, sem tag, palavra certa).
# Uso: PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres LOCAL_DB=tinindo_publicar bash release/testes-locais.sh
# (o banco precisa ter passado pelo publicar.sh local).
set -uo pipefail
cd "$(dirname "$0")/.."
export LOCAL_DB="${LOCAL_DB:-tinindo_publicar}"
DB="postgresql://${PGUSER:-postgres}:${PGPASSWORD:-postgres}@${PGHOST:-localhost}:${PGPORT:-5432}/$LOCAL_DB"
TESTE=release/ambientes/zz-teste-producao.env
LOG=$(mktemp)
trap 'rm -f "$TESTE" "$LOG"' EXIT
FALHAS=0
ok() { printf 'ok - %s\n' "$1"; }
nok() { printf 'not ok - %s\n' "$1"; sed 's/^/    | /' "$LOG" | tail -8; FALHAS=$((FALHAS + 1)); }
# espera <exit esperado> <texto na saída> <descrição> -- comando...
espera() {
  local code="$1" texto="$2" desc="$3"; shift 4
  "$@" >"$LOG" 2>&1; local got=$?
  if [[ $got -eq $code ]] && grep -q -- "$texto" "$LOG"; then ok "$desc"; else nok "$desc (saída $got, esperado $code e \"$texto\")"; fi
}
sql() { psql "$DB" -qXtA -v ON_ERROR_STOP=1 -c "$1"; }

SHA=$(git rev-parse HEAD)
ANTERIOR=$(git rev-parse origin/main~1)

# --- smoke e saúde ---------------------------------------------------------------------------------------------------
espera 0 "saúde da operação: nenhum motivo de alerta" "smoke local ok com a saúde" -- bash release/smoke.sh local
sql "insert into public.ops_errors (source, kind, fn) select 'function', 'http_5xx', 'scheduling' from generate_series(1, 21)" >/dev/null
espera 1 "erros 5xx das funções na última hora: 21 (teto 20)" "smoke reprova com erros acima do teto" -- bash release/smoke.sh local
sql "delete from public.ops_errors" >/dev/null
# O banco do publicar.sh local não tem seed: um negócio de teste só para o evento existir.
T=58585858-5858-4858-8858-585858585858
sql "insert into public.tenants (id, name, profession, timezone) values ('$T', 'Teste P58', 'other', 'America/Sao_Paulo') on conflict do nothing;
     insert into public.outbox_events (tenant_id, event_type, aggregate_id, aggregate_version, correlation_id, next_run_at)
     values ('$T', 'ops.teste.v1', gen_random_uuid(), 1, gen_random_uuid(), now() - interval '20 minutes')" >/dev/null
espera 1 "fila de eventos atrasada" "smoke reprova com a fila atrasada" -- bash release/smoke.sh local
sql "delete from public.outbox_events where tenant_id = '$T'; delete from public.tenants where id = '$T'" >/dev/null
espera 1 "a versão anotada no banco é" "smoke reprova quando a versão anotada não é a esperada" -- bash release/smoke.sh local --sha "$ANTERIOR"

# --- reversão --------------------------------------------------------------------------------------------------------
ANTES=$(sql "select count(*) from public.ops_releases")
espera 0 "Modo --conferir: nada foi alterado" "reverter --conferir não muda nada" -- bash release/reverter.sh local "$ANTERIOR" --conferir
[[ "$(sql "select count(*) from public.ops_releases")" == "$ANTES" ]] && ok "--conferir não anotou reversão" || nok "--conferir anotou reversão"
espera 0 "Revertido em local" "reverter para o commit anterior da main" -- bash release/reverter.sh local "$ANTERIOR"
[[ "$(sql "select kind || ' ' || sha from public.ops_releases order by id desc limit 1")" == "revert $ANTERIOR" ]] && ok "reversão anotada em ops_releases" || nok "reversão não anotada"
espera 1 "não existe neste repositório" "reverter recusa commit que não existe" -- bash release/reverter.sh local 0123456789abcdef0123456789abcdef01234567
# Commit solto, fora da main (no CI não há identidade de autor configurada: uma fictícia só para este objeto).
FORA=$(GIT_AUTHOR_NAME=teste GIT_AUTHOR_EMAIL=teste@exemplo.test GIT_COMMITTER_NAME=teste GIT_COMMITTER_EMAIL=teste@exemplo.test \
  git commit-tree "$(git rev-parse HEAD^{tree})" -m "fora da main" </dev/null)
espera 1 "não está na história da main" "reverter recusa commit fora da main" -- bash release/reverter.sh local "$FORA"
espera 1 "informe o commit" "reverter sem commit pede o commit" -- bash release/reverter.sh local
# Volta a versão anotada para o commit atual (o resto dos testes e o smoke do CI esperam o HEAD).
espera 0 "nada a aplicar" "publicar de novo depois da reversão" -- bash release/publicar.sh local

# --- travas de produção ----------------------------------------------------------------------------------------------
espera 1 "ambiente 'producao' não existe" "sem producao.env não há produção" -- bash release/publicar.sh producao
cp release/ambientes/producao.env.exemplo "$TESTE"
espera 1 "ainda tem PREENCHER" "modelo sem preencher para antes de qualquer conta" -- bash release/publicar.sh zz-teste-producao --conferir
# Mesmas travas do modelo, mas apontando para o banco local para poder chegar à pergunta.
sed -e 's/^ALVO=.*/ALVO=local/' -e 's/^EXIGE_MAIN=.*/EXIGE_MAIN=0/' -e 's/^EXIGE_TAG=.*/EXIGE_TAG=0/' release/ambientes/producao.env.exemplo >"$TESTE"
espera 1 "não há terminal para digitar" "sem terminal, produção é recusada" -- bash release/publicar.sh zz-teste-producao </dev/null
espera 1 "não há terminal para digitar" "reverter em produção também pede a palavra" -- bash release/reverter.sh zz-teste-producao "$ANTERIOR" </dev/null
espera 0 "Modo --conferir" "--conferir não pergunta" -- bash release/publicar.sh zz-teste-producao --conferir </dev/null
espera 1 "confirmação diferente" "palavra errada digitada é recusada" -- script -qec "bash release/publicar.sh zz-teste-producao" /dev/null <<<"produção"
espera 0 "confirmado por quem está no terminal" "palavra certa digitada publica" -- script -qec "bash release/publicar.sh zz-teste-producao" /dev/null <<<"producao"
sed -i 's/^EXIGE_TAG=.*/EXIGE_TAG=1/' "$TESTE"
espera 1 "só recebe commit com tag" "produção sem tag vAAAA.MM.DD-N é recusada" -- bash release/publicar.sh zz-teste-producao --conferir

echo
[[ $FALHAS -eq 0 ]] && { echo "Scripts de release: todos os testes passaram"; exit 0; }
echo "Scripts de release: $FALHAS falha(s)"; exit 1

#!/usr/bin/env bash
# Voltar atrás (P58): publica de novo o frontend (Worker) e as funções de um commit anterior, sem tocar no banco.
# O banco é só aditivo (docs/09): as migrations aplicadas depois desse commit FICAM, e o código antigo tem de tolerar o
# schema novo. Correção de dado é para frente, com migration nova (release/RUNBOOK.md). Para no primeiro erro.
#
# Uso:
#   bash release/reverter.sh homolog <sha> --conferir   só mostra o que faria (e roda as conferências de leitura)
#   bash release/reverter.sh homolog <sha>              reverte frontend e funções e roda o smoke
#   bash release/reverter.sh local <sha>                testa o script num Postgres descartável (só conferências e registro)
#
# O <sha> tem de estar na história da main e ter as migrations todas já aplicadas no ambiente (ou seja: ter sido
# publicado aqui antes). Em produção, também a tag vAAAA.MM.DD-N e a palavra digitada. Passo a passo: release/RUNBOOK.md.
set -euo pipefail
cd "$(dirname "$0")/.."
source release/lib/comum.sh
trap trap_erro ERR

AMB=""; ALVO_SHA=""
for a in "$@"; do
  case "$a" in
    --conferir) CONFERIR=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) falha "opção desconhecida: $a" ;;
    *) if [[ -z "$AMB" ]]; then AMB="$a"; elif [[ -z "$ALVO_SHA" ]]; then ALVO_SHA="$a"; else falha "argumento a mais: $a"; fi ;;
  esac
done
carregar_ambiente "$AMB"
[[ -n "$ALVO_SHA" ]] || falha "informe o commit para onde voltar: bash release/reverter.sh $AMB <sha> [--conferir]"
INICIO_S=$(date +%s)
INICIO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
msg "Tinindo · reverter $NOME$([[ $CONFERIR -eq 1 ]] && echo ' · modo --conferir (nada é alterado)')"

# ---------------------------------------------------------------------------------------------------------------------
passo "1/5 · conferências antes de mexer em qualquer coisa"
exigir git node npx python3 curl
[[ "$ALVO" == local ]] && exigir psql

git fetch -q origin main 2>/dev/null || msg "   aviso: não consegui buscar a main no GitHub; uso a cópia local de origin/main"
SHA=$(git rev-parse --verify --quiet "${ALVO_SHA}^{commit}") || falha "o commit $ALVO_SHA não existe neste repositório (git fetch?)."
git merge-base --is-ancestor "$SHA" origin/main 2>/dev/null || falha "${SHA:0:12} não está na história da main: só se volta para um commit que passou no CI."
msg "   ok: ${SHA:0:12} está na história da main ($(git log -1 --format='%cs · %s' "$SHA" | cut -c1-90))"
exigir_tag "$SHA"

# Migrations do commit de destino: todas têm de estar aplicadas no ambiente. As aplicadas depois dele ficam.
mapfile -t MIG_DESTINO < <(git ls-tree --name-only "$SHA" supabase/migrations/ | sed 's#.*/##; s/\.sql$//' | grep -E '^[0-9]{14}_')
[[ ${#MIG_DESTINO[@]} -gt 0 ]] || falha "não achei migrations em ${SHA:0:12}."
ULTIMA_DESTINO="${MIG_DESTINO[-1]}"
VINCULADO=1
if [[ "$ALVO" == supabase && "$(cat supabase/.temp/project-ref 2>/dev/null || true)" != "$SUPABASE_REF" ]]; then
  if [[ $CONFERIR -eq 1 ]]; then VINCULADO=0; else
    $SB projects list >/dev/null 2>&1 || $SB login
    $SB link --project-ref "$SUPABASE_REF" >/dev/null || falha "não consegui vincular ao projeto $SUPABASE_REF (senha do banco?)."
  fi
fi
if [[ "$ALVO" == local ]]; then
  psql "$LOCAL_DB_URL" -qXtAc "select 1" >/dev/null 2>&1 || falha "o banco local não responde ($LOCAL_DB_URL sem a senha)."
fi
if [[ $VINCULADO -eq 1 ]]; then
  ESTADO=$(migrations_estado) || falha "não consegui ler as migrations do ambiente."
  mapfile -t APLICADAS < <(awk '$2 != "-" {print $2}' <<<"$ESTADO")
  faltam=()
  for m in "${MIG_DESTINO[@]}"; do
    v="${m%%_*}"; printf '%s\n' "${APLICADAS[@]}" | grep -qx "$v" || faltam+=("$m")
  done
  [[ ${#faltam[@]} -eq 0 ]] || falha "o ambiente não tem ${#faltam[@]} migration(s) de ${SHA:0:12} (${faltam[*]:0:3}…): esse commit nunca foi publicado aqui. Reverter só volta para o que já esteve no ar."
  msg "   ok: as ${#MIG_DESTINO[@]} migrations de ${SHA:0:12} estão aplicadas (até $ULTIMA_DESTINO)"
  # O que fica no banco e o código antigo não conhece: o script não desfaz; aponta o que pode quebrar o código antigo.
  depois=$(git diff --name-only --diff-filter=A "$SHA" HEAD -- supabase/migrations/ | sort)
  if [[ -n "$depois" ]]; then
    msg "   ficam aplicadas (o banco é só aditivo): $(wc -l <<<"$depois") migration(s) posteriores a ${SHA:0:12}"
    arriscadas=$(xargs grep -liE '^\s*(drop\s+(table|column|function|view)|alter\s+table[^;]*(drop|rename|alter\s+column[^;]*type))' <<<"$depois" 2>/dev/null || true)
    if [[ -n "$arriscadas" ]]; then
      msg "   ATENÇÃO: estas apagam ou renomeiam algo; confira que o código de ${SHA:0:12} não usa o que elas mudaram:"
      sed 's/^/     - /' <<<"$arriscadas"
    fi
  fi
else
  msg "   não conferido: este computador não está vinculado a $SUPABASE_REF (o modo --conferir não faz login)."
fi

confirmar_ambiente "voltar frontend e funções para ${SHA:0:12}"

# ---------------------------------------------------------------------------------------------------------------------
passo "2/5 · cópia do commit ${SHA:0:12}"
WT=""
if [[ "$ALVO" != supabase ]]; then
  msg "   pulado: o ambiente local não tem funções nem Worker"
elif [[ $CONFERIR -eq 1 ]]; then
  msg "   faria: git worktree add --detach <pasta temporária> ${SHA:0:12} e npm ci nela (lockfile do commit)"
else
  WT=$(mktemp -d "${TMPDIR:-/tmp}/tinindo-reverter.XXXXXX")
  trap 'git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"' EXIT
  git worktree add --detach --quiet "$WT" "$SHA"
  mkdir -p "$WT/supabase/.temp" && cp -R supabase/.temp/. "$WT/supabase/.temp/"
  (cd "$WT" && npm ci --no-audit --no-fund --loglevel=error >/dev/null) || falha "npm ci falhou na cópia de ${SHA:0:12}."
  msg "   ok: cópia em pasta temporária, dependências do lockfile do commit"
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "3/5 · funções"
if [[ "$ALVO" != supabase ]]; then
  msg "   pulado: o ambiente local não tem funções hospedadas"
elif [[ $CONFERIR -eq 1 ]]; then
  msg "   faria: BUILD_SHA = $SHA e supabase functions deploy das funções de ${SHA:0:12} (segredos do cron ficam como estão)"
else
  $SB secrets set --project-ref "$SUPABASE_REF" "BUILD_SHA=$SHA" >/dev/null || falha "o Supabase recusou BUILD_SHA."
  (cd "$WT" && $SB functions deploy --project-ref "$SUPABASE_REF" --no-verify-jwt --use-api --import-map supabase/functions/deno.json) \
    || falha "o deploy das funções de ${SHA:0:12} falhou. As funções podem ter ficado misturadas: rode de novo, ou publique a main."
  msg "   ok: funções de ${SHA:0:12}"
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "4/5 · frontend (Worker)"
if [[ "$ALVO" != supabase ]]; then
  msg "   pulado: o ambiente local não publica Worker"
elif [[ $CONFERIR -eq 1 ]]; then
  msg "   faria: build de ${SHA:0:12} com VITE_APP_ENV=$VITE_APP_ENV e a chave PÚBLICA; wrangler deploy -c $WRANGLER_CONFIG"
else
  CHAVE=$($SB projects api-keys --project-ref "$SUPABASE_REF" --reveal -o json 2>/dev/null | python3 -c '
import json, sys
keys = json.load(sys.stdin)
pub = [k for k in keys if k.get("type") == "publishable"] or [k for k in keys if k.get("name") == "anon"]
print(pub[0]["api_key"] if pub else "")')
  [[ "$CHAVE" == sb_publishable_* || "$CHAVE" == eyJ* ]] || falha "não achei a chave pública (publishable) do projeto."
  # O Worker do commit antigo, com a configuração do ambiente de hoje (domínio e conta podem ter mudado depois).
  [[ -f "$WRANGLER_CONFIG" ]] && cp "$WRANGLER_CONFIG" "$WT/$WRANGLER_CONFIG"
  (cd "$WT" && rm -rf dist && WORKERS_CI_COMMIT_SHA="$SHA" VITE_APP_ENV="$VITE_APP_ENV" VITE_SUPABASE_URL="$SUPABASE_URL" \
    VITE_SUPABASE_PUBLISHABLE_KEY="$CHAVE" npm run build >/dev/null) || falha "o build de ${SHA:0:12} falhou."
  unset CHAVE
  grep -q "\"commit\": \"$SHA\"" "$WT/dist/version.json" || falha "o build não carimbou ${SHA:0:12} em version.json."
  (cd "$WT" && $WRANGLER deploy -c "$WRANGLER_CONFIG" >/dev/null) || falha "o wrangler não publicou o Worker."
  msg "   ok: Worker com ${SHA:0:12}"
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "5/5 · registro da versão e smoke"
N_FUNCOES=$(git ls-tree -d --name-only "$SHA" supabase/functions/ | sed 's#.*/##' | grep -vc '^_' || true)
if [[ $CONFERIR -eq 1 ]]; then
  msg "   faria: anotar em public.ops_releases (revert, $SHA)"
  msg "   faria: bash release/smoke.sh $AMBIENTE --sha $SHA --desde $INICIO"
  msg ""
  msg "Modo --conferir: nada foi alterado. Para reverter: bash release/reverter.sh $AMBIENTE ${SHA:0:12}"
  exit 0
fi
# O banco fica na migration mais nova aplicada; o registro diz até onde vai o código do commit.
registrar_release revert "$SHA" "$ULTIMA_DESTINO" "$N_FUNCOES"
SMOKE=0
bash release/smoke.sh "$AMBIENTE" --sha "$SHA" --desde "$INICIO" || SMOKE=$?
DURACAO=$(( $(date +%s) - INICIO_S ))
msg ""
msg "Revertido em $NOME para ${SHA:0:12} em ${DURACAO}s (frontend e funções; o banco ficou como estava)."
msg "Linha para release/RELEASES.md:"
msg "| — | $(date +%Y-%m-%d) | ${SHA:0:12} | (banco mantido) | $N_FUNCOES | $NOME | <quem reverteu> | reversão, $([[ $SMOKE -eq 0 ]] && echo 'smoke ok' || echo 'smoke REPROVOU') |"
[[ $SMOKE -eq 0 ]] || falha "o smoke reprovou depois da reversão (lista acima). Veja release/RUNBOOK.md, 'Quando o alerta acende'."
msg "Volte para a main com bash release/publicar.sh $AMBIENTE quando a correção estiver lá."

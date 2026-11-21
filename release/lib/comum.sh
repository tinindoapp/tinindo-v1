# Funções comuns dos scripts de release (publicar.sh, smoke.sh, preparar-uat.sh). Carregar com `source`.
# Regras: nada de `set -x`; segredo só em variável, nunca em argumento impresso; para no primeiro erro.
# shellcheck shell=bash

SB="npx --no-install supabase"
# wrangler não é dependência do app: versão fixa, baixada só por quem publica o Worker.
WRANGLER="npx --yes wrangler@4.165.0"

PASSO="preparação"
CONFERIR=0

msg() { printf '%s\n' "$*"; }
passo() { PASSO="$1"; printf '\n== %s\n' "$1"; }
falha() {
  printf '\nPAROU em "%s": %s\n' "$PASSO" "$*" >&2
  exit 1
}
# Erro inesperado de um comando (set -e): diz em que passo parou, sem repetir o comando (que pode ter segredo).
trap_erro() { local code=$?; printf '\nPAROU em "%s" (código %s). Nada depois deste passo foi feito.\n' "$PASSO" "$code" >&2; exit "$code"; }

# Executa, ou só mostra no modo --conferir. Use `faz "descrição" comando args`; a descrição é o que aparece na tela.
faz() {
  local descricao="$1"; shift
  if [[ $CONFERIR -eq 1 ]]; then msg "   faria: $descricao"; return 0; fi
  msg "   $descricao"
  "$@"
}

carregar_ambiente() {
  local nome="${1:-}"
  [[ -n "$nome" ]] || falha "informe o ambiente (ex.: homolog). Disponíveis: $(cd release/ambientes && ls *.env | sed 's/\.env$//' | tr '\n' ' ')"
  local arq="release/ambientes/$nome.env"
  [[ -f "$arq" ]] || falha "ambiente '$nome' não existe (falta $arq)."
  # shellcheck disable=SC1090
  source "$arq"
  AMBIENTE="$nome"
  : "${NOME:?}" "${ALVO:?}" "${APP_URL:?}"
  APP_URL="${APP_URL%/}"
  if [[ "$ALVO" == supabase ]]; then
    : "${SUPABASE_REF:?falta SUPABASE_REF em $arq}" "${WRANGLER_CONFIG:?falta WRANGLER_CONFIG em $arq}"
    # Arquivo copiado do .exemplo sem preencher: para antes de qualquer conta (P58, produção preparada).
    [[ "$SUPABASE_REF$APP_URL$WRANGLER_CONFIG" != *PREENCHER* ]] || falha "$arq ainda tem PREENCHER: complete com os dados do projeto (release/PRODUCAO.md)."
    FN_URL="https://$SUPABASE_REF.supabase.co/functions/v1"
    SUPABASE_URL="https://$SUPABASE_REF.supabase.co"
  else
    LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://${PGUSER:-postgres}:${PGPASSWORD:-postgres}@${PGHOST:-localhost}:${PGPORT:-5432}/${LOCAL_DB:-tinindo_publicar}}"
  fi
}

# Alvo do banco para os comandos do CLI do Supabase.
db_alvo() { if [[ "$ALVO" == supabase ]]; then printf -- '--linked'; else printf -- '--db-url\n%s' "$LOCAL_DB_URL"; fi; }

# Consulta de leitura que devolve JSON (lista de linhas). Uma instrução só.
db_json() {
  local sql="$1"
  if [[ "$ALVO" == supabase ]]; then
    # O CLI devolve a lista de linhas; quando detecta um agente de IA (variável AI_AGENT), embrulha em {"rows": …}.
    $SB db query --linked --output-format json "$sql" 2>/dev/null | python3 -c '
import json, sys
t = sys.stdin.read()
d = json.loads(t[min(i for i in (t.find("["), t.find("{")) if i >= 0):])
print(json.dumps(d["rows"] if isinstance(d, dict) else d))'
  else
    psql "$LOCAL_DB_URL" -qXtA -v ON_ERROR_STOP=1 -c "select coalesce(json_agg(t), '[]') from ($sql) t"
  fi
}

# Arquivo SQL com várias instruções (escrita). Na homologação vai pela API de gestão (--linked).
db_arquivo() {
  local arq="$1"
  if [[ "$ALVO" == supabase ]]; then $SB db query --linked -f "$arq" >/dev/null
  else psql "$LOCAL_DB_URL" -qX -v ON_ERROR_STOP=1 -f "$arq" >/dev/null; fi
}

# Migrations: aplicadas no alvo e as que estão no repositório. Imprime "local remoto" por linha.
migrations_estado() {
  local alvo; mapfile -t alvo < <(db_alvo)
  # Saída de gente: tabela "Local | Remote | Time" com os carimbos entre crases. Com AI_AGENT definido, o CLI responde
  # em JSON ({"migrations": [...]}). Os dois formatos são aceitos; qualquer outro é erro.
  $SB migration list "${alvo[@]}" 2>/dev/null | python3 -c '
import json, re, sys
t = sys.stdin.read()
if "{" in t and "\"migrations\"" in t:
    for m in json.loads(t[t.index("{"):])["migrations"]:
        print(m.get("local") or "-", m.get("remote") or "-")
    sys.exit(0)
linhas = [l for l in t.splitlines() if l.count("|") == 2 and "Local" not in l and "---" not in l]
if not re.search(r"Local\s*\|\s*Remote", t):
    sys.exit("saída inesperada do supabase migration list")
for l in linhas:
    local, remote, _ = [c.strip().strip("`").strip() for c in l.split("|")]
    print(local or "-", remote or "-")'
}

# P58 · ambiente que exige confirmação digitada (CONFIRMAR=<palavra> no .env, ex.: produção). Só pergunta quando vai
# mudar algo (fora do --conferir). Sem terminal para digitar, recusa: nada de pular a pergunta por variável.
confirmar_ambiente() {
  local acao="$1"
  [[ -n "${CONFIRMAR:-}" && $CONFERIR -eq 0 ]] || return 0
  [[ -t 0 ]] || falha "$NOME exige confirmação digitada e não há terminal para digitar. Rode no seu terminal, sem pipe nem CI."
  printf '\n%s vai %s em %s.\nPara continuar, digite %s e tecle Enter: ' "$(whoami)" "$acao" "$NOME" "$CONFIRMAR" >&2
  local resposta=""
  IFS= read -r resposta || true
  [[ "$resposta" == "$CONFIRMAR" ]] || falha "confirmação diferente de \"$CONFIRMAR\". Nada foi alterado."
  msg "   ok: confirmado por quem está no terminal"
}

# P58 · ambiente com EXIGE_TAG=1 (produção) só recebe commit com tag vAAAA.MM.DD-N (CHECKLIST.md, B).
exigir_tag() {
  local sha="$1"
  [[ "${EXIGE_TAG:-0}" == 1 ]] || return 0
  local tag; tag=$(git tag --points-at "$sha" --list 'v[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]-*' | head -1)
  [[ -n "$tag" ]] || falha "$NOME só recebe commit com tag vAAAA.MM.DD-N; ${sha:0:12} não tem (git tag v$(date +%Y.%m.%d)-1 $sha && git push origin --tags)."
  msg "   ok: tag $tag"
}

# P58 · anota a publicação ou reversão em public.ops_releases (o painel e o smoke mostram a versão publicada).
registrar_release() {
  local tipo="$1" sha="$2" ate="$3" funcoes="$4"
  [[ "$sha" =~ ^[0-9a-f]{40}$ && "$tipo" =~ ^(publish|revert)$ && "$ate" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || falha "registro de release com valor inválido."
  local arq; arq=$(mktemp)
  printf "do \$\$ begin if to_regclass('public.ops_releases') is not null then insert into public.ops_releases (environment, kind, sha, migrations_until, functions) values ('%s', '%s', '%s', '%s', %d); end if; end \$\$;\n" \
    "$AMBIENTE" "$tipo" "$sha" "$ate" "$funcoes" >"$arq"
  db_arquivo "$arq" || { rm -f "$arq"; falha "não consegui anotar a versão em public.ops_releases."; }
  rm -f "$arq"
  msg "   ok: versão anotada em public.ops_releases ($tipo ${sha:0:12})"
}

exigir() { for c in "$@"; do command -v "$c" >/dev/null 2>&1 || falha "falta o comando '$c' neste computador."; done; }

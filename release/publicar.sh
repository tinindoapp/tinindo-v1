#!/usr/bin/env bash
# Publicação em um comando (recado #109): confere, aplica as migrations, publica as funções, agenda o cron, publica o
# Worker e roda o smoke. Para no primeiro erro dizendo em que passo parou. Nenhum segredo sai na tela nem vai para
# arquivo versionado: os segredos das funções são gerados aqui e vão direto para o Supabase.
#
# Uso:
#   bash release/publicar.sh homolog --conferir   só mostra o que faria (e roda as conferências de leitura)
#   bash release/publicar.sh homolog              publica
#   bash release/publicar.sh local                testa o script num Postgres descartável (sem funções, cron e Worker)
#   bash release/publicar.sh producao             só existe depois de criar release/ambientes/producao.env (PRODUCAO.md);
#                                                 exige tag vAAAA.MM.DD-N e a palavra "producao" digitada no terminal
#
# Ambientes em release/ambientes/<nome>.env. Passo a passo e o que fazer quando para: release/PUBLICAR.md.
set -euo pipefail
cd "$(dirname "$0")/.."
source release/lib/comum.sh
trap trap_erro ERR

AMB=""
for a in "$@"; do
  case "$a" in
    --conferir) CONFERIR=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) falha "opção desconhecida: $a" ;;
    *) AMB="$a" ;;
  esac
done
carregar_ambiente "$AMB"
SHA=$(git rev-parse HEAD)
INICIO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
msg "Tinindo · publicar em $NOME$([[ $CONFERIR -eq 1 ]] && echo ' · modo --conferir (nada é alterado)')"
msg "Commit: $SHA"

# ---------------------------------------------------------------------------------------------------------------------
passo "1/7 · conferências antes de mexer em qualquer coisa"
exigir git node npx python3 curl
[[ "$ALVO" == supabase ]] && exigir openssl
[[ "$ALVO" == local ]] && exigir psql

if [[ "${EXIGE_MAIN:-0}" == 1 ]]; then
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || falha "há mudanças não commitadas. Publique só um commit da main (git stash ou git checkout main)."
  git fetch -q origin main || falha "não consegui buscar a main no GitHub (rede?)."
  [[ "$SHA" == "$(git rev-parse origin/main)" ]] || falha "o commit atual não é a ponta da main ($(git rev-parse --short origin/main)). Rode: git checkout main && git pull."
  msg "   ok: árvore limpa e na ponta da main"
fi

exigir_tag "$SHA"

node .github/workflows/check-migrations.mjs >/dev/null || falha "a ordem das migrations do repositório está errada (rode: node .github/workflows/check-migrations.mjs)."
msg "   ok: nomes e ordem das migrations do repositório"

VINCULADO=1
if [[ "$ALVO" == supabase ]]; then
  if [[ $CONFERIR -eq 1 ]]; then
    # No modo --conferir não se faz login nem vínculo: só lê se o projeto já estiver vinculado nesta máquina.
    [[ "$(cat supabase/.temp/project-ref 2>/dev/null || true)" == "$SUPABASE_REF" ]] || VINCULADO=0
  else
    $SB projects list >/dev/null 2>&1 || $SB login
    $SB link --project-ref "$SUPABASE_REF" >/dev/null || falha "não consegui vincular ao projeto $SUPABASE_REF (senha do banco?)."
  fi
else
  psql "$LOCAL_DB_URL" -qXtAc "select 1" >/dev/null 2>&1 || falha "o banco local não responde ($LOCAL_DB_URL sem a senha). Veja release/PUBLICAR.md, 'Testar sem conta'."
fi

PENDENTES=()
if [[ $VINCULADO -eq 1 ]]; then
  ESTADO=$(migrations_estado) || falha "não consegui ler as migrations do ambiente."
  so_no_alvo=$(awk '$1 == "-" {print $2}' <<<"$ESTADO")
  [[ -z "$so_no_alvo" ]] || falha "o ambiente tem migrations que não estão no repositório: $so_no_alvo. Alguém publicou de outro branch; não continue."
  ultima_aplicada=$(awk '$2 != "-" {print $2}' <<<"$ESTADO" | sort | tail -1)
  mapfile -t PENDENTES < <(awk '$2 == "-" {print $1}' <<<"$ESTADO")
  for v in "${PENDENTES[@]}"; do
    [[ "$v" > "$ultima_aplicada" ]] || falha "a migration $v é anterior à última já aplicada ($ultima_aplicada). Fora de ordem: renomeie no repositório antes de publicar."
  done
  msg "   ok: o ambiente está em ${ultima_aplicada:-nenhuma}; ${#PENDENTES[@]} migration(s) a aplicar${PENDENTES[*]:+: ${PENDENTES[*]}}"
else
  msg "   não conferido: este computador não está vinculado a $SUPABASE_REF (o modo --conferir não faz login)."
fi

# Última conferência antes de mexer: em produção, a palavra digitada por quem publica (P58).
confirmar_ambiente "publicar ${SHA:0:12}"

# ---------------------------------------------------------------------------------------------------------------------
passo "2/7 · migrations (antes das funções e do Worker, docs/09)"
mapfile -t ALVO_DB < <(db_alvo)
if [[ ${#PENDENTES[@]} -eq 0 && $VINCULADO -eq 1 ]]; then
  msg "   nada a aplicar"
else
  [[ $VINCULADO -eq 1 ]] || { msg "   faria: supabase db push (as migrations que faltarem no ambiente, em ordem; não conferido)"; PULA_PUSH=1; }
  LOG_PUSH=$(mktemp)
  if [[ ${PULA_PUSH:-0} -eq 1 ]]; then :
  elif ! faz "supabase db push (${#PENDENTES[@]} migration(s); só as que faltam, em ordem)" \
    bash -c '"$@" >"$0" 2>&1' "$LOG_PUSH" $SB db push "${ALVO_DB[@]}" --yes; then
    grep -v '^ •' "$LOG_PUSH" | tail -15 >&2
    falha "uma migration falhou (saída acima). O Supabase desfaz a que falhou; as anteriores ficam. Corrija com uma migration nova."
  fi
  [[ $CONFERIR -eq 1 ]] || msg "   ok: $(grep -c '^Applying migration' "$LOG_PUSH") aplicada(s)"
  rm -f "$LOG_PUSH"
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "3/7 · segredos das funções"
SEGREDOS_GIRADOS=(JOBS_SECRET MESSAGING_DISPATCH_SECRET PAYMENTS_SYNC_SECRET FISCAL_SYNC_SECRET)
SEGREDOS_FIXOS=(MESSAGING_SIM_SECRET PAYMENTS_SIM_SECRET)
if [[ "$ALVO" != supabase ]]; then
  msg "   pulado: o ambiente local não tem funções hospedadas"
elif [[ $CONFERIR -eq 1 ]]; then
  msg "   faria: ALLOWED_ORIGINS e PUBLIC_APP_URL = $APP_URL"
  msg "   faria: gerar de novo ${SEGREDOS_GIRADOS[*]} (o cron do passo 5 recebe os mesmos valores)"
  msg "   faria: criar ${SEGREDOS_FIXOS[*]} só se ainda não existirem"
  msg "   faria: BUILD_SHA = $SHA (as funções devolvem X-Tinindo-Build com ele)"
  msg "   nunca: WHATSAPP_*, PSP_*, FISCAL_PROVIDER_* (piloto só com simulados)"
else
  existentes=$($SB secrets list --project-ref "$SUPABASE_REF" -o json 2>/dev/null | python3 -c 'import json,sys; [print(x["name"]) for x in json.load(sys.stdin)]')
  for proibido in WHATSAPP_ PSP_ FISCAL_PROVIDER_; do
    ! grep -q "^$proibido" <<<"$existentes" || falha "há segredo $proibido* no ambiente; o piloto roda só com simulados. Remova antes de publicar."
  done
  gen() { openssl rand -hex 32; }
  JOBS=$(gen); DISPATCH=$(gen); PAYSYNC=$(gen); FISCALSYNC=$(gen)
  pares=("ALLOWED_ORIGINS=$APP_URL" "PUBLIC_APP_URL=$APP_URL" "JOBS_SECRET=$JOBS" "MESSAGING_DISPATCH_SECRET=$DISPATCH"
    "PAYMENTS_SYNC_SECRET=$PAYSYNC" "FISCAL_SYNC_SECRET=$FISCALSYNC" "BUILD_SHA=$SHA")
  # Os simulados só são criados uma vez (trocar invalidaria assinaturas já emitidas).
  for n in "${SEGREDOS_FIXOS[@]}"; do grep -qx "$n" <<<"$existentes" || pares+=("$n=$(gen)"); done
  $SB secrets set --project-ref "$SUPABASE_REF" "${pares[@]}" >/dev/null || falha "o Supabase recusou os segredos."
  unset pares
  msg "   ok: ALLOWED_ORIGINS, PUBLIC_APP_URL, BUILD_SHA e os segredos do cron (valores não exibidos)"
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "4/7 · funções"
if [[ "$ALVO" != supabase ]]; then
  msg "   pulado: o ambiente local não tem funções hospedadas"
else
  n=$(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_*' | wc -l)
  # --no-verify-jwt: cada função confere o login sozinha; com o JWT do gateway ligado, rotas públicas, webhooks e o
  # cron com segredo seriam recusados antes do código. --use-api: empacota no Supabase, sem Docker.
  faz "supabase functions deploy (as $n funções de supabase/functions)" \
    $SB functions deploy --project-ref "$SUPABASE_REF" --no-verify-jwt --use-api --import-map supabase/functions/deno.json
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "5/7 · cron (a cada minuto) e rotinas do job_ticks"
# Um agendamento por função de servidor. As rotinas de cada módulo NÃO viram agendamento: o `jobs` roda
# public.jobs_run, que executa as linhas ligadas de public.job_ticks, cada uma isolada (P56).
CRON_LINHAS="jobs|jobs|X-Tinindo-Jobs-Secret|JOBS
dispatch|messaging/channel.dispatch|X-Tinindo-Dispatch-Secret|DISPATCH
payment-sync|payments/payment.sync|X-Tinindo-Sync-Secret|PAYSYNC
fiscal-sync|fiscal/fiscal.sync|X-Tinindo-Sync-Secret|FISCALSYNC"
if [[ "$ALVO" != supabase ]]; then
  msg "   pulado o agendamento: o Postgres local não tem pg_cron nem as funções"
elif [[ $CONFERIR -eq 1 ]]; then
  while IFS='|' read -r nome caminho _ _; do msg "   faria: tinindo-$nome → POST $FN_URL/$caminho a cada minuto (segredo no Vault)"; done <<<"$CRON_LINHAS"
else
  SQL=$(mktemp); chmod 600 "$SQL"; trap 'rm -f "$SQL"' EXIT
  {
    echo "create extension if not exists pg_cron; create extension if not exists pg_net;"
    while IFS='|' read -r nome caminho cabecalho var; do
      valor="${!var}"; vname="tinindo_cron_$nome"
      cat <<SQLEOF
select vault.update_secret(id, '$valor') from vault.secrets where name = '$vname';
select vault.create_secret('$valor', '$vname') where not exists (select 1 from vault.secrets where name = '$vname');
select cron.unschedule(jobid) from cron.job where jobname = 'tinindo-$nome';
select cron.schedule('tinindo-$nome', '* * * * *', \$cron\$
  select net.http_post(url := '$FN_URL/$caminho', body := '{}'::jsonb, timeout_milliseconds := 55000,
    headers := jsonb_build_object('Content-Type', 'application/json',
      '$cabecalho', (select decrypted_secret from vault.decrypted_secrets where name = '$vname')))
\$cron\$);
SQLEOF
    done <<<"$CRON_LINHAS"
  } >"$SQL"
  unset JOBS DISPATCH PAYSYNC FISCALSYNC valor
  db_arquivo "$SQL" || falha "o agendamento do cron falhou (pg_cron/pg_net ligados no projeto?)."
  rm -f "$SQL"
  msg "   ok: tinindo-jobs, tinindo-dispatch, tinindo-payment-sync, tinindo-fiscal-sync"
fi
if [[ $VINCULADO -eq 1 && ( $CONFERIR -eq 0 || ${#PENDENTES[@]} -eq 0 ) ]]; then
  # Depois do push (ou sem nada a aplicar): o registro de rotinas já existe no banco.
  db_json "select name, enabled from public.job_ticks order by phase, position" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
on = [r["name"] for r in rows if r["enabled"]]; off = [r["name"] for r in rows if not r["enabled"]]
print("   rotinas ligadas no job_ticks:", ", ".join(on) or "nenhuma")
if off: print("   desligadas:", ", ".join(off))'
else
  msg "   o registro de rotinas (job_ticks) é conferido pelo smoke depois das migrations"
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "6/7 · frontend (Worker)"
if [[ "$ALVO" != supabase ]]; then
  msg "   pulado: o ambiente local não publica Worker (use npm run build && npx vite preview)"
elif [[ $CONFERIR -eq 1 ]]; then
  msg "   faria: npm run build com VITE_APP_ENV=$VITE_APP_ENV, VITE_SUPABASE_URL=$SUPABASE_URL e a chave PÚBLICA do projeto"
  msg "   faria: wrangler deploy -c $WRANGLER_CONFIG (versão no ar = $SHA, em $APP_URL/version.json)"
else
  CHAVE=$($SB projects api-keys --project-ref "$SUPABASE_REF" --reveal -o json 2>/dev/null | python3 -c '
import json, sys
keys = json.load(sys.stdin)
pub = [k for k in keys if k.get("type") == "publishable"] or [k for k in keys if k.get("name") == "anon"]
print(pub[0]["api_key"] if pub else "")')
  [[ "$CHAVE" == sb_publishable_* || "$CHAVE" == eyJ* ]] || falha "não achei a chave pública (publishable) do projeto."
  rm -rf dist
  VITE_APP_ENV="$VITE_APP_ENV" VITE_SUPABASE_URL="$SUPABASE_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$CHAVE" npm run build >/dev/null \
    || falha "o build do frontend falhou (rode npm run build para ver o erro)."
  unset CHAVE
  grep -q "\"commit\": \"$SHA\"" dist/version.json || falha "o build não carimbou o commit $SHA em version.json."
  $WRANGLER deploy -c "$WRANGLER_CONFIG" >/dev/null || falha "o wrangler não publicou o Worker (login na Cloudflare: npx wrangler login)."
  msg "   ok: Worker publicado com o commit $SHA"
fi

# ---------------------------------------------------------------------------------------------------------------------
passo "7/7 · registro da versão e smoke"
ULTIMA_MIGRATION=$(ls supabase/migrations | tail -1 | sed 's/\.sql$//')
N_FUNCOES=$(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_*' | wc -l)
if [[ $CONFERIR -eq 1 ]]; then
  msg "   faria: anotar em public.ops_releases (publish, $SHA, até $ULTIMA_MIGRATION)"
  msg "   faria: bash release/smoke.sh $AMBIENTE --sha $SHA --desde $INICIO"
else
  registrar_release publish "$SHA" "$ULTIMA_MIGRATION" "$N_FUNCOES"
  bash release/smoke.sh "$AMBIENTE" --sha "$SHA" --desde "$INICIO" || falha "o smoke reprovou (lista acima). O ambiente ficou com o commit novo; corrija para frente ou republique o anterior (release/PUBLICAR.md)."
fi

msg ""
if [[ $CONFERIR -eq 1 ]]; then
  msg "Modo --conferir: nada foi alterado. Para publicar: bash release/publicar.sh $AMBIENTE"
else
  msg "Publicado em $NOME: $SHA"
  msg "Linha para release/RELEASES.md:"
  msg "| — | $(date +%Y-%m-%d) | ${SHA:0:12} | $ULTIMA_MIGRATION | $N_FUNCOES | $NOME | <quem publicou> | smoke ok |"
  msg "Próximo: npm run test:staging (e2e completo, cerca de 5 minutos; variáveis em tests/e2e-staging/README.md)."
fi

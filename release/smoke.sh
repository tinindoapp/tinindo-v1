#!/usr/bin/env bash
# Smoke depois de publicar (recado #109): em cerca de 2 minutos diz se o ambiente está bom. Falha se faltar variável
# ou segredo, se a versão no ar não for o commit publicado, se faltar migration, função, CORS ou cron, ou se uma
# rotina do job_ticks estiver falhando. Só lê: não grava nada no ambiente.
#
# Uso: bash release/smoke.sh <ambiente> [--sha <commit>] [--desde <instante ISO>]
#   --sha    commit que deve estar no ar (padrão: o commit atual do repositório)
#   --desde  só conta execuções do cron a partir deste instante (o publicar.sh passa a hora em que começou)
# O e2e completo, com a jornada do UAT, é o `npm run test:staging` (tests/e2e-staging).
set -uo pipefail
cd "$(dirname "$0")/.."
source release/lib/comum.sh

AMB=""; SHA=""; DESDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha) SHA="${2:-}"; shift 2 ;;
    --desde) DESDE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) falha "opção desconhecida: $1" ;;
    *) AMB="$1"; shift ;;
  esac
done
carregar_ambiente "$AMB"
SHA="${SHA:-$(git rev-parse HEAD)}"
PASSO="smoke"
FALHAS=0
ok() { msg "   ok    $*"; }
ruim() { msg "   FALHOU $*"; FALHAS=$((FALHAS + 1)); }
pulou() { msg "   pulou $*"; }

msg "Tinindo · smoke em $NOME · esperado $SHA"

# --- 1. variáveis e segredos ------------------------------------------------------------------------------------------
msg "Variáveis e segredos"
OBRIGATORIOS=(ALLOWED_ORIGINS PUBLIC_APP_URL JOBS_SECRET MESSAGING_DISPATCH_SECRET PAYMENTS_SYNC_SECRET FISCAL_SYNC_SECRET MESSAGING_SIM_SECRET PAYMENTS_SIM_SECRET)
if [[ "$ALVO" == supabase ]]; then
  nomes=$($SB secrets list --project-ref "$SUPABASE_REF" -o json 2>/dev/null | python3 -c 'import json,sys; [print(x["name"]) for x in json.load(sys.stdin)]' 2>/dev/null)
  if [[ -z "$nomes" ]]; then
    ruim "não consegui listar os segredos das funções (login no Supabase? npx supabase login)"
  else
    faltam=(); for n in "${OBRIGATORIOS[@]}"; do grep -qx "$n" <<<"$nomes" || faltam+=("$n"); done
    if [[ ${#faltam[@]} -eq 0 ]]; then ok "os ${#OBRIGATORIOS[@]} segredos obrigatórios das funções existem (valores não lidos)"; else ruim "faltam segredos: ${faltam[*]}"; fi
    if grep -qE '^(WHATSAPP_|PSP_|FISCAL_PROVIDER_)' <<<"$nomes"; then ruim "há segredo de provedor real (WHATSAPP_*, PSP_* ou FISCAL_PROVIDER_*); o piloto roda só com simulados"; else ok "nenhum provedor real ligado"; fi
  fi
else
  pulou "segredos: o ambiente local não tem funções hospedadas"
fi

# --- 2. versão no ar --------------------------------------------------------------------------------------------------
msg "Versão no ar"
versao=$(curl -fsS --max-time 15 "$APP_URL/version.json" 2>/dev/null || true)
if [[ -z "$versao" ]]; then
  if [[ "$ALVO" == supabase ]]; then ruim "$APP_URL/version.json não respondeu"; else pulou "$APP_URL não está no ar (suba com npm run build && npx vite preview)"; fi
else
  no_ar=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("commit",""))' "$versao")
  if [[ "$no_ar" == "$SHA" ]]; then ok "version.json = $SHA"; else ruim "version.json diz $no_ar; o publicado é $SHA (cache da Cloudflare? Worker de outro build?)"; fi
  if [[ "$ALVO" == supabase ]]; then
    html=$(curl -fsS --max-time 15 "$APP_URL/entrar" || true)
    js=$(grep -oE '/assets/[^"]+\.js' <<<"$html" | head -1)
    if [[ -n "$js" ]] && curl -fsS --max-time 15 "$APP_URL$js" | grep -q "$SUPABASE_REF.supabase.co"; then ok "o bundle aponta para $SUPABASE_REF.supabase.co"; else ruim "o bundle não aponta para $SUPABASE_REF.supabase.co (build sem VITE_SUPABASE_URL?)"; fi
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$APP_URL/app/agenda")
    [[ "$code" == 200 ]] && ok "rota interna recarregada abre o app (200)" || ruim "/app/agenda respondeu $code (SPA do Worker)"
  fi
fi

# --- 3. migrations ----------------------------------------------------------------------------------------------------
msg "Migrations"
if [[ "$ALVO" == supabase && "$(cat supabase/.temp/project-ref 2>/dev/null || true)" != "$SUPABASE_REF" ]]; then
  ruim "este computador não está vinculado a $SUPABASE_REF (npx supabase link --project-ref $SUPABASE_REF)"
  SEM_BANCO=1
else
  SEM_BANCO=0
  if estado=$(migrations_estado); then
    pend=$(awk '$2 == "-" {print $1}' <<<"$estado" | tr '\n' ' '); extra=$(awk '$1 == "-" {print $2}' <<<"$estado" | tr '\n' ' ')
    total=$(wc -l <<<"$estado")
    if [[ -z "${pend// }" && -z "${extra// }" ]]; then ok "as $total migrations do repositório estão aplicadas, nenhuma a mais"; fi
    [[ -z "${pend// }" ]] || ruim "migrations do repositório sem aplicar: $pend"
    [[ -z "${extra// }" ]] || ruim "migrations no ambiente que não estão no repositório: $extra"
  else
    ruim "não consegui ler as migrations do ambiente"; SEM_BANCO=1
  fi
fi

# --- 4. banco: escopo do piloto e rotinas ----------------------------------------------------------------------------
msg "Banco"
if [[ $SEM_BANCO -eq 1 ]]; then
  pulou "consultas ao banco (sem acesso)"
else
  if r=$(db_json "select count(*)::int as n, count(*) filter (where level = 'pilot')::int as piloto from app.module_catalog()" 2>/dev/null); then
    python3 -c 'import json,sys; r=json.loads(sys.argv[1])[0]; sys.exit(0 if (r["n"], r["piloto"]) == (27, 10) else 1)' "$r" \
      && ok "escopo do piloto: 27 módulos, 10 no primeiro dia (P51)" || ruim "catálogo de módulos diferente do esperado: $r"
  else ruim "app.module_catalog() não existe (migration do P51 não aplicada?)"; fi
  if r=$(db_json "select name, consecutive_failures, left(coalesce(last_error, ''), 120) as erro from public.job_ticks where enabled and consecutive_failures >= 3" 2>/dev/null); then
    if [[ "$r" == "[]" ]]; then ok "nenhuma rotina do job_ticks falhando em sequência"; else ruim "rotinas falhando: $r"; fi
  else ruim "não consegui ler public.job_ticks"; fi
fi

# --- 5. funções e cron (só hospedado) ---------------------------------------------------------------------------------
msg "Funções e cron"
if [[ "$ALVO" != supabase ]]; then
  pulou "funções e cron: o ambiente local não tem"
else
  falhou_fn=()
  for dir in supabase/functions/*/; do
    fn=$(basename "$dir"); [[ "$fn" == _* || "$fn" == jobs ]] && continue
    hdr=$(curl -s -o /dev/null -D - --max-time 15 -X OPTIONS -H "Origin: $APP_URL" -H "Access-Control-Request-Method: POST" "$FN_URL/$fn/health")
    code=$(awk 'NR==1 {print $2}' <<<"$hdr")
    grep -qi "^access-control-allow-origin: $APP_URL" <<<"$hdr" && [[ "${code:-500}" -lt 300 ]] || falhou_fn+=("$fn($code)")
  done
  [[ ${#falhou_fn[@]} -eq 0 ]] && ok "todas as funções do navegador sobem e aceitam $APP_URL (CORS)" || ruim "funções sem subir ou sem CORS para $APP_URL: ${falhou_fn[*]}"
  if [[ $SEM_BANCO -eq 0 ]]; then
    filtro=""; [[ -n "$DESDE" ]] && filtro="and d.start_time >= '$DESDE'::timestamptz"
    # Espera até 2 minutos pela primeira rodada de cada agendamento depois da publicação.
    for _ in 1 2 3 4 5 6 7 8; do
      r=$(db_json "select j.jobname, count(d.*)::int as rodadas, count(d.*) filter (where d.status = 'succeeded')::int as ok from cron.job j left join cron.job_run_details d on d.jobid = j.jobid $filtro and d.start_time > now() - interval '10 minutes' where j.jobname like 'tinindo-%' group by j.jobname" 2>/dev/null || echo '[]')
      python3 -c 'import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if len(r) == 4 and all(x["rodadas"] > 0 for x in r) else 1)' "$r" && break
      sleep 15
    done
    python3 - "$r" <<'PY' && ok "cron: os 4 agendamentos rodaram com sucesso" || ruim "cron: $r (esperado tinindo-jobs, -dispatch, -payment-sync e -fiscal-sync, todos com rodada ok)"
import json, sys
r = json.loads(sys.argv[1])
sys.exit(0 if len(r) == 4 and all(x["rodadas"] > 0 and x["ok"] == x["rodadas"] for x in r) else 1)
PY
    # A chamada HTTP do cron só aparece em net._http_response: 401 aqui é segredo do Vault diferente do da função.
    r=$(db_json "select status_code, count(*)::int as n from net._http_response where created > now() - interval '5 minutes' group by 1" 2>/dev/null || echo '[]')
    python3 -c 'import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if r and all(x["status_code"] == 200 for x in r) else 1)' "$r" \
      && ok "respostas das funções ao cron nos últimos 5 minutos: todas 200" || ruim "respostas ao cron: $r (401 = segredo do Vault diferente do da função)"
  fi
fi

msg ""
if [[ $FALHAS -eq 0 ]]; then msg "Smoke ok em $NOME."; exit 0; fi
msg "Smoke reprovou: $FALHAS item(ns) acima. O que cada um quer dizer: release/PUBLICAR.md, seção 'Quando o smoke reprova'."
exit 1

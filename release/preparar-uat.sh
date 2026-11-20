#!/usr/bin/env bash
# Prepara os negócios do UAT (docs/qa/UAT-PILOTO.md) depois que o cabeleireiro e o personal criaram as próprias contas:
# liga Mensagens só nesses negócios, para o código da reserva pelo link ser lido em Mensagens › Simulador (P51 deixou
# Mensagens guardado). Não cria nem altera dado de ninguém: só a chave do módulo, auditada (app.module_admin_set).
# Ao fim das sessões, rode com --desligar.
#
# Uso:
#   bash release/preparar-uat.sh <ambiente> --cabeleireiro <id do negócio> --personal <id do negócio> [--tecnico <id>]
#   bash release/preparar-uat.sh <ambiente> ... --desligar     depois das sessões
#   bash release/preparar-uat.sh <ambiente> ... --conferir     só mostra
# O id do negócio está no Supabase (Table Editor › tenants, coluna id). Nunca use e-mail ou telefone: o script só
# aceita o id. --tecnico é o negócio da conta técnica sintética, usado pelo npm run test:staging.
set -euo pipefail
cd "$(dirname "$0")/.."
source release/lib/comum.sh
trap trap_erro ERR

AMB=""; LIGAR=true; declare -A ESPERADO=()
UUID='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cabeleireiro) ESPERADO["${2:-}"]=hairdresser; shift 2 ;;
    --personal) ESPERADO["${2:-}"]=personal_trainer; shift 2 ;;
    --tecnico) ESPERADO["${2:-}"]=qualquer; shift 2 ;;
    --desligar) LIGAR=false; shift ;;
    --conferir) CONFERIR=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) falha "opção desconhecida: $1" ;;
    *) AMB="$1"; shift ;;
  esac
done
carregar_ambiente "$AMB"
[[ ${#ESPERADO[@]} -gt 0 ]] || falha "informe ao menos um negócio (--cabeleireiro, --personal ou --tecnico)."
for id in "${!ESPERADO[@]}"; do [[ "$id" =~ $UUID ]] || falha "'$id' não é um id de negócio (uuid em minúsculas)."; done
[[ "$ALVO" != supabase || "$(cat supabase/.temp/project-ref 2>/dev/null || true)" == "$SUPABASE_REF" ]] \
  || falha "este computador não está vinculado a $SUPABASE_REF (npx supabase link --project-ref $SUPABASE_REF)."

passo "conferir os negócios"
lista=$(printf "'%s'," "${!ESPERADO[@]}"); lista="${lista%,}"
# Só contagens e a profissão: nenhum nome, telefone ou e-mail sai na tela.
dados=$(db_json "select t.id, t.profession, app.module_enabled(t.id, 'messaging') as mensagens,
  (select count(*)::int from public.customers c where c.tenant_id = t.id and c.archived_at is null) as clientes,
  (select count(*)::int from public.channel_connections c where c.tenant_id = t.id and c.status = 'active' and c.provider = 'simulated') as canal_simulado,
  (select count(*)::int from public.channel_connections c where c.tenant_id = t.id and c.status <> 'disconnected' and c.provider <> 'simulated') as canal_real
  from public.tenants t where t.id in ($lista)")
python3 - "$dados" "$(for id in "${!ESPERADO[@]}"; do printf '%s=%s\n' "$id" "${ESPERADO[$id]}"; done)" <<'PY'
import json, sys
rows = {r["id"]: r for r in json.loads(sys.argv[1])}
esperado = dict(l.split("=") for l in sys.argv[2].split())
nome = {"hairdresser": "cabeleireiro", "personal_trainer": "personal", "barber": "barbeiro", "other": "outra"}
erros = []
for id_, prof in esperado.items():
    r = rows.get(id_)
    if not r:
        erros.append(f"negócio {id_} não existe neste ambiente"); continue
    if prof != "qualquer" and r["profession"] != prof:
        erros.append(f"negócio {id_} é de {nome.get(r['profession'], r['profession'])}, não de {nome[prof]}")
    if r["canal_real"]:
        erros.append(f"negócio {id_} tem canal de WhatsApp real ligado; o UAT roda só com o simulado")
    print(f"   {id_} · {nome.get(r['profession'], r['profession'])} · {r['clientes']} cliente(s) · Mensagens {'ligado' if r['mensagens'] else 'desligado'} · número simulado {'conectado' if r['canal_simulado'] else 'não conectado'}")
if erros:
    print("\n".join("   ERRO: " + e for e in erros)); sys.exit(1)
PY

passo "$($LIGAR && echo 'ligar' || echo 'desligar') Mensagens"
SQL=$(mktemp); trap 'rm -f "$SQL"' EXIT
for id in "${!ESPERADO[@]}"; do echo "select app.module_admin_set('$id', 'messaging', $LIGAR);"; done >"$SQL"
faz "Mensagens $($LIGAR && echo ligado || echo desligado) em ${#ESPERADO[@]} negócio(s) (app.module_admin_set, auditado)" db_arquivo "$SQL"

if [[ $CONFERIR -eq 0 ]]; then
  confere=$(db_json "select count(*) filter (where app.module_enabled(t.id, 'messaging') = $LIGAR)::int as ok, count(*)::int as n from public.tenants t where t.id in ($lista)")
  python3 -c 'import json,sys; r=json.loads(sys.argv[1])[0]; sys.exit(0 if r["ok"] == r["n"] else 1)' "$confere" || falha "a chave não ficou como pedido: $confere"
  msg "   ok"
fi

if $LIGAR; then
  cat <<'TXT'

Próximo, com a pessoa (docs/qa/UAT-PILOTO.md, "Antes de cada sessão"):
- No app, Menu › Mensagens › "Conectar número" com o provedor simulado; o código de verificação aparece em
  Mensagens › Simulador, no número do próprio negócio.
- Clientes só com o primeiro nome ou fictícios. Nenhuma mensagem sai sozinha; não mandar link de Pix.
- Ao fim das sessões: o mesmo comando com --desligar.
TXT
fi

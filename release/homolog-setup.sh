#!/usr/bin/env bash
# P42 · monta o backend da homologação num projeto Supabase já criado (release/P42-LIBERACAO.md, passo 1).
# Roda no terminal de quem tem a conta: os segredos são gerados aqui e vão direto para o Supabase (secrets das funções
# e Vault do banco, que o cron lê), sem passar pela tela nem por arquivo versionado. A senha do banco é pedida pelo CLI.
# Uso: bash release/homolog-setup.sh <project-ref> <endereço do app de homologação>
# Ex.: bash release/homolog-setup.sh abcdefghijklmnopqrst https://tinindo-homolog.exemplo.workers.dev
# Pode rodar de novo: troca ALLOWED_ORIGINS/PUBLIC_APP_URL, gira os segredos do cron e recria os agendamentos.
set -euo pipefail
cd "$(dirname "$0")/.."

REF="${1:?informe o project ref (Project Settings → General)}"
APP_URL="${2:?informe o endereço do frontend de homologação}"
APP_URL="${APP_URL%/}"
SB="npx --no-install supabase"
FN_URL="https://$REF.supabase.co/functions/v1"

echo "1/6 · login e vínculo com o projeto $REF"
$SB projects list >/dev/null 2>&1 || $SB login
$SB link --project-ref "$REF"

echo "2/6 · migrations (antes das funções, docs/09)"
$SB db push

echo "3/6 · segredos das funções (gerados agora; ninguém vê o valor)"
gen() { openssl rand -hex 32; }
existing=$($SB secrets list --project-ref "$REF" -o json 2>/dev/null | python3 -c 'import json,sys; [print(x["name"]) for x in json.load(sys.stdin)]' || true)
JOBS=$(gen); DISPATCH=$(gen); PAYSYNC=$(gen); FISCALSYNC=$(gen)
pairs=("ALLOWED_ORIGINS=$APP_URL" "PUBLIC_APP_URL=$APP_URL" "JOBS_SECRET=$JOBS" "MESSAGING_DISPATCH_SECRET=$DISPATCH"
  "PAYMENTS_SYNC_SECRET=$PAYSYNC" "FISCAL_SYNC_SECRET=$FISCALSYNC")
# Os simulados só são criados uma vez (trocar invalidaria assinaturas já emitidas).
for name in MESSAGING_SIM_SECRET PAYMENTS_SIM_SECRET; do
  grep -qx "$name" <<<"$existing" || pairs+=("$name=$(gen)")
done
$SB secrets set --project-ref "$REF" "${pairs[@]}" >/dev/null
unset pairs
echo "   ok; nenhum WHATSAPP_*, PSP_* ou FISCAL_PROVIDER_* (piloto só com simulados)"

echo "4/6 · deploy de todas as funções"
# --no-verify-jwt: cada função confere o login sozinha (AUTH_REQUIRED/FORBIDDEN no envelope). Com o JWT do gateway
# ligado, as rotas públicas (link, site, diretório), os webhooks e o cron com segredo seriam recusados antes do código.
# --use-api: empacota no servidor do Supabase, sem Docker. --import-map: o mapa fica em supabase/functions/deno.json
# (zod, supabase-js), um nível acima de cada função, e o empacotador remoto não o acha sozinho.
$SB functions deploy --project-ref "$REF" --no-verify-jwt --use-api --import-map supabase/functions/deno.json

echo "5/6 · cron a cada minuto (pg_cron + pg_net, segredos no Vault)"
SQL=$(mktemp); chmod 600 "$SQL"; trap 'rm -f "$SQL"' EXIT
{
  echo "create extension if not exists pg_cron; create extension if not exists pg_net;"
  # nome|caminho|cabeçalho|segredo (ADR-0011, 0017, 0018, 0026)
  while IFS='|' read -r name path header value; do
    vname="tinindo_cron_$name"
    cat <<SQLEOF
select vault.update_secret(id, '$value') from vault.secrets where name = '$vname';
select vault.create_secret('$value', '$vname') where not exists (select 1 from vault.secrets where name = '$vname');
select cron.unschedule(jobid) from cron.job where jobname = 'tinindo-$name';
select cron.schedule('tinindo-$name', '* * * * *', \$cron\$
  select net.http_post(url := '$FN_URL/$path', body := '{}'::jsonb, timeout_milliseconds := 55000,
    headers := jsonb_build_object('Content-Type', 'application/json',
      '$header', (select decrypted_secret from vault.decrypted_secrets where name = '$vname')))
\$cron\$);
SQLEOF
  done <<ROWS
jobs|jobs|X-Tinindo-Jobs-Secret|$JOBS
dispatch|messaging/channel.dispatch|X-Tinindo-Dispatch-Secret|$DISPATCH
payment-sync|payments/payment.sync|X-Tinindo-Sync-Secret|$PAYSYNC
fiscal-sync|fiscal/fiscal.sync|X-Tinindo-Sync-Secret|$FISCALSYNC
ROWS
} >"$SQL"
unset JOBS DISPATCH PAYSYNC FISCALSYNC
$SB db query --linked -f "$SQL" >/dev/null
rm -f "$SQL"
echo "   ok: tinindo-jobs, tinindo-dispatch, tinindo-payment-sync, tinindo-fiscal-sync"

echo "6/6 · conferência rápida (CORS de cada função)"
fail=0
for dir in supabase/functions/*/; do
  fn=$(basename "$dir")
  [[ "$fn" == _* || "$fn" == jobs ]] && continue
  code=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS -H "Origin: $APP_URL" -H "Access-Control-Request-Method: POST" \
    "$FN_URL/$fn/health")
  if [[ "$code" -ge 300 ]]; then echo "   FALHOU $fn ($code)"; fail=1; else echo "   ok $fn"; fi
done

cat <<EOF

$([[ $fail -eq 0 ]] && echo Pronto || echo "Terminou com falhas acima"). Falta, fora deste script:
- Auth → URL Configuration: Site URL = $APP_URL e Redirect URLs = $APP_URL/**
- Auth → SMTP: servidor próprio (ex.: Resend), senão o cadastro dos testadores trava no limite de e-mails
- Frontend: VITE_APP_ENV=staging, VITE_SUPABASE_URL=https://$REF.supabase.co, VITE_SUPABASE_PUBLISHABLE_KEY=<publishable>
- Conferir em 2 min: select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 8;
EOF
exit $fail

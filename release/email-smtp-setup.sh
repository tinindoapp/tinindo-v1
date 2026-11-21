#!/usr/bin/env bash
# Liga o e-mail do Auth pelo Resend no Supabase de homologação, sem passar pelo painel (release/EMAIL-RESEND.md, passo 3).
# Usa o login do Supabase CLI que já está no Keychain e pede a API key do Resend sem mostrar na tela.
# Faz: SMTP próprio (smtp.resend.com), remetente nao-responda@mail.tinindoapp.com.br, confirmação de e-mail ligada
# e os modelos "Confirme seu e-mail" e "Crie uma nova senha" de supabase/templates/.
# Uso: bash release/email-smtp-setup.sh [project-ref]   (padrão: homologação)
# Reversão: rode com DESLIGAR=1 para voltar ao estado do piloto (sem SMTP próprio e sem confirmação).
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:-kitdsdyydgutnbiwjblw}"

raw=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null) || { echo "Sem login do Supabase CLI. Rode: npx supabase login"; exit 1; }
case "$raw" in go-keyring-base64:*) raw=$(printf '%s' "${raw#go-keyring-base64:}" | base64 -d) ;; esac
export SB_TOKEN="$raw" REF

if [[ "${DESLIGAR:-}" == 1 ]]; then
  export RESEND_KEY=""
else
  read -r -s -p "Cole a API key do Resend (não aparece na tela) e tecle Enter: " RESEND_KEY; echo
  [[ "$RESEND_KEY" == re_* ]] || { echo "Isso não parece uma API key do Resend (começa com re_)."; exit 1; }
  export RESEND_KEY
fi

python3 - <<'PY'
import json, os, urllib.request
ref, token, key = os.environ["REF"], os.environ["SB_TOKEN"], os.environ["RESEND_KEY"]
if key:
    body = {
        "smtp_admin_email": "nao-responda@mail.tinindoapp.com.br",
        "smtp_sender_name": "Tinindo",
        "smtp_host": "smtp.resend.com",
        "smtp_port": "465",
        "smtp_user": "resend",
        "smtp_pass": key,
        "mailer_autoconfirm": False,  # confirmação de e-mail ligada
        "mailer_subjects_confirmation": "Confirme seu e-mail na Tinindo",
        "mailer_templates_confirmation_content": open("supabase/templates/confirmation.html").read(),
        "mailer_subjects_recovery": "Crie uma nova senha na Tinindo",
        "mailer_templates_recovery_content": open("supabase/templates/recovery.html").read(),
    }
else:
    body = {"smtp_host": None, "smtp_user": None, "smtp_pass": None, "smtp_admin_email": None, "mailer_autoconfirm": True}
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/config/auth", data=json.dumps(body).encode(),
                             method="PATCH", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req) as r:
        cfg = json.load(r)
except urllib.error.HTTPError as e:
    raise SystemExit(f"O Supabase recusou ({e.code}): {e.read().decode()[:300]}")
print("Pronto." if key else "Desligado.")
for k in ("smtp_host", "smtp_port", "smtp_user", "smtp_admin_email", "smtp_sender_name", "mailer_autoconfirm",
          "mailer_subjects_confirmation", "mailer_subjects_recovery", "rate_limit_email_sent", "mailer_otp_exp"):
    print(f"  {k} = {cfg.get(k)}")
PY

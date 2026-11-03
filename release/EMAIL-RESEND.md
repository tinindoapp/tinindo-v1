# E-mail do Auth pelo Resend (homologação)

Recado #75. Objetivo: o Supabase de homologação (`tinindo-homolog`) enviar cadastro e "Esqueci minha senha" por SMTP próprio, com o remetente `nao-responda@mail.tinindoapp.com.br`, e religar "Confirm email".

Quem executa: Gabriel (o domínio, a Cloudflare e a org do Supabase estão na conta dele). Nada aqui é automático e nenhuma chave entra no repositório.

## 1 · Resend

1. Criar a conta no Resend (plano grátis; tem limite diário de envios, suficiente para a homologação). **Se pedir cartão ou aparecer cobrança, parar e avisar o Felipe.**
2. Domains → Add domain → `mail.tinindoapp.com.br` (região mais próxima disponível).
3. Anotar os registros que o Resend mostrar (DKIM, SPF/MX do subdomínio de retorno). Não copiar valores para este arquivo.
4. Criar uma API key com permissão só de envio ("Sending access"), restrita ao domínio `mail.tinindoapp.com.br`. Ela vai direto para o painel do Supabase (passo 3).

## 2 · DNS na Cloudflare

- Acrescentar **só** os registros que o Resend pediu para o subdomínio (`resend._domainkey.mail…`, `send.mail…` ou equivalentes), com proxy desligado (nuvem cinza).
- **Não mexer** no MX da raiz, no SPF da raiz (Email Routing) nem no DMARC `p=reject` da raiz.
- O DMARC da raiz vale para o subdomínio. Com DKIM alinhado em `mail.tinindoapp.com.br`, a mensagem passa; por isso o DKIM precisa estar "Verified" no Resend antes do teste.
- Esperar o Resend marcar o domínio como verificado.

## 3 · Supabase de homologação

Authentication → Emails → SMTP Settings → Enable custom SMTP:

| Campo | Valor |
|---|---|
| Sender email | `nao-responda@mail.tinindoapp.com.br` |
| Sender name | `Tinindo` |
| Host | `smtp.resend.com` |
| Port | `465` (ou `587`) |
| Username | `resend` |
| Password | a API key do passo 1.4 (só no painel) |

Depois:

1. Authentication → Rate limits: conferir o limite de e-mails por hora (o padrão sobe quando há SMTP próprio; deixar compatível com o limite diário do Resend).
2. Authentication → Sign In / Providers → Email: religar **Confirm email**.
3. Authentication → Emails → Templates:
   - **Confirm signup**: assunto `Confirme seu e-mail na Tinindo`; corpo = conteúdo de `supabase/templates/confirmation.html`.
   - **Reset password**: assunto `Crie uma nova senha na Tinindo`; corpo = conteúdo de `supabase/templates/recovery.html`.
   - O texto de recuperação diz que o link vale 1 hora. Se o "Email OTP Expiration" do projeto for outro, ajustar o texto.
4. Conferir que Site URL e Redirect URLs apontam para `https://homolog.tinindoapp.com.br`.

Localmente, `supabase/config.toml` usa os mesmos modelos; no `supabase start` dá para ver o resultado no Inbucket (porta 54324).

## 4 · Teste

Com um e-mail novo (Gmail que nunca usou a homologação):

- [ ] Cadastro → chega "Confirme seu e-mail na Tinindo" na caixa de entrada (não no spam) → o botão confirma e abre a homologação logado.
- [ ] Sair → "Esqueci minha senha" → chega "Crie uma nova senha na Tinindo" → trocar a senha → entrar com a nova.
- [ ] No Gmail, "Mostrar original": SPF, DKIM e DMARC = `PASS`.
- [ ] Entrar com a conta técnica `teste@tinindoapp.com.br` continua funcionando.
- [ ] Apagar a conta de teste da homologação ao fim.

Ao terminar, marcar o item de e-mail em `release/CHECKLIST.md` (data e evidência: print do "Mostrar original", sem endereço pessoal) e atualizar o "Estado" de `release/P42-LIBERACAO.md`.

## Reversão

Se o envio falhar ou cair no spam: desligar o custom SMTP e "Confirm email" no painel (volta ao estado do piloto de 28/10). Os registros DNS do subdomínio podem ficar; não afetam a raiz.

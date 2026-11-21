# E-mail do Auth pelo Resend (homologação)

Recados #75 e #109. Resultado: o Supabase de homologação manda o "Confirme seu e-mail" e o "Crie uma nova senha" por SMTP próprio, com o remetente `nao-responda@mail.tinindoapp.com.br`, caindo na caixa de entrada; e o "Confirm email" volta a ser exigido.

Quem executa: Gabriel (domínio, Cloudflare e organização do Supabase estão na conta dele). Tempo: 30 a 45 minutos, quase tudo esperando o DNS. Nenhuma chave entra no repositório nem em mensagem: a API key vai do Resend direto para o painel do Supabase.

## Antes de começar

- Acesso ao Resend, à Cloudflare (zona `tinindoapp.com.br`) e ao Supabase (`tinindo-homolog`).
- Um Gmail que nunca usou a homologação, para o teste do fim.
- **Se o Resend pedir cartão ou mostrar cobrança, pare e avise o Felipe.** O plano grátis basta para a homologação (cerca de 100 e-mails por dia).

## 1 · Resend (5 min)

1. Domains › Add domain › `mail.tinindoapp.com.br`, na região mais próxima disponível.
2. Deixe a tela com os registros DNS aberta (próximo passo). Não copie os valores para nenhum arquivo.
3. API Keys › Create › permissão **Sending access**, restrita ao domínio `mail.tinindoapp.com.br`. Copie a chave só quando for colar no Supabase (passo 3).

## 2 · DNS na Cloudflare (5 min + espera)

1. Em `tinindoapp.com.br` › DNS, acrescente **exatamente** os registros que o Resend mostrou para o subdomínio: o DKIM (`resend._domainkey.mail`) e os de retorno (`send.mail`, MX e TXT de SPF). Proxy **desligado** (nuvem cinza) em todos.
2. **Não mexa** no MX da raiz, no SPF da raiz (Email Routing) nem no DMARC `p=reject` da raiz. O DMARC da raiz vale para o subdomínio; com o DKIM alinhado em `mail.tinindoapp.com.br`, a mensagem passa.
3. No Resend, "Verify DNS records". Espere todos ficarem **Verified** antes do passo 3.

Se não verificar em 30 minutos: confira se o nome não ficou duplicado (`resend._domainkey.mail.tinindoapp.com.br.tinindoapp.com.br`; a Cloudflare acrescenta o domínio sozinha) e se o proxy está mesmo desligado.

## 3 · Supabase de homologação (10 min)

Atalho sem painel: `bash release/email-smtp-setup.sh` faz tudo deste passo pela Management API (usa o login do Supabase CLI e pede a API key do Resend sem mostrar na tela). Reversão: `DESLIGAR=1 bash release/email-smtp-setup.sh`. Pelo painel:

Authentication › Emails › SMTP Settings › Enable custom SMTP:

| Campo | Valor |
|---|---|
| Sender email | `nao-responda@mail.tinindoapp.com.br` |
| Sender name | `Tinindo` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a API key do passo 1.3 |

Depois, no mesmo painel:

1. Authentication › Rate limits: o limite de e-mails por hora compatível com o plano do Resend (30 por hora é folgado para o UAT).
2. Authentication › Emails › Templates:
   - **Confirm signup**: assunto `Confirme seu e-mail na Tinindo`; corpo = conteúdo de `supabase/templates/confirmation.html`.
   - **Reset password**: assunto `Crie uma nova senha na Tinindo`; corpo = conteúdo de `supabase/templates/recovery.html`. O texto diz que o link vale 1 hora: se o "Email OTP Expiration" do projeto for outro, ajuste o texto.
3. Authentication › URL Configuration: Site URL `https://homolog.tinindoapp.com.br` e Redirect URLs `https://homolog.tinindoapp.com.br/**`.
4. Authentication › Sign In / Providers › Email: religue **Confirm email**. Por último, para não travar cadastro enquanto o SMTP não funcionava.

Localmente, `supabase/config.toml` usa os mesmos modelos; com `supabase start` o resultado aparece no Inbucket (porta 54324).

## 4 · Teste (10 min)

Com o Gmail novo:

- [ ] Cadastro em `https://homolog.tinindoapp.com.br/criar-conta` › chega "Confirme seu e-mail na Tinindo" na **caixa de entrada** › o botão confirma e abre a homologação logado.
- [ ] Sair › "Esqueci minha senha" › chega "Crie uma nova senha na Tinindo" › trocar a senha › entrar com a nova.
- [ ] No Gmail, ⋮ › "Mostrar original": SPF, DKIM e DMARC = `PASS`.
- [ ] A conta técnica sintética continua entrando (`npm run test:staging` passa).
- [ ] Apague a conta de teste em Authentication › Users.

Ao terminar, marque o item de e-mail no `CHECKLIST.md` (data e print do "Mostrar original" sem o endereço pessoal) e comente no recado #109.

## Se der errado

| Sintoma | Causa provável |
|---|---|
| E-mail não chega e o log do Auth mostra erro de SMTP | API key errada ou sem permissão para o domínio; porta 465 bloqueada (tente 587) |
| Chega no spam | DKIM ainda não verificado, ou remetente diferente de `@mail.tinindoapp.com.br` |
| "Mostrar original" com DMARC `FAIL` | DKIM assinando com outro domínio: confira o domínio da API key no Resend |
| O link do e-mail abre `localhost` | Site URL e Redirect URLs (passo 3.3) |

Reversão: desligue o custom SMTP e o "Confirm email" no painel (volta ao estado de 28/10). Os registros DNS do subdomínio podem ficar: não afetam a raiz.

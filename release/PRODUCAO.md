# Produção: o que criar antes de publicar (D36 a)

D36 (a): um projeto de produção em plano com backup diário, numa organização da empresa. A homologação continua no plano grátis. Sem isso, não entra dado real novo.

**Estado em 21/11/2026:** nada de produção existe. O repositório está pronto, mas não publica sozinho:

- `release/ambientes/producao.env` não existe; só há o modelo `producao.env.exemplo`;
- com `PREENCHER` no arquivo, `publicar.sh` e `reverter.sh` param antes de tocar em qualquer conta;
- para publicar, é preciso a tag `vAAAA.MM.DD-N` no commit e a palavra `producao` digitada no terminal. Sem terminal (pipe ou CI), a publicação é recusada.

Quem cria cada item é quem tem a conta. Contas, segredos e aprovação são do coordenador (`docs/COORDENACAO.md`). Cada item marcado leva a data e a evidência, sem segredo nem dado pessoal.

## 1 · Contas e decisões (antes de tudo)

- [ ] Organização da empresa no Supabase, com cartão da empresa e plano com **backup diário**. Point-in-time recovery, se o orçamento permitir.
- [ ] Repositório privado (D37) antes de contrato com provedor e de dado real.
- [ ] Domínio de produção decidido. Sugestão: `app.tinindoapp.com.br`, como Custom Domain do Worker na zona `tinindoapp.com.br`.
- [ ] Termos, política, CNPJ, encarregado e canal (D27, issue #87). Retenção (D25) revisada pelo advogado. Exportação e eliminação por negócio (D26).

## 2 · Supabase de produção

- [ ] Projeto `tinindo-producao`, região São Paulo, na organização da empresa. Anote o **ref** (`SUPABASE_REF`).
- [ ] Senha do banco num cofre da empresa, nunca em arquivo do repositório.
- [ ] Extensões `pg_cron` e `pg_net` ligadas (Database › Extensions). O passo 5 do `publicar.sh` precisa delas.
- [ ] Auth:
  - SMTP próprio pelo Resend (`EMAIL-RESEND.md`, com os mesmos modelos em português);
  - "Confirm email" ligado;
  - Site URL e Redirect URLs com o domínio de produção.
- [ ] Rate limits do Auth compatíveis com o plano do Resend.

## 3 · Cloudflare (Worker de produção)

- [ ] Copiar `release/ambientes/wrangler.producao.jsonc.exemplo` para a raiz como `wrangler.producao.jsonc` (PR para a `main`) e trocar `account_id` e o domínio. A cópia na raiz é do integrador.
- [ ] Custom Domain do Worker no domínio de produção.

## 4 · Arquivo do ambiente

- [ ] `cp release/ambientes/producao.env.exemplo release/ambientes/producao.env` e trocar cada `PREENCHER`: `SUPABASE_REF` e `APP_URL`. Só dados públicos; o arquivo entra por PR.
- [ ] `npm run publicar -- producao --conferir` mostra o plano sem parar em `PREENCHER`.

## 5 · Primeira publicação

1. Na `main` verde, crie a tag do commit aprovado: `git tag v2026.MM.DD-1 <sha> && git push origin --tags`.
2. Vincule este computador, uma vez: `npx supabase login`, `npx supabase link --project-ref <ref>` e `npx --yes wrangler@4.165.0 login`.
3. Rode `npm run publicar -- producao` e digite `producao` quando pedir. O script faz:
   - migrations;
   - segredos: gera de novo os do cron e cria os dos simulados; `BUILD_SHA` sai com o commit;
   - as funções;
   - o cron;
   - o Worker;
   - a anotação em `public.ops_releases`;
   - o smoke.
4. A equipe Tinindo como operadora: `insert into public.platform_operators (user_id, display_name) values ('<id do usuário>', '<nome>')`, com a chave de serviço, pelo SQL Editor do painel. Assim o painel **Saúde da operação** abre para ela.
5. Aviso por e-mail do alerta, quando quiser ligar: segredos `OPS_ALERT_EMAIL=on`, `OPS_ALERT_EMAIL_TO` e `OPS_ALERT_RESEND_KEY` (`RUNBOOK.md`, "Quando o alerta acende"), e depois publique de novo.
6. Conta técnica sintética e `npm run test:staging` com o endereço de produção, sem marketing ativo (`docs/09`, "Publicação").
7. Ensaio de reversão e restore com tempos no ambiente real (`ENSAIO-ROLLBACK.md`). O restore vai para um projeto isolado, nunca o vivo.
8. Linha em `RELEASES.md` e aprovação por escrito (nome, data, SHA), em `CHECKLIST.md`, parte B.

## Nunca em produção

- `WHATSAPP_*`, `PSP_*` ou `FISCAL_PROVIDER_*` sem contrato e decisão por escrito. O `publicar.sh` recusa.
- `PAYMENTS_SIM_PAY=on`.
- `down migration` ou restore em cima do projeto vivo.
- Publicar de branch, sem tag ou sem a palavra digitada.

# Publicar a homologação em um comando

Para o Gabriel (recado #109). Resultado: a homologação com o commit da `main` e, em cerca de 5 minutos, um "ok" ou a lista do que está errado.

## Uma vez por computador

```bash
git clone https://github.com/tinindoapp/tinindo-v1 && cd tinindo-v1 && npm ci
npx supabase login                                   # conta do Supabase da homologação
npx supabase link --project-ref kitdsdyydgutnbiwjblw # pede a senha do banco
npx --yes wrangler@4.165.0 login                     # conta da Cloudflare (zona tinindoapp.com.br)
```

Se o projeto estiver pausado (plano grátis pausa depois de uma semana sem uso), reative no painel do Supabase antes.

## Toda vez

```bash
git checkout main && git pull
npm run publicar -- homolog --conferir   # só mostra o que vai fazer (1 min)
npm run publicar -- homolog              # publica e roda o smoke (3 a 5 min)
```

O que o `publicar` faz, em ordem, parando no primeiro erro com a mensagem do passo:

| Passo | O que faz | Para quando |
|---|---|---|
| 1 · conferências | Árvore limpa e na ponta da `main`; nomes das migrations; o ambiente não tem migration que falta no repositório; as novas vêm depois da última aplicada | Commit fora da `main`, migration fora de ordem ou publicada de outro branch |
| 2 · migrations | `supabase db push` só com as que faltam (antes das funções, docs/09) | Uma migration falha (o Supabase desfaz só ela) |
| 3 · segredos | `ALLOWED_ORIGINS`, `PUBLIC_APP_URL` e `BUILD_SHA` (o commit, devolvido pelas funções em `X-Tinindo-Build`); gera de novo os segredos do cron; cria os dos simulados se faltarem. Valores nunca aparecem | Há `WHATSAPP_*`, `PSP_*` ou `FISCAL_PROVIDER_*` (piloto só com simulados) |
| 4 · funções | Deploy das 29 funções | Deploy recusado |
| 5 · cron | Quatro agendamentos por minuto (`jobs`, `dispatch`, `payment-sync`, `fiscal-sync`) com o segredo no Vault. As rotinas de cada módulo rodam dentro do `jobs`, pela tabela `job_ticks` (P56); o passo lista as ligadas | `pg_cron` ou `pg_net` desligados no projeto |
| 6 · Worker | Build com `VITE_APP_ENV=staging`, a URL e a chave **pública** do projeto; confere que `version.json` tem o commit; `wrangler deploy` | Chave pública não encontrada, build quebrado, sem login na Cloudflare |
| 7 · registro e smoke | Anota o commit em `public.ops_releases` (P58) e roda o `release/smoke.sh` (abaixo) | Qualquer item reprovado |

Ao terminar, ele imprime a linha para `release/RELEASES.md`.

## Smoke (`npm run smoke -- homolog`)

Só lê. Pode rodar a qualquer hora, sem publicar.

| Item | Reprova quando |
|---|---|
| Segredos das funções | Falta algum dos 8 obrigatórios, ou há provedor real ligado |
| Versão no ar | `https://homolog.tinindoapp.com.br/version.json` não é o commit publicado |
| Bundle | O JavaScript não aponta para `kitdsdyydgutnbiwjblw.supabase.co` |
| Rota interna | `/app/agenda` recarregada não dá 200 |
| Migrations | Falta aplicar alguma, ou o ambiente tem uma que o repositório não tem |
| Escopo do piloto | `app.module_catalog()` não tem 28 módulos com 11 no primeiro dia (P51 + Seus dados, P57) |
| Rotinas | Alguma linha ligada do `job_ticks` com 3 ou mais falhas seguidas |
| Funções | Alguma função do navegador não sobe ou recusa a origem do app (CORS) |
| Cron | Algum dos 4 agendamentos não rodou com sucesso em até 2 minutos |
| Respostas ao cron | Alguma resposta diferente de 200 nos últimos 5 minutos (401 = segredo do Vault diferente do da função: publique de novo) |
| Versão das funções | Alguma função não devolve o commit publicado em `X-Tinindo-Build` |
| Saúde da operação (P58) | "Precisa de atenção": fila atrasada, rotina com 3 falhas seguidas, 5xx das funções acima do teto na última hora ou rotina do alerta parada. Mostra também a fila, os mortos e os erros por função |
| Versão anotada | A última linha de `public.ops_releases` não é o commit esperado |

## Quando o smoke reprova

| Mensagem | O que fazer |
|---|---|
| `faltam segredos: …` | Publique de novo (`npm run publicar -- homolog`); o passo 3 cria os que faltam |
| `version.json diz …` | Cache ou Worker de outro build. Rode o passo 6 de novo publicando outra vez; confira em `wrangler deployments list -c wrangler.homolog.jsonc` |
| `o bundle não aponta …` | O build saiu sem `VITE_SUPABASE_URL`. Publique de novo pelo script (não pelo `npm run build` à mão) |
| `funções sem subir ou sem CORS …` | Segredo faltando (a função recusa subir) ou `ALLOWED_ORIGINS` diferente do endereço. Publique de novo |
| `cron: …` ou `respostas ao cron: 401` | Segredo do Vault diferente do da função. Publique de novo (gira os dois juntos) |
| `rotinas falhando: …` | Veja `last_error` na mensagem e `release/RUNBOOK.md` (fila parada). Não desligue a rotina sem migration |
| `migrations … sem aplicar` | O passo 2 não rodou ou falhou; publique de novo e leia a mensagem do passo 2 |
| `precisa de atenção: …` | `release/RUNBOOK.md`, "Quando o alerta acende", em passos |
| `funções de outra versão` | O passo 4 não terminou, ou alguém publicou funções à mão. Publique de novo |
| `a versão anotada no banco é …` | Outra pessoa publicou ou reverteu depois; confira em `public.ops_releases` antes de seguir |

## Voltar atrás (`npm run reverter -- homolog <sha>`)

`release/reverter.sh` publica de novo o frontend e as funções de um commit anterior, numa cópia temporária do commit, com o lockfile dele. O banco não volta: as migrations aplicadas depois daquele commit ficam, porque o banco é só aditivo. A correção de dado é para frente, com migration nova (`CHECKLIST.md`, "Reversão").

Antes de mexer, o script confere três coisas:

- o commit está na história da `main`;
- todas as migrations do commit já estão aplicadas no ambiente, ou seja, ele já esteve no ar;
- o que ficou depois dele e apaga ou renomeia algo; isso ele só aponta.

No fim, anota a reversão em `public.ops_releases`, roda o smoke esperando aquele commit e mostra o tempo total.

```bash
npm run reverter -- homolog <sha anterior> --conferir   # só mostra
npm run reverter -- homolog <sha anterior>
```

Para voltar à `main`, rode `npm run publicar -- homolog` quando a correção estiver lá.

## Depois de publicar

1. `npm run test:staging` com as variáveis de `tests/e2e-staging/README.md` (de 5 a 18 minutos: a jornada espera o horário de um atendimento de hoje começar). Grava só no negócio da conta técnica sintética, que precisa de Mensagens ligado: `npm run preparar:uat -- homolog --tecnico <id>` (uma vez).
2. Para o UAT: quando o cabeleireiro e o personal tiverem criado as contas, `npm run preparar:uat -- homolog --cabeleireiro <id> --personal <id>` (ids em Table Editor › `tenants`). Liga Mensagens só nesses dois negócios, para o código da reserva pelo link ser lido no Simulador. Ao fim, o mesmo comando com `--desligar`.
3. Comentar no recado #109 o SHA publicado e o resultado.

## Testar sem conta (o que o CI faz)

```bash
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres LOCAL_DB=tinindo_publicar
createdb tinindo_publicar && psql -d tinindo_publicar -f scripts/db-local/supabase_shim.sql
npm run publicar -- local      # mesmo db push, por --db-url; funções, cron e Worker dizem que pularam
npm run publicar -- homolog --conferir
```

Nenhum dos scripts imprime segredo: os valores vivem só em variáveis do processo e vão direto para o Supabase. Não use `bash -x` com eles.

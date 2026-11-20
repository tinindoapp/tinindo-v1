# e2e contra a homologação (P42)

Roda o smoke do `release/CHECKLIST.md` (seção 2) no ambiente hospedado, em três telas: desktop, iPhone (WebKit) e Android.
Não roda no CI de PR, porque precisa da homologação no ar. Não grava dados: só lê e entra com a conta técnica sintética.

## Variáveis

| Variável | Obrigatória | O que é |
|---|---|---|
| `STAGING_URL` | sempre | Endereço do frontend de homologação. Sem ela a suíte nem começa |
| `STAGING_REQUIRED` | não | `1` torna obrigatórias todas as variáveis abaixo (ver "Modo obrigatório") |
| `STAGING_EXPECTED_SHA` | com `STAGING_REQUIRED=1` | Começo do SHA aprovado; confere `/version.json` |
| `STAGING_SUPABASE_URL` | com `STAGING_REQUIRED=1` | URL do projeto Supabase de homologação; liga a checagem das funções e do bundle |
| `STAGING_SUPABASE_PUBLISHABLE_KEY` | com `STAGING_REQUIRED=1` | Chave pública (publishable) do mesmo projeto |
| `STAGING_TECH_EMAIL` / `STAGING_TECH_PASSWORD` | com `STAGING_REQUIRED=1` | Conta técnica sintética (nunca conta de pessoa real) |
| `STAGING_PUBLIC_SLUG` | com `STAGING_REQUIRED=1` | Perfil publicado da conta técnica, para o link público |

A senha da conta técnica fica só no terminal de quem roda (ou no secret do CI). Não entra em arquivo versionado.

## Rodar

```bash
npx playwright install chromium webkit
STAGING_URL=https://homolog.exemplo npx playwright test -c tests/e2e-staging/playwright.config.ts
```

## Modo obrigatório (`STAGING_REQUIRED=1`)

Sem `STAGING_REQUIRED`, o passo que depende de uma variável ausente **pula** e mostra o motivo. Serve para o dia a dia, com o ambiente pela metade, mas um resultado verde assim não prova o que foi pulado: leia a lista de pulados.

Com `STAGING_REQUIRED=1`, variável ausente **falha**, e a mensagem diz qual falta: um teste lista todas de uma vez e cada passo que dependia dela falha também (funções, conta técnica, link público, SHA de `/version.json` e bundle apontando para o Supabase de homologação). É o comando para usar antes de liberar para o piloto (`release/CHECKLIST.md`, seção 2):

```bash
STAGING_REQUIRED=1 STAGING_URL=https://homolog.exemplo STAGING_EXPECTED_SHA=… STAGING_SUPABASE_URL=… \
  STAGING_SUPABASE_PUBLISHABLE_KEY=… STAGING_TECH_EMAIL=… STAGING_TECH_PASSWORD=… STAGING_PUBLIC_SLUG=… \
  npx playwright test -c tests/e2e-staging/playwright.config.ts
```

Para ver a falha sem ter homologação, aponte para o preview local (`npm run build && npx vite preview --host 127.0.0.1 --port 4173`) só com `STAGING_URL` e `STAGING_REQUIRED=1`: o comando tem de terminar com erro citando as variáveis ausentes.

O relatório fica em `playwright-report/staging/`. Uma falha em "funções" quase sempre é segredo faltando ou função sem deploy.

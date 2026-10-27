# e2e contra a homologação (P42)

Roda o smoke do `release/CHECKLIST.md` (seção 2) no ambiente hospedado, em três telas: desktop, iPhone (WebKit) e Android.
Não roda no CI de PR, porque precisa da homologação no ar. Não grava dados: só lê e entra com a conta técnica sintética.

## Variáveis

| Variável | Obrigatória | O que é |
|---|---|---|
| `STAGING_URL` | sim | Endereço do frontend de homologação |
| `STAGING_EXPECTED_SHA` | não | Começo do SHA aprovado; confere `/version.json` |
| `STAGING_SUPABASE_URL` | não | URL do projeto Supabase de homologação; liga a checagem das funções |
| `STAGING_SUPABASE_PUBLISHABLE_KEY` | não | Chave pública (publishable) do mesmo projeto |
| `STAGING_TECH_EMAIL` / `STAGING_TECH_PASSWORD` | não | Conta técnica sintética (nunca conta de pessoa real) |
| `STAGING_PUBLIC_SLUG` | não | Perfil publicado da conta técnica, para o link público |

A senha da conta técnica fica só no terminal de quem roda (ou no secret do CI). Não entra em arquivo versionado.

## Rodar

```bash
npx playwright install chromium webkit
STAGING_URL=https://homolog.exemplo npx playwright test -c tests/e2e-staging/playwright.config.ts
```

O relatório fica em `playwright-report/staging/`. Uma falha em "funções" quase sempre é segredo faltando ou função sem deploy.

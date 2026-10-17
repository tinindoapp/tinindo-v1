# ADR-0005 · Migrations, arquivos globais e ownership

Status: aceita · 2026-10-17 · P00

## Migrations

- Dono: integrador. Sequência única em `supabase/migrations/`, nomeada `YYYYMMDDHHMMSS_<assunto>.sql`. Depois de aplicada em ambiente compartilhado, é **append-only**: corrigir com nova migration.
- Módulos propõem em `db/proposals/Pxx/` (SQL + testes pgTAP em `db/proposals/Pxx/tests/`). O integrador numera, revisa e testa em banco limpo (`supabase db reset`) e em banco já migrado, e então inclui.
- Nenhuma sessão de módulo roda `supabase db push` ou `db reset` em projeto compartilhado. Homologação só recebe migration pelo pipeline ou pelo integrador.
- Expandir → código compatível → migrar dados → remover o antigo em release posterior.
- `supabase/seed.sql` é sintético (domínio `exemplo.test`) e só local/CI. Nunca usar `--include-seed` em projeto hospedado.

## Arquivos globais (só o integrador edita)

`package.json`, `package-lock.json`, `.nvmrc`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `.github/**`, `supabase/config.toml`, `supabase/migrations/**`, `supabase/functions/_shared/**`, `supabase/functions/deno.json`, `src/app/**` (roteador, shell, sessão, `modules.ts`), `src/components/ui/**`, `src/styles/**` e `brand/**` (segue `brand/BRAND.md`).

## Arquivos de módulo

Cada pacote escreve nos `paths` do `coordination/manifest.json`. No frontend, o módulo edita **só** `src/features/<módulo>/`. O arquivo `module.tsx` exporta a definição (rota, nav e telas). O integrador adiciona ou remove uma linha em `src/app/modules.ts`. O ESLint impede um módulo de importar outro; a comunicação passa por `@contracts` e pela API.

## Como pedir mudança global

Abrir issue ou PR pequeno com a mudança mínima (ex.: novo campo opcional de contrato, novo componente de UI). O integrador revisa antes dos consumidores. Nada de "consertar" contrato em três branches.

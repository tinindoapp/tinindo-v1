# ADR-0001 · Repositório canônico, stack e versões

Status: aceita · 2026-10-17 · P00 · integrador: @fffalleiros

## Contexto

O kit de arquitetura indicava `fffalleiros/tinindo` como candidato. Era preciso confirmar onde vive o código e se havia app, backend ou dados existentes a preservar.

## Verificado no P00

- O fundador confirmou que `fffalleiros/tinindo` é o repositório canônico. Antes do P00 ele tinha só o README, o kit e a marca, sem `package.json` nem código de app.
- Workspace Lovable "Falleiros Geral": 31 projetos e nenhum é a Tinindo. Não há projeto Lovable vinculado a este repositório.
- Organização Supabase do fundador: apenas `o9-deal-studio` e `Casa diGrazi APP`, nenhum da Tinindo. Não há banco, usuários ou dados reais a migrar.
- O site público (home, agenda e `/cliente/`) fica em outro lugar e não foi tocado. Este repositório cria o **app** e não substitui o site.

## Decisão

Stack do doc01, com versões fixas no `package-lock.json` (instalação com `npm ci`):

| Peça | Versão | Observação |
|---|---|---|
| Node | 22 LTS (`.nvmrc`) | jsdom 30 pede ≥ 22.22.2 no CI |
| React / React DOM | 19.3.1 | |
| react-router | 7.18.4 | Linha 7 (madura). A 8 fica para ADR futura |
| Vite | 8.3.4 | |
| TypeScript | 6.0.3 | O typescript-eslint 8.71 ainda não suporta a 7 |
| Zod | 4.6.7 | Validação em runtime nas duas pontas |
| Vitest | 5.0.5 | Projetos `unit` (jsdom) e `contracts` (node) |
| Playwright | 1.56.1 | Mesma versão dos navegadores do ambiente de dev |
| Supabase CLI | 2.121.0 | devDependency (`npx --no-install supabase`) |
| supabase-js | 2.118.0 | |
| Deno (Edge Functions) | 2.9.6 | `supabase/functions/deno.json` + `deno.lock` |
| Fonte | @fontsource-variable/inter 5.3.0 | Inter com eixo opsz (cobre Inter Display) |

Gerenciador: npm (lockfile único). Estilo: CSS puro sobre `brand/tokens/tokens.css`, sem Tailwind. Isso reduz dependências e mantém a fonte única de tokens. Adotar Tailwind ou shadcn exige nova ADR.

## Consequências

- Atualização de dependência é PR do integrador com CI verde. Módulos não mexem em `package.json`.
- O bundle inicial tem cerca de 645 kB (zod + supabase-js). Code splitting por rota fica para P10, se medirmos impacto.

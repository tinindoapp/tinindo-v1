# Handoff · P00 Fundação e contratos

Sessão: Claude Code (nuvem), integrador em nome de @fffalleiros · 2026-10-17
Branch: `claude/zealous-rubin-savrvj` → PR para `main` (link no PR).

## Resultado

- **Repositório canônico:** `tinindoapp/tinindo-v1` (transferido de `fffalleiros/tinindo` em 18/10/2026, com histórico, PRs e branches). Não há projeto Lovable nem projeto Supabase da Tinindo nas contas do fundador, nem código, banco ou dados a preservar. O site público não foi tocado (ADR-0001).
- **App mínimo compilável:** Vite + React 19 + TS, roteador central com registro de módulos, shell com marca (tokens e wordmark originais, tema claro e escuro, banner "Demonstração"), login provisório e demonstração offline sem servidor.
- **Contratos v1 congelados** em `supabase/functions/_shared/contracts/`: Money, TimeRange, IDs, envelope, catálogo de erros, ServerContext, Tenant/Customer/ProviderService, Booking e transições, Quote, Waitlist, Finance, ActionProposal/aprovação, perfil/indicação, eventos e o registro das 22 operações do doc03 (ADR-0002/0004).
- **Fixtures sintéticas comuns** (`contracts/fixtures.ts`): tenants A e B, donos, cliente com login nos dois, cliente sem login, usuário sem vínculo, três serviços, agenda lotada e parcial e pacote de 10 sessões, com relógio fixo. `supabase/seed.sql` espelha o que existe no banco (há teste para isso).
- **Isolamento básico no banco:** migration `20261017120000_foundation.sql` (tenants, memberships, resources, idempotência, outbox, auditoria, RLS e grants explícitos) e caminho request → autorização → banco: Edge Function `context` → `public.resolve_context` (ADR-0003).
- **CI real:** `.github/workflows/ci-app.yml` com lint, typecheck, unit, contratos, build, coordenador, audit, `deno check`, banco (migrations do zero + seed + pgTAP + lint), e2e (desktop + mobile) e gitleaks. Actions fixadas por SHA, sem secrets.
- **Ownership:** `.github/CODEOWNERS`, ADR-0005 (arquivos globais × de módulo) e `db/proposals/README.md`.

## Comandos executados nesta sessão e resultados

| Comando | Resultado |
|---|---|
| `npm ci` / `npm install` | ok, 0 vulnerabilidades |
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `npm run test:unit` | 22/22 |
| `npm run test:contracts` | 26/26 |
| `npm run build` | ok (aviso de chunk > 500 kB, ver limitações) |
| `npm run test:e2e` | 6/6 (Chromium desktop + Pixel 7) |
| `deno check --frozen …/index.ts` | ok |
| `npm run db:test:local` (Postgres 16 + shim, sem Docker) | 33/33 pgTAP |
| Mutação: política de `tenants` → `using (true)` | 3 asserções falharam (testes pegam vazamento) |
| Mutação: grid do shell sem `minmax(0,…)` | e2e mobile falhou (scrollWidth 793 > 412) |
| `npm run test:coord` | 22/22 |

**Não executado aqui (o proxy bloqueia as imagens de container):** `supabase db start/test db/db lint` e gitleaks. Rodam pela primeira vez no CI deste PR. O pgTAP foi validado em Postgres 16 com shim de `auth`; o Supabase usa Postgres 17, e o CI confirma.

## Mocks, fixtures e conexões pendentes

- Sem Supabase configurado, o app usa a fixture `tenantA` (offline, só leitura e rotulada). Com Supabase, a seleção de negócio vem de `tenant_memberships` real.
- O login por e-mail e senha é **provisório** (usuários sintéticos). P01 entrega o onboarding real e `business.create`.
- Os módulos P01–P09 são telas "Em construção" que não simulam dados.

## Gates de ambiente abertos (precisam de pessoa)

1. **Quadro remoto (`coordination`)**: inicializado em 17–18/10 com integrador `fffalleiros`. Sem `gh` autenticado na nuvem, o estado foi gravado via git com as próprias funções do `coord.py` (`new_board`/`transition`). P00 está `done` (PR #3, merge `8401f17`). Em máquina com `gh` autenticado, `coord.py` opera normalmente.
2. **Proteção da `main`** (Settings → Rules → Rulesets): exigir PR, 1 aprovação de outra pessoa, code owners, checks `app-quality`, `functions`, `database`, `e2e`, `secrets`, branch atualizada, bloquear force-push e sem bypass rotineiro. Repositório privado: confirmar que o plano GitHub oferece rulesets.
3. **Login do Gabriel** para `CODEOWNERS` e `--integrators`. Não foi inventado.
4. **Projetos Supabase** de homologação e produção, hosting do app e `ALLOWED_ORIGINS` (ADR-0006).
5. **Política de privacidade final** antes de qualquer dado real.

## Feature flags

Não há flags de servidor ainda. `VITE_APP_ENV ≠ production` liga o banner de demonstração (padrão seguro: `local`).

## Limitações conhecidas

- Bundle de cerca de 645 kB (zod + supabase-js); code splitting fica para P10, se medido.
- Safari/iOS ainda não testado (UX-01). O e2e roda só Chromium.
- Dispatcher de outbox, expiração de holds e Cron ficam com o P06.

## Pacotes que podem começar depois do merge

P01, P02, P03, P04, P05, P07 e P09 contra os contratos v1 e fixtures, respeitando o limite de **4 implementadores simultâneos** (docs/07). Sugestão do dia 1: **P01 + P02 + P04 + P09**. P03 entra assim que houver vaga, e P06/P08 depois que P03/P05 tiverem contrato implementado. Cada um começa por `claim` no quadro.

## Próximo passo preciso

Feito: PR #3 mergeado na `main` (`8401f17`), quadro inicializado e P00 `done`. P01–P09 estão disponíveis no quadro.

1. Proteger a `main` (item 2 dos gates) antes de abrir várias sessões.
2. Homologar o coordenador com duas sessões reais (smoke remoto do `VALIDACAO_DA_ENTREGA.md`) antes de distribuir P01–P09 em paralelo.
3. Abrir até 4 sessões (sugestão: P01, P02, P04, P09), cada uma com `claim` no quadro e branch `task/pxx/<sessão>`.

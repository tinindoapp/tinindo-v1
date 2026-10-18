# Handoff · Integração 1 (P01, P02, P09)

Sessão: integrador contínuo (Claude Code na nuvem, para @fffalleiros) · 2026-10-18
Branch: `claude/integra-p01-p02` → PR para `main`. Decisões em `docs/adr/0007-integracao-p01-p02-p09.md`.

## Entregue

- Propostas P01/001, P02/001, P01/002 e P09/001 viraram migrations, na ordem da ADR-0007. Os testes pgTAP foram para `supabase/tests/database/` e o seed do P02 para `supabase/seed.sql`.
- Teste de concorrência do P01 em `tests/db-concurrency/`, com o runner `npm run db:test:concurrency`, agora no job `database` do CI.
- Contratos de P01, P02 e P09 promovidos para `_shared/contracts`, com 17 operações novas no registro e no doc03.
- AppShell deixa a Conta abrir sem negócio. Rotas públicas `/criar-conta` e `/recuperar-senha`. Links na tela de entrada. Auth local exige senha de 10 caracteres.
- Quadro: P01, P02, P04 e P09 marcados `done`.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npm test` | unit 212/212 · contratos 72/72 |
| `npm run build` | ok (aviso de chunk já conhecido) |
| `npm run test:e2e` | 32/32 (4 novos: rotas públicas do P01, desktop + mobile) |
| `deno check --frozen …/*/index.ts` | ok |
| `npm run db:test:local` (PG 16 + shim) | fundação 33, P01 45, P02 57, vínculo 37, P09 48: tudo ok |
| `npm run db:test:concurrency` | 7/7 |

Não executado aqui: `supabase db start/test db/db lint` (sem Docker). Roda no CI do PR.

## Pendências

- Fluxo real de e-mail (cadastro e recuperação) depende de SMTP e URLs de homologação, um gate de ambiente.
- P02 ainda não tem o botão "convidar para vincular" (`customer_link.issue`) na ficha do cliente.
- Propostas do P04 (`booking.list`, `schedule.day_plans`, `resource_id` no contexto, `booking.no_show`) entram com o P03.

## Próximo passo

P03, o motor de agenda, ligando a agenda do P04 ao servidor.

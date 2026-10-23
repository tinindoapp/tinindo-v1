# Handoff · P19 Campanhas e experimentos

Sessão: `claude-int-p19` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-23
Branch: `claude/p19-campanhas` → PR para `main`. Decisões em `docs/adr/0022-campanhas-e-experimentos.md`. Onda 2, PR 7 (`docs/plano-onda-2.md`).

## Resultado

- **Banco** (`20261022170000_p19_campaigns.sql`): `campaigns` (segmento, hash do público, controle sorteado, tetos, oferta, janela, resultado congelado), `campaign_members` (append-only; braço e passo); modelo `oferta_campanha`; `lifecycle_steps.rule` ganha `campaign`; `app.cp_*` (segmento, oferta, Wilson, braço, resultado, fechamento); `app.lc_dispatch` e `jobs_run` substituídos; eventos `campaign.approved.v1` e `campaign.closed.v1`.
- **Edge Function `campaigns`**: 5 operações do dono pelo `rpc-handler` (prévia, aprovar, listar, detalhe, cancelar).
- **Contratos** (`_shared/contracts/campaigns.ts`), registro v1, `EventType`, docs/01, docs/03, docs/10 (CMP-01), release/CHECKLIST (20 funções).
- **Tela** `/app/campanhas`: segmento com prévia do público autorizado, controle %, tetos de envio e gasto, janela, oferta (desconto em serviço), aprovação; lista com resultado por braço (taxa e intervalo), diferença com intervalo e veredito pelo desenho; participantes; cancelar. Demonstração com "Simular janela".

## Aceite do pacote (tasks/P19.md)

| Critério | Evidência |
|---|---|
| Autorização do público | pgTAP 18: 16 de 20 (sem consentimento, com atendimento futuro e arquivada ficam de fora); segmento inventado recusado; int `35_p19` passo 1 |
| Limite de gasto no servidor | pgTAP 18: teto R$ 30 com oferta de R$ 6 → 5 tratadas de 16; `estimated_cost_cents`; int passo 2 (custo = 600 × tratadas) |
| Avaliação sem causalidade presumida | pgTAP 18: sem controle → `observation_only`; com controle 8×8 e 8/8 vs 0/8 → `difference_detected` com limite inferior > 0; contratos: vereditos sem "causa/efeito"; e2e: textos |
| Controle sorteado e braço imutável | pgTAP (8/8, controle sem passo), conc `18_campaigns` (duas aprovações paralelas → uma; cada cliente num braço só), trigger append-only |
| Idempotência do fechamento | pgTAP (segunda rodada não fecha), conc (3 workers → fechada uma vez, um evento) |
| Autorização entre tenants | pgTAP 18 e int SEC: dono B 403; RLS 0 linhas |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` | ok |
| `npm run test:integration` | ok (novo `35_p19_campanhas`, 5 passos) |
| `npm run db:test:local` | ok (P19: 48 asserções) |
| `npm run db:test:concurrency` | ok (`18_campaigns`) |
| `deno check --frozen` | ok |
| `npx playwright test` | ok (novo `tests/e2e/campaigns`) |
| gitleaks | sem achados |

## Decisões tomadas sem consulta

- Três segmentos fixos (inatividade, saldo de pacote, todas com consentimento); sem filtro livre.
- Controle de 0–50%, padrão 20%; janela de 7–60 dias, padrão 14; limiar de 5 por braço para comparar.
- Intervalos: Wilson 95% por braço e Newcombe para a diferença; veredito só pelo intervalo.
- Oferta não altera preço sozinha: o desconto é aplicado no atendimento pelo P05/P11; a campanha só comunica e mede.
- `LifecycleRule` (contrato do P13) não ampliado: os passos de campanha são vistos pela própria tela de Campanhas.

## Pendências

- Nenhuma do pacote. Gate externo: canal real (P12) para os envios saírem sozinhos; até lá, "para compartilhar".

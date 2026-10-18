# Handoff · P05 Regras e ofertas de preço

Sessão: `claude-int-p05` (integrador contínuo, para @fffalleiros) · 2026-10-18
Branch: `claude/p05-precos` → PR para `main`. Decisões em `docs/adr/0010-preco-por-regras.md`.

## Resultado

- **Banco** (`20261018150000_p05_pricing.sql`): `pricing_rule_proposals`, `pricing_rule_approvals` (backend-only), `pricing_rules` (uma ativa por serviço) e `price_quotes`. As RPCs são cotação, proposta, aprovação, publicação, desativação e leitura, mais `app.price_compute`. A migration estende `app.sched_insert_booking`, `scheduling_booking_confirm` e `scheduling_booking_reschedule` para validar e consumir cotações.
- **Edge Function `pricing`** (6 operações) sobre o handler compartilhado.
- **Domínio** `_shared/domain/pricing/price.ts` com as fixtures do doc06.
- **Tela Preços** (`/app/precos`): simulador real (piso manual/econômico, valor final, contribuição "não é lucro"), regras ativas (desativar) e nova regra com prévia e "Aprovar e publicar", que aprova o hash visto.
- **Agenda** cota pelo servidor (`/pricing/pricing.quote`).

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Fixtures com arredondamento/taxa/margem | `PRICE_FIXTURES` (7 casos) em vitest e pgTAP; teste de contrato amarra os dois |
| Piso > base bloqueia | pgTAP (proposta 422), simulador e e2e |
| Cotação expira | pgTAP: cotação vencida negada no banco; hold ≤ prazo da cotação |
| Contrato vendido preservado | pgTAP: nova regra não muda reserva confirmada; reagendar sem cotação mantém o preço |
| UI mostra motivo/valor final | e2e Preços; UAT 5b do barbeiro saiu do fixme |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npm test` | unit 248/248 · contratos 167/167 |
| `npm run build` | ok |
| `npm run test:e2e` | 80 passaram, 34 fixme |
| `deno check --frozen` | ok (8 funções) |
| `npm run db:test:local` | tudo ok (P05: 50 asserções) |
| `npm run db:test:concurrency` | P01, P03, P05 (5 publicações com a mesma aprovação → 1; 2 publicações paralelas → 1 ativa) e P07 ok |

## Pendências

- A emulação offline da agenda continua com a regra de exemplo própria (terça −15%, v3), separada da emulação de Preços.
- A tela não lista o histórico de regras inativas, só as ativas e as propostas abertas (a API devolve o histórico).
- Sem cotação pública (link do P09): o visitante só vê horários; reservar pelo link fica para o P09/P06.

## Próximo passo

P06 (lista de espera e jobs): ofertas com hold + cotação, dispatcher do outbox e `scheduling_expire_holds()`.

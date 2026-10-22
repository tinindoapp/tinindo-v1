# Handoff · P14 Pagamento conectado

Sessão: `claude-int-p14` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-22
Branch: `claude/p14-pagamentos` → PR para `main`. Decisões em `docs/adr/0018-pagamento-conectado.md`. Onda 2, PR 3 (`docs/plano-onda-2.md`).

## Resultado

- **Banco** (`20261022130000_p14_payments.sql`): `payment_charges`, `payment_refunds`, `payment_webhook_events` (dedupe), `payment_reconciliations`, `payment_sim_ledger` (PSP fictício, backend); `payment_entries.source` aceita `provider` e ganha `charge_id`. 6 RPCs do dono, 1 pública (link), 9 de backend; baixa única em `app.pay_settle`.
- **Edge Function `payments`**: criar (provedor depois da RPC, resultado pelo backend), cancelar, estornar, conciliar (relatório do PSP → RPC), listas; `payment.link_view` e `payment.sim_pay` (anônimas, token no corpo); `payment.webhook/<provider>` (HMAC sobre o corpo bruto); `payment.sync` (segredo).
- **Provedores** (`_shared/domain/payments/providers.ts`): `simulated` e `psp` (esqueleto), atrás da mesma porta.
- **Contratos** (`_shared/contracts/payments.ts`, `PaymentSource` com `provider`), registro v1 (módulo `payments`, 8 operações), docs/01, docs/03, docs/10 (PAY-01).
- **Telas**: `/app/pagamentos` (cobrar, cobranças com estado por palavra, cancelar, estornar, conciliar o dia, consultar o provedor na demonstração) e `/pagar#t=…` (link público: valor, Pix, estado; na cobrança simulada, pagar/expirar e "perder o aviso").

## Aceite do pacote (tasks/P14.md)

| Critério | Evidência |
|---|---|
| Webhook assinado | teste do handler (assinatura inválida 401, corpo alterado 401, provedor desconhecido 404); int `31_p14_pagamentos` SEC (forjado não entra) |
| Idempotência | pgTAP 14: mesma notificação = duplicada, outra notificação da mesma cobrança = `already_settled`, 1 recebimento, 1 evento; conc `14_payments`: 5 webhooks iguais, 5 diferentes, webhook × consulta, 2 estornos; criação repetida devolve a mesma cobrança e o mesmo link (int passo 1) |
| Estorno | pgTAP 14 e int passo 4: pedido → confirmado pelo PSP → reversão vinculada (recebível reabre); repetir recusado |
| Timeout ambíguo reconciliado | int passo 6 (sem resposta → `unknown` → sync fecha), passo 5 (webhook perdido → conciliação lista `paid_without_entry` → sync dá baixa → conciliação limpa); provedor: 5xx/timeout = `unknown` (`providers.test`) |
| Credenciais só no servidor | `index.ts` lê `PSP_*` do ambiente; sem elas 503 antes do banco (handler, int SEC, e2e); nada no app nem no banco |
| Entre tenants | pgTAP 14 e int SEC: dono B 403 em listar, cobrar, estornar, conciliar; RLS 0 linhas; tabelas de backend sem grant |
| Replay e recuperação | cancelar exige versão; pago depois de cancelado fica registrado sem baixa e aparece na conciliação (pgTAP 14) |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` | ver PR |
| `npm run test:integration` | ver PR (novo `31_p14_pagamentos`, 8 passos) |
| `npm run db:test:local` | ok (P14: 67 asserções) |
| `npm run db:test:concurrency` | ok (`14_payments`) |
| `npm run db:restore:drill` | ok |
| `deno check --frozen` | ok |
| `npx playwright test` | ver PR (novo `tests/e2e/payments`, desktop + mobile) |
| gitleaks | sem achados |

## Decisões tomadas sem consulta

- Nenhum PSP foi contratado. O adaptador `psp` é um esqueleto REST genérico (Pix por cobrança, webhook HMAC) a ajustar ao provedor escolhido; os caminhos estão documentados no arquivo. Segredos esperados: `PAYMENTS_SYNC_SECRET`, `PAYMENTS_SIM_SECRET`, `PSP_BASE_URL`, `PSP_API_KEY`, `PSP_WEBHOOK_SECRET`.
- Estorno só total (modelo de reversão do P07). Estorno parcial fica para quando houver PSP real e caso de uso.
- O simulador de pagamento é acessível pelo link público (anônimo) SÓ para cobrança simulada: é o caminho de homologação sem PSP e está rotulado.
- Cobrança vale 60 min por padrão; vencida há mais de 1 min entra na consulta (o PSP decide: pago ou expirado).
- `payment_entries.source` ampliado por `alter table` (aditivo), registrado na ADR como exceção consciente ao append-only estrito.
- O P14 não estava no manifesto (mesmo caso dos pacotes anteriores); o quadro não foi alterado.

## Limitações e próximos passos

- Sem cron o sync não roda: configurar POST a cada minuto com o segredo (como `jobs` e `channel.dispatch`).
- Sem estorno parcial, sem boleto/cartão (só Pix por cobrança), sem split.
- A tela não mostra o link de cobranças antigas (o token sai uma vez; só o hash fica); a cliente usa o Pix copia e cola listado.
- P13 (régua de cobrança) e P20 (recorrência) usam `payment.charge_create` e `payment.recorded.v1`.
- Staging: rodar `tests/e2e/payments` contra o projeto hospedado com o PSP simulado antes de qualquer sandbox real.

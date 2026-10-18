# Handoff · P07 Caixa registrado e pacotes

Sessão: `claude-int-p07` (integrador contínuo, para @fffalleiros) · 2026-10-18
Branch: `claude/p07-caixa` → PR para `main`. Decisões em `docs/adr/0009-caixa-registrado.md`.

## Resultado

- **Banco** (`20261018140000_p07_finance.sql`): `receivables`, `payment_entries` (append-only, estorno vinculado), `expense_entries` (append-only), `session_packages` e `session_entries` (ledger append-only), com FKs compostas para cliente, serviço e reserva e RLS só do dono. São 14 RPCs.
- **Edge Function `finance`**: 14 operações sobre o handler genérico compartilhado com `scheduling`.
- **Tela Caixa** (`/app/caixa`): resumo do mês (recebido, gasto, a receber, cobertura), concluídos sem cobrança (marcar como recebido, cobrar depois, usar crédito), a receber (recebimento parcial, cancelar), recebimentos com estorno, despesas com estorno, pacotes (vender, saldo, estornar consumo) e cobrança avulsa.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| R$1.000 em 10 sessões não repete caixa | pgTAP: um recebível de 100000; consumir sessões não cria recebimento; cobrança de atendimento pago com crédito negada |
| Consumo, retry e estorno certos | pgTAP e concorrência: mesmo evento 5× → 1 débito; evento de outro pacote → 422; 10 consumos em pacote de 3 → 3; estorno único |
| Relatório com timezone e cobertura | `finance.summary` com período, fuso, `records_count`, nota; tela monta o mês no fuso do negócio (teste de DST) |
| Acesso de cliente restrito | pgTAP: cliente vinculado e dono de outro negócio não leem nem chamam; anon negado |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npm test` | unit 246/246 · contratos 140/140 |
| `npm run build` | ok |
| `npm run test:e2e` | 76 passaram, 36 fixme (UAT 9b do barbeiro saiu do fixme) |
| `deno check --frozen …/*/index.ts` | ok (7 funções) |
| `npm run db:test:local` | tudo ok (P07: 60 asserções) |
| `npm run db:test:concurrency` | P01 7 · P03 11 · P07 9: tudo ok |
| Mutação: sem `FOR UPDATE` no recebível | o teste de concorrência falha (a CHECK ainda impede pagar a mais, mas sem erro semântico) |

## Mocks e pendências

- Demonstração offline: `demoPort.ts` com dados de exemplo (atendimentos de 19/10, pacote de 4 cortes, um recebimento e uma despesa), rotulada.
- UAT do personal seguem em fixme: a demonstração só abre o negócio A.
- Sem integração automática com a conclusão na agenda (P04): o dono resolve no Caixa. Quando o P06 tiver o dispatcher, `booking.completed.v1` pode acionar `package.consume` com o mesmo evento, e a idempotência já cobre isso.
- Atualizei `tests/e2e/qa/uat-*.spec.ts` (9a, 9b, 1a) e `helpers.ts`, que descreviam o placeholder.

## Próximo passo

P05 (preço por regras e cotação ligada ao `booking.create`).

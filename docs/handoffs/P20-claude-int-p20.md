# Handoff · P20 Planos recorrentes do profissional

Sessão: `claude-int-p20` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-23
Branch: `claude/p20-recorrencia` → PR para `main`. Decisões em `docs/adr/0020-planos-recorrentes.md`. Onda 2, PR 5 (`docs/plano-onda-2.md`).

## Resultado

- **Banco** (`20261022150000_p20_recurrence.sql`): `recurrence_plans`, `recurrence_subscriptions` (termos congelados + hash), `recurrence_cycles` (append-only; um ciclo = pacote do P07 + recebível); `app.rc_open_cycle`/`app.rc_tick`; `jobs_run` substituído para renovar a cada rodada; evento `recurrence.cycle.opened.v1`.
- **Edge Function `recurrence`**: 7 operações do dono pelo `rpc-handler` (plano salvar/listar, assinar, cancelar, retomar, assinaturas, ciclos).
- **Contratos** (`_shared/contracts/recurrence.ts`), registro v1, `EventType`, docs/01, docs/03, docs/10 (REC-01), release/CHECKLIST.
- **Tela** `/app/assinaturas`: planos (criar/editar com versão), adesão declarada com aceite marcado, assinantes com ciclo corrente (saldo e cobrança), cancelar no fim do ciclo / agora, manter, histórico de ciclos. Demonstração com plano de exemplo e "Avançar o ciclo".

## Aceite do pacote (tasks/P20.md)

| Critério | Evidência |
|---|---|
| Cancelamento/renovação preservam regras aceitas e saldo | pgTAP 16: reajuste do plano não muda a assinatura; renovação cobra o preço ACEITO; cancelar ao fim do ciclo encerra no vencimento sem ciclo novo; cancelar agora mantém o saldo do ciclo e o pacote válido; int `33_p20` passos 1, 3, 4; e2e `recurrence` |
| Renovação idempotente | pgTAP 16 (rodada seguinte não renova), conc `16_recurrence` (3 workers → um ciclo, um pacote, um recebível, um evento); adesão dupla em paralelo → uma |
| Consumo de sessões | pgTAP 16 via `package.consume` do P07 (débito único por evento) |
| Cobrança do ciclo | int passo 2: recebível do ciclo cobrado pelo P14 simulado e pago; o ciclo mostra o recebível pago |
| Autorização entre tenants | pgTAP 16 e int SEC: dono B 403; RLS 0 linhas; cliente de outro negócio → 404 |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` | ver PR |
| `npm run test:integration` | ver PR (novo `33_p20_recorrencia`, 5 passos) |
| `npm run db:test:local` | ok (P20: 53 asserções) |
| `npm run db:test:concurrency` | ok (`16_recurrence`) |
| `npm run db:restore:drill` | ok |
| `deno check --frozen` | ok |
| `npx playwright test` | ver PR (novo `tests/e2e/recurrence`) |
| gitleaks | sem achados |

## Decisões tomadas sem consulta

- Ciclos de 7, 14 ou 30 dias (não "mês calendário"): renovação determinística e previsível.
- Créditos não usados não passam de ciclo; o pacote do ciclo vence no fim dele.
- Cobrança do ciclo nunca automática no PSP: recebível + P14/manual. Mandato de cobrança recorrente fica para quando houver PSP contratado.
- Adesão declarada pelo dono (como P06/P07); aceite pela cliente por link fica para expansão.
- Reajuste para quem já assina = nova adesão; o plano pode ser inativado para parar adesões sem afetar assinantes.
- `jobs_run` substituído de novo (`create or replace`), com as três rodadas (outbox, réguas, renovação).
- O P20 não estava no manifesto (mesmo caso dos pacotes anteriores); o quadro não foi alterado.

## Limitações e próximos passos

- Sem pausa de assinatura, sem troca de plano com proporcionalidade, sem fidelidade (desconto por permanência) nem pacotes configuráveis além de sessões × ciclo.
- Sem lembrete específico de "ciclo renovado": o P13 lembra a cobrança quando vence (régua de cobrança).
- Staging: rodar `tests/e2e/recurrence` e a integração contra o projeto hospedado.

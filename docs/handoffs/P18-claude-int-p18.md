# Handoff · P18 Resultado e custo

Sessão: `claude-int-p18` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-19
Branch: `claude/p18-resultado-custo` → PR para `main`. Decisões em `docs/adr/0015-resultado-e-custo.md`.

## Resultado

- **Banco** (`20261018200000_p18_analytics.sql`): cálculo dos indicadores no banco (`app.an_metrics`), baselines congeladas (append-only, RLS só do dono), comparação sem causalidade e custo de atendimento por cliente para a operação.
- **Edge Function `analytics`**: 4 operações; `analytics.cost_to_serve` sem negócio selecionado.
- **Contratos** (`_shared/contracts/analytics.ts`).
- **Telas**: `/app/resultado` (período, indicadores com a conta, comparação com a baseline e aviso, o que falta nos dados, congelar baseline) e `/app/resultado/custo` (operação: custo-hora informado, tabela por cliente). A demonstração offline usa uma agenda sintética com as mesmas definições, rotulada.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Baseline e denominador | pgTAP com cenário conhecido: ocupação 120 / 2.940 min (5 × 10 h − 1 h de bloqueio), faltas 1/3, cancelamentos 1/4; baseline só com período encerrado, congelada (registro posterior não muda), repetição devolve a mesma (pgTAP e concorrência) |
| Cobertura dos dados | pgTAP: atendimento sem desfecho, concluído sem cobrança, período com futuro, negócio sem expediente; insuficiente e indisponível com valor nulo (e2e: tela não mostra 0%) |
| Minutos medidos | pgTAP: 45 min humanos, automação e retrabalho à parte; custo por cliente = 45 min × R$60/h = R$45, só para operador |
| Não atribuir causalidade | `causality` literal no contrato (teste da função: resposta "established" vira 500); aviso fixo na comparação (pgTAP e e2e) |
| Entre tenants | pgTAP: dono B → 403, baseline de A em B → 404, RLS 0 linhas, cliente com login → 403, dono não vê o custo por cliente |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` | ok |
| `npx vitest run` | 627/627 |
| `npm run build` | ok |
| `npx playwright test` | 111 passaram, 31 fixme (novo: `tests/e2e/analytics`, desktop + mobile) |
| `deno check --frozen` | ok |
| `npm run db:test:local` | tudo ok (P18: 42 asserções) |
| `npm run db:test:concurrency` | todos ok (P18 incluído) |

## Decisões tomadas sem consulta (pedido do dono: "decida pelos docs")

- O P18 depende do P13 (lembretes), que não existe: o indicador de lembretes sai como "indisponível", nunca zero. O pacote não esperou o P13.
- A falta conta na ocupação como tempo reservado.
- O custo-hora não é fixado no sistema: quem consulta informa (a tela sugere R$60/h como premissa editável, o cenário do doc15).
- O P18 não estava no manifesto (mesmo caso do P11/P15); o quadro não foi alterado.

## Limitações e próximos passos

- Períodos prontos (7 e 28 dias encerrados, próximos 7 dias); não há escolha livre de datas na tela (a API aceita qualquer período até 400 dias).
- Sem exportação dos indicadores.
- Custo por cliente não inclui infraestrutura, canal, impostos nem aquisição (docs/11).
- Quando o P13 entrar, trocar o indicador de lembretes de `unavailable` para o cálculo real.
- Staging: rodar a jornada no projeto hospedado depois do gate de ambiente.

# Handoff · P31 Financeiro ampliado

Sessão: `claude-int-p31` (Claude Code na nuvem, para @fffalleiros) · 2026-11-03
Reserva: `coord.py claim P31 --session claude-int-p31` · branch `task/p31/claude-int-p31` → PR para `main`. Decisões em `docs/adr/0033-financeiro-ampliado.md`.

## Resultado

- **Banco** (`20261103011000_p31_finance_advanced.sql`, aditiva): seis tabelas novas.
  - `fin_categories` e `fin_classifications`: categoria própria por lançamento.
  - `fin_payable_series` e `fin_payables`: contas a pagar, únicas ou mensais.
  - `fin_payable_payments`: um pagamento vivo por conta; o estorno só pode ser gravado uma vez.
  - `fin_reconciliations`: conferências do extrato, append-only.
  - 13 RPCs do dono. Nenhuma tabela ou função de P07, P14, P16 ou P28 muda; o P31 só lê e grava pelo caminho do P07 (`expense_entries`).
- **Edge Function `finance-advanced`**, com 13 rotas sobre o `rpc-handler`.
- **Contratos** aditivos em `_shared/contracts/finance-advanced.ts`, módulo `finance-advanced`, prefixo de operação `accounts.*`. Também docs/03, docs/10 (ACC-01) e release/CHECKLIST (27 funções).
- **Tela** `/app/contas` (Dinheiro → Contas), dividida em quatro abas com `Segmented`:
  - **Mês:** caixa do mês com período escrito e fuso; Entrou, Saiu e Sobrou; categorias; "O que falta lançar"; lançamentos para classificar.
  - **A pagar:** pagar mostra um toast com **Desfazer**, que estorna. Cancelar e estornar pedem `ConfirmAction`. Nova conta usa `Field` e `useFormErrors`, com os erros embaixo de cada campo. A conta mensal permite "Criar mais 12 meses" e "Encerrar".
  - **Conferir:** dia, registrado por meio e origem, o que o PSP diz, valor do extrato e diferença.
  - **Categorias.**
  
  A demonstração usa as mesmas regras e é rotulada.

## Aceite do pacote

| Critério | Evidência |
|---|---|
| Pagar duas vezes não baixa duas vezes | **pgTAP 29:** repetir com a mesma chave devolve a mesma resposta; outra chave → `POLICY_REJECTED/paid`; versão antiga → `STALE_VERSION`; uma despesa no Caixa; pagamento não se edita.<br>**Concorrência `27_finance_advanced`:** 10 pagamentos simultâneos → 1 despesa e 1 pagamento vivo; 10× a mesma chave → 1; 5 estornos → 1; pagar × cancelar em 5 rodadas → nunca os dois.<br>**Integração `44_p31_contas`** passo 1 e **e2e** |
| Contas a pagar (vencimento, recorrência, pago, estorno) | **pgTAP/integração/e2e:** a mensal gera 12 meses (vencimento até o dia 28) e nunca duplica mês, nem com 5 extensões simultâneas; estorno uma vez, e a conta volta a "a pagar"; encerrar cancela as futuras |
| Categorias de receita e despesa | **pgTAP/integração/e2e:** nome único por tipo; a categoria de despesa decide a categoria do Caixa; receita não usa categoria de despesa; o demonstrativo agrupa pela categoria própria ou pela de origem |
| Conciliação por meio (manual e PSP simulado) | **pgTAP:** registrado por meio e origem; o pago segundo o provedor bate com o registrado; diferença guardada; a última conferência vale; dia futuro recusado.<br>**Integração:** recebimento manual (P07) e pelo PSP simulado (P14, `payment.sim_pay`) |
| Demonstrativo com cobertura, sem se chamar DRE | **pgTAP/integração/e2e:** `basis = cash`; período com primeiro e último dia e fuso; entrou − saiu = sobrou; o estornado não conta; a cobertura lista atendimentos sem cobrança, contas não pagas, a receber vencido, lançamentos sem categoria, dias sem conferência e notas (P16).<br>**Contrato:** "Não é DRE" e nenhuma ocorrência de 'DRE' como nome |
| Isolamento | **pgTAP/integração:** dono B recebe 403 e vê 0 linhas pela RLS; cliente com login recebe 403/0; conta e lançamento de A usados no negócio B → 404; anon sem execução; auditoria sem fornecedor nem descrição |

## Comandos e resultados (local, Postgres 16 + pgTAP)

Bateria completa local: unit 584 · contratos 593 (com os do P31) · pgTAP 29 arquivos ok · concorrência 24 scripts ok · integração 124 · deno 27 funções · e2e 217 passaram, 33 fixme preexistentes. Resultados do pacote:

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| pgTAP `29_finance_advanced` | 61/61 |
| concorrência `27_finance_advanced` | 14/14 |
| integração `44_p31_contas` | 6/6 |
| e2e `finance-advanced` | desktop e celular (375 px), ok |
| **Mutação:** sem o índice de pagamento vivo e sem o `FOR UPDATE` | o teste de concorrência falha: 8 despesas para a mesma conta |

Não executado aqui: `supabase test db` e `db lint` no PG 17, porque não há Docker. Os dois rodam no CI.

## Decisões tomadas sem consulta (pedido do dono: "decida pelos docs")

- **Quadro:** o P31 foi liberado no quadro pelo integrador, com autorização do dono para escrever no branch `coordination`, e reservado pelo `coord.py`.
- **Módulo:** `finance-advanced`, com as operações em `accounts.*` (nome de operação não aceita hífen).
- **Recorrência:** só mensal, com 12 meses gerados de uma vez e vencimento entre os dias 1 e 28. Semanal e anual ficam para depois, se houver pedido.
- **Pagamento:** o valor pago é o valor da conta, sem pagamento parcial, juros ou desconto (corrija a conta antes de pagar). O meio de pagamento da despesa não é registrado, porque o P07 não tem esse campo.
- **Conciliação:** é declarada pelo dono, que digita o valor do extrato. Não há leitura de banco (Open Finance ou OFX).
- **Estorno no demonstrativo:** segue a regra do resumo do Caixa (P07) — o original estornado sai do mês inteiro, mesmo que o estorno seja de outro mês. A ADR registra isso.
- **Notas fiscais (P16):** aparecem na cobertura só como informação.

## Pendências e próximos passos

- DRE de verdade: competência, impostos, custo do serviço e um contador. O critério está na ADR-0033.
- Leitura de extrato e conciliação automática, que dependem de consentimento e contrato.
- Pagamento de comissão da equipe (P28) como conta a pagar gerada a partir do relatório de comissões.
- Homologação: nada aplicado. O projeto `kitdsdyydgutnbiwjblw` não foi tocado.

## Recuperação

A migration é aditiva. Para desligar, basta tirar a linha do módulo em `src/app/modules.ts`/`navigation.ts`. As despesas pagas pelas Contas ficam no Caixa como despesas comuns, com o estorno vinculado.

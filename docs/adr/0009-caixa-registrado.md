# ADR-0009 · Caixa registrado, recebíveis e pacotes de sessões (P07)

Status: aceita · 2026-10-18 · integrador (implementou o P07)

## Decisões

1. **Quatro registros distintos**: reserva (P03), recebível (valor devido), recebimento (dinheiro registrado) e crédito de sessão. Concluir atendimento não cria recebível sozinho: o dono escolhe "Marcar como recebido", "Cobrar depois" ou "Usar crédito do pacote" em *Atendimentos concluídos sem cobrança*.
2. **Recebimentos e despesas são append-only.** Correção é estorno: linha nova com `reversal_of`, única por original (índice único). O original nunca muda. Triggers `app.forbid_mutation` barram UPDATE/DELETE.
3. **Saldo do recebível sob lock.** `finance.record_payment` trava o recebível (`FOR UPDATE`) e nega valor acima do aberto (422). A CHECK `paid_cents <= amount_cents` e a de coerência entre status e valor são a última barreira.
4. **Pacote = um recebível.** `package.sell` cria o pacote e um único recebível do total, numa transação. O preço contratado fica no pacote e não muda com o preço do serviço.
5. **Consumo por evento.** `package.consume` exige o `booking.completed.v1` daquela reserva (outbox), mesmo cliente e serviço, validade e saldo, e trava o pacote. Débito único por evento (índice único em `source_event_id`). Repetir o mesmo evento no mesmo pacote devolve o saldo sem debitar. Evento já usado em outro pacote dá 422. Um atendimento pago com crédito não pode ser cobrado, e vice-versa.
6. **Resumo honesto** (`finance.summary`): recebido e gasto no período excluem os registros estornados. "A receber" é o saldo aberto *hoje*. Cobertura = número de registros + nota fixa ("só registros manuais; não é lucro nem saldo bancário"). Período em instantes absolutos; a tela monta o mês no fuso do negócio. `timezone` foi acrescentado à saída (aditivo).
7. **Acesso só do dono.** Staff, cliente vinculado e anônimo não leem nenhuma tabela do caixa (RLS `owner`) nem chamam as RPCs.
8. **Recebimento só manual** (`source = 'manual'`). PSP, split e fiscal ficam fora (P14/P16).
9. **Eventos**: `payment.recorded.v1` por recebimento. Sem evento de estorno, porque o contrato v1 não tem um; a auditoria registra.
10. A demonstração offline emula as mesmas regras na aba (`demoPort.ts`), rotulada "Dados de exemplo".

## Contrato (aditivo)

Novas operações: `finance.create_receivable`, `finance.charge_booking`, `finance.cancel_receivable`, `finance.reverse_payment`, `finance.record_expense`, `finance.reverse_expense`, `finance.ledger`, `finance.uncharged`, `package.sell`, `package.reverse` e `package.list`. A saída de `finance.record_payment` continua `PaymentEntry`.

## Infra

`_shared/http/rpc-handler.ts` é o handler genérico "rota → uma RPC" usado por `scheduling` e `finance`. `_shared/http/command.ts` tem o hash canônico e o cursor, extraídos do `crm`.

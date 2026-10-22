# ADR-0018 · Pagamento conectado (P14)

Status: aceita · 2026-10-22 · integrador (onda 2, PR 3; plano em `docs/plano-onda-2.md`)

## Contexto

O P07 registra recebimentos manuais. O P14 liga um provedor de pagamento (PSP) para cobrar por Pix a partir do recebível e dar baixa com evidência do provedor. Regras do projeto: não custodiar dinheiro, não contratar serviço nem mover dinheiro sem autorização, credenciais só no servidor, notificação repetida nunca dá baixa duas vezes, falha incerta exige consulta (docs/02, docs/05, docs/15, tasks/P14).

## Decisões

1. **PSP atrás de porta.** `PaymentProviderPort` (`_shared/domain/payments/providers.ts`): `createCharge`, `status`, `cancel`, `refund`, `report`, `verifySignature`, `normalize`. Dois adaptadores: `simulated` (PSP fictício cujo "outro lado" é `payment_sim_ledger`, tabela só de backend; valor terminado em 99 centavos falha, em 98 fica sem resposta na primeira tentativa) e `psp` (esqueleto REST de Pix por cobrança com webhook HMAC; só com `PSP_BASE_URL`, `PSP_API_KEY`, `PSP_WEBHOOK_SECRET`; sem eles `configured = false` e criar cobrança responde 503 antes do banco). O contrato REST do esqueleto é genérico e será ajustado ao PSP contratado, decisão do dono do projeto.
2. **Cobrança pelo saldo do recebível, uma viva por vez.** `payment.charge_create` grava em `creating`, a função chama o provedor e o resultado entra pelo backend (`payment_charge_result`): `pending` (id, Pix, validade), `failed` (motivo) ou `unknown`. Repetir a criação (mesma chave) devolve a mesma cobrança e o mesmo link; o provedor recebe a mesma referência (`Idempotency-Key`).
3. **Pago só com evidência; baixa única.** `app.pay_settle` cria UM `payment_entries` com `source = 'provider'` (aditivo ao P07; o check de `source` foi ampliado) sob lock do recebível e marca a cobrança paga. A segunda evidência (mesmo evento deduplicado por `(provider, external_event_id)`, outro evento da mesma cobrança, ou a consulta depois do webhook) devolve `already_settled` e não cria nada. Pago depois de cancelado o recebível fica registrado na cobrança (`settlement = receivable_cancelled`), sem baixa, e aparece na conciliação.
4. **`unknown` é estado, não presunção.** Sem resposta (timeout, 5xx) a cobrança fica `unknown`; `payment.sync` (rota de sistema por segredo, cron a cada minuto) consulta o provedor para desconhecidas há mais de 1 min e pendentes vencidas, e grava o que o PSP disse. Sem resposta de novo, continua desconhecida. Nunca se marca pago nem falho por tempo.
5. **Estorno total, vinculado e confirmado.** `payment.refund` pede (`requested`), a função chama o PSP e `payment_refund_result` conclui: a conclusão cria a linha de reversão do P07 ligada ao recebimento da cobrança (uma por cobrança). Estorno parcial fica fora deste pacote (o modelo de reversão do P07 é total).
6. **Conciliação com diferenças listadas.** `payment.reconcile(dia)`: a função pede o relatório do dia ao PSP e a RPC compara com cobranças e recebimentos do provedor no fuso do negócio. Tipos: `paid_without_entry`, `entry_without_report`, `amount_mismatch`, `unknown_charge`. Nada é corrigido em silêncio; o sync e o dono resolvem.
7. **Link público e simulador pela mesma porta.** `/pagar#t=<token>` (token só como hash no banco, no fragmento da URL, enviado por POST) mostra valor, Pix e estado. `payment.sim_pay` (anônimo, só cobrança simulada) muda o livro fictício e notifica pelo MESMO webhook assinado com `PAYMENTS_SIM_SECRET`; `notify = false` simula o webhook perdido para exercitar conciliação e sync. Tudo rotulado "simulação".
8. **Privacidade e isolamento.** Auditoria guarda provedor, valores e ids, nunca o Pix nem a descrição. RLS: dono lê cobranças, estornos e conciliações do próprio negócio; `payment_webhook_events` e `payment_sim_ledger` não têm grant nem política. Logs da função só `fn`, `route`, `request_id`, `status`, `ms`.

## Consequências

- O P20 (recorrência) e o P13 (régua de cobrança) cobram pelo mesmo `payment.charge_create` e reagem ao mesmo `payment.recorded.v1`.
- Contratar um PSP e obter credenciais de sandbox é decisão do dono do projeto; até lá só o PSP simulado existe, e o esqueleto `psp` precisa de ajuste ao contrato real antes de qualquer teste com dinheiro.
- Ampliar o check de `payment_entries.source` é uma alteração aditiva de uma migration anterior (nenhum dado muda de sentido); fica registrado aqui como exceção consciente ao "append-only" estrito.

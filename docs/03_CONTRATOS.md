# 03 · Contratos entre módulos

## Regras gerais

Antes de paralelizar, P00 integra contratos v1 e fixtures compartilhadas em `supabase/functions/_shared/contracts`. Cada módulo implementa esses contratos. Mudança incompatível exige proposta pequena ao integrador, consumidores identificados e novo teste. Não “consertar” DTO em três branches de formas diferentes.

Contexto do servidor: `actor_user_id`, `tenant_id` validado contra membership/escopo do cliente, `role`, `request_id`, `channel`. O request pode selecionar um tenant; não concede acesso a ele. O modelo nunca escolhe livremente o tenant executável.

Envelope de sucesso: `{data, meta:{request_id, as_of, schema_version}}`. Erro: `{error:{code,message,field?,retryable},request_id}`. Códigos: 400 `VALIDATION_ERROR`; 401 `AUTH_REQUIRED`; 403 `FORBIDDEN`; 404 `NOT_FOUND` sem revelar objeto privado; 409 `SLOT_CONFLICT`, `STALE_VERSION`, `IDEMPOTENCY_MISMATCH`; 422 `POLICY_REJECTED`; 429 `QUOTA_EXCEEDED`; 503 `PROVIDER_UNAVAILABLE`.

Datas ISO 8601 com offset; moeda ISO; preços inteiros em centavos dentro do intervalo seguro do contrato; UUIDs; paginação por cursor; limites de 50–100 itens definidos por endpoint. Proibir listagens ilimitadas. Esquema Zod ou equivalente deve validar no backend; tipagem TypeScript sozinha não valida JSON externo.

## Operações v1

Nomes abaixo são contratos lógicos. P00 define se o transporte será uma função por módulo com rotas ou RPC invocada pelo backend. Evitar endpoints duplicados para chat e tela.

| Operação | Entrada essencial | Saída / efeito |
|---|---|---|
| `business.create` | nome, profissão, timezone, consentimentos | Tenant, owner e recurso criados atomicamente |
| `customer.upsert` | dados, versão quando existente | Contato privado; dedupe sugerido, nunca merge cego |
| `service.save` | duração, buffers, preço, piso | Catálogo validado e versionado |
| `availability.list` | resource, service, intervalo | Slots sem dados privados de outros clientes |
| `pricing.quote` | service, resource, slot, rule_context | quote_id, base/final, motivo, validade |
| `booking.create` | customer/guest_ref, service, slot, quote_id, idempotency_key | Reserva/hold ou conflito |
| `booking.reschedule` | booking_id, expected_version, novo slot/quote, key | Alteração atômica; preço/política explícitos |
| `booking.cancel` | id, expected_version, motivo, key | Capacidade liberada e evento |
| `booking.complete` | id, expected_version, key | Atendimento concluído; caixa não presumido |
| `pricing.propose_rule` | janela, discount_bps, validade | Proposta/preview de impacto, ainda inativa |
| `pricing.publish_rule` | proposal_id, approval, expected_version, key | Regra ativa e auditada |
| `waitlist.join` | cliente, serviço, faixas aceitas, permissão de contato | Entrada elegível |
| `waitlist.prepare_offer` | entry, slot, quote | Proposta para owner ou oferta sob política aprovada |
| `waitlist.accept_offer` | token opaco, key | Reserva confirmada ou oferta vencida |
| `finance.record_payment` | recebível, valor, método, received_at, key | Pagamento manual marcado como manual |
| `finance.summary` | intervalo, timezone | Entradas, saídas, a receber, cobertura e timestamp |
| `package.consume` | package, booking, evento, key | Crédito debitado uma vez |
| `agent.ask` | texto, contexto de UI opcional | Resposta referenciada ou action_proposal |
| `action.approve` | proposal, hash/version, key | Aprovação do payload; não sucesso de execução |
| `action.execute` | approval_ref, key | Checagem atual de política, execução e recibo |
| `profile.publish` | whitelist dos campos públicos | Perfil público sem vazamento do CRM |
| `referral.create` | kind, dados mínimos, origem | Link pessoal de convite, sem envio automático |

## Exemplo de cotação

```json
{
  "data": {
    "quote_id": "uuid",
    "currency": "BRL",
    "base_price_cents": 10000,
    "final_price_cents": 8500,
    "rule_version": 3,
    "reason_code": "OFF_PEAK_APPROVED",
    "expires_at": "2026-10-20T13:10:00-03:00"
  },
  "meta": {"request_id": "uuid", "as_of": "2026-10-20T13:00:00-03:00", "schema_version": 1}
}
```

IDs ilustrativos devem ser UUIDs válidos nas fixtures executáveis. Uma oferta de preço não segura o horário. Criar hold é comando separado; UI deixa isso claro.

## Idempotência e versões

Escopo da chave: `(tenant, actor, operation, key)`. Guardar hash da entrada normalizada. Repetição com mesmo hash devolve resposta original; payload diferente com mesma chave devolve 409. Inserção do registro, mutação e outbox acontecem na mesma transação. Chaves de integração consideram provedor e evento. Revalidar autorização também na repetição; um resultado antigo não pode ser relido por um ator que perdeu acesso.

`expected_version` impede sobrescrever edição concorrente. A versão participa do hash da proposta. Retry automático é permitido em falha transitória idempotente, não para repetir comandos com resultado externo desconhecido.

## Portas de integração

| Porta | Métodos mínimos | Implementação da semana |
|---|---|---|
| `MessageProvider` | prepare, send, getStatus, parseWebhook | Preview + compartilhamento manual; oficial em sandbox opcional |
| `LLMProvider` | structuredResponse, toolCall, usage | Um provedor configurado; fake só em testes |
| `PaymentProvider` | createCharge, getStatus, parseWebhook | Registro manual; sandbox futuro |
| `FiscalProvider` | validateInput, issue, cancel, getStatus | Desabilitado no piloto |
| `CalendarProvider` | listBusy, upsertEvent, syncCursor | Indisponível na semana; buffer/importação assistida |

`sent`, `paid`, `issued` e `verified` exigem evidência do respectivo sistema. “Abri WhatsApp com texto pronto” é `share_opened`, não `delivered`. Screenshot de Pix não confirma pagamento. “Pedido de emissão” não é nota emitida.

## Fixtures comuns e contrato de integração

Criar tenants sintéticos A/B, owner de cada um, cliente com login que usa ambos, cliente sem login, três serviços, agenda lotada/parcial e pacote pré-pago. Todos os módulos reutilizam IDs e relógio determinístico dessas fixtures. Contratos têm cenários de sucesso, conflito, permissão, expiração e entrada inválida.

Mocks só substituem a porta externa em desenvolvimento/teste. O fluxo interno de agenda, preço e financeiro deve funcionar com banco real em homologação. Flag `DEMO_MODE` tem banner permanente, dados isolados e nunca muda automaticamente para produção.

## Complemento da reconciliação

Contratos P11–P18 devem ser congelados por ADR antes da fase2: QuoteDraft/QuoteVersion/QuoteAcceptance, MessageIntent/DeliveryReceipt, ServiceOrder/DeliverableAcceptance, UsageEntry. Emitir quote.accepted não confirma reserva nem pagamento. Documento fiscal autorizado não marca recebível como pago. Cada evento leva tenant_id, event_id, versão e occurred_at; consumidor deduplica event_id.

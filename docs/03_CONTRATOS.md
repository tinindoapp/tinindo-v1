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
| `onboarding.save` | expected_version, objetivo, antecedência/multa de cancelamento, key | Onboarding versionado; 409 em versão antiga |
| `customer_link.issue` | customer_id, key | Código de uso único (72 h, só o hash no banco); repetição devolve `code: null` |
| `customer_link.redeem` | código, key | Vínculo cliente ↔ login no tenant; devolve só o nome do negócio |
| `customer_link.revoke` | link_id, expected_version, key | Vínculo revogado pelo dono ou pelo cliente |
| `customer.upsert` | dados, versão quando existente | Contato privado; dedupe sugerido, nunca merge cego |
| `service.save` | duração, buffers, preço, piso | Catálogo validado e versionado |
| `customer.archive` | customer_id, expected_version, archived, key | Arquiva/desarquiva; nunca apaga |
| `customer.list` | busca, include_archived, cursor, limit | Clientes do tenant (servido em `GET /crm/customers`) |
| `service.list` | include_inactive, cursor, limit | Serviços do tenant (servido em `GET /crm/services`) |
| `customer.import_preview` | linhas já interpretadas | Possíveis duplicados por linha; não grava |
| `customer.import` | linhas + decisão por duplicado, key | created/skipped/rejected com linha, campo e motivo |
| `availability.list` | resource, service, intervalo | Slots sem dados privados de outros clientes |
| `pricing.quote` | service, resource, slot, rule_context | quote_id, base/final, motivo, validade |
| `booking.create` | customer/guest_ref, service, slot, quote_id, idempotency_key | Reserva/hold ou conflito |
| `booking.reschedule` | booking_id, expected_version, novo slot/quote, key | Alteração atômica; preço/política explícitos |
| `booking.cancel` | id, expected_version, motivo, key | Capacidade liberada e evento |
| `booking.complete` | id, expected_version, key | Atendimento concluído; caixa não presumido |
| `booking.confirm` | booking_id, expected_version, key | Hold vira reserva confirmada se o prazo (no banco) não venceu |
| `booking.no_show` | booking_id, expected_version, motivo, revert, key | Falta marcada ou revertida com motivo |
| `booking.create_series` | serviço, cliente, primeiro slot, semanas (2–12), tudo-ou-nada, key | Ocorrências semanais materializadas; conflitos explícitos |
| `booking.list` | janela (≤ 62 dias), cursor, limit | Reservas do tenant que começam na janela |
| `booking.get` | booking_id | Reserva na visão do dono |
| `schedule.settings` | — | Recurso ativo, timezone e expediente semanal |
| `schedule.rules_save` | resource, expected_version, faixas semanais, key | Expediente trocado inteiro; reservas existentes intactas |
| `schedule.day_plans` | janela (≤ 62 dias) | Por dia local: aberto, pausas e bloqueios |
| `schedule.block_create` | resource, intervalo, rótulo, key | Bloqueio pessoal; 409 se cobre reserva ativa |
| `schedule.block_remove` | block_id, expected_version, key | Bloqueio removido |
| `pricing.propose_rule` | janela, discount_bps, validade | Proposta/preview de impacto, ainda inativa |
| `pricing.approve_rule` | proposal, payload_hash, expected_version, key | Aprovação do dono vinculada a hash/versão, 15 min, uso único |
| `pricing.publish_rule` | proposal_id, approval, expected_version, key | Regra ativa e auditada |
| `pricing.deactivate_rule` | rule_id, expected_version, key | Regra desativada; cotações voltam ao preço base |
| `pricing.list_rules` | — | Regras (ativa primeiro) e propostas abertas |
| `waitlist.join` | cliente, serviço, faixas aceitas, permissão de contato | Entrada elegível |
| `waitlist.prepare_offer` | entry, slot, quote | Proposta para owner ou oferta sob política aprovada |
| `waitlist.accept_offer` | token opaco, key | Reserva confirmada ou oferta vencida |
| `consent.record` | cliente, finalidade, canal, key | Consentimento de contato sobre vaga (declarado pelo dono, auditado) |
| `consent.revoke` | consent_id, key | Revoga; entradas saem da fila e ofertas abertas são invalidadas |
| `waitlist.withdraw` | entry_id, expected_version, key | Sai da lista; oferta aberta invalidada e horário liberado |
| `waitlist.mark_shared` | offer_id, key | Registra que o link foi compartilhado; nunca "entregue" |
| `waitlist.cancel_offer` | offer_id, key | Dono retira a oferta; hold liberado |
| `waitlist.list` | — | Entradas abertas, vagas candidatas na ordem da fila e ofertas recentes |
| `waitlist.offer_view` | token (no corpo) | Leitura da oferta pelo link; não muda estado (anônimo) |
| `waitlist.decline_offer` | token, key | Recusa; hold liberado (anônimo) |
| `finance.record_payment` | recebível, valor, método, received_at, key | Pagamento manual marcado como manual |
| `finance.summary` | intervalo, timezone | Entradas, saídas, a receber, cobertura e timestamp |
| `package.consume` | package, booking, evento, key | Crédito debitado uma vez |
| `finance.create_receivable` | cliente opcional, descrição, valor, vencimento, key | Recebível avulso; não implica recebido |
| `finance.charge_booking` | booking_id, vencimento, key | Recebível pelo preço combinado; um ativo por atendimento; nunca se pago com crédito |
| `finance.cancel_receivable` | receivable_id, expected_version, key | Só sem recebimento registrado |
| `finance.reverse_payment` | payment_id, motivo, key | Estorno vinculado (linha nova); uma vez |
| `finance.record_expense` | valor, data, categoria, descrição, key | Despesa simples, append-only |
| `finance.reverse_expense` | expense_id, key | Estorno da despesa (linha nova) |
| `finance.ledger` | período | Recebíveis abertos/do período, recebimentos e despesas |
| `finance.uncharged` | período | Atendimentos concluídos sem cobrança nem crédito, com evento de conclusão |
| `package.sell` | cliente, serviço, créditos, preço total, validade, key | Pacote + um recebível do total (sem receita repetida) |
| `package.reverse` | entry_id, motivo, key | Devolve 1 crédito, vinculado ao débito; uma vez |
| `package.list` | — | Pacotes com saldo e movimentos |
| `agent.ask` | texto, contexto de UI opcional | Resposta referenciada ou action_proposal |
| `action.approve` | proposal, hash/version, key | Aprovação do payload; não sucesso de execução |
| `action.execute` | approval_ref, key | Checagem atual de política, execução e recibo |
| `profile.publish` | whitelist dos campos públicos | Perfil público sem vazamento do CRM |
| `profile.unpublish` | key | Perfil fora do ar |
| `profile.get` | — | Visão do dono (inclui despublicado e versão) |
| `public.profile` | slug | Perfil publicado, sem tenant_id (anônimo) |
| `public.slots` | slug, service, janela | Horários livres do link público (anônimo) |
| `referral.create` | kind, dados mínimos, origem | Link pessoal de convite, sem envio automático |
| `referral.inspect` | token (no corpo) | Leitura mínima do convite; não muda estado (anônimo) |
| `referral.claim` | token, key | Convite usado uma vez, contato confirmado |
| `referral.list` | — | Convites do próprio usuário (até 50) |
| `quote.create` | cliente, título, itens, validade, horário opcional, observações, key | Rascunho versão 1; total calculado no servidor; hash do snapshot |
| `quote.revise` | quote_id, expected_version, conteúdo, key | Nova versão imutável com novo hash; só rascunho ou enviado |
| `quote.send` | quote_id, expected_version, key | Link do cliente (token só nesta resposta); gerar de novo invalida o anterior |
| `quote.cancel` | quote_id, key | Cancelado; link deixa de existir; aceito não cancela por aqui |
| `quote.list` | status opcional | Orçamentos recentes (até 200) com a versão atual e status efetivo |
| `quote.get` | quote_id | Orçamento, todas as versões e a decisão |
| `quote.view` | token (no corpo) | Versão atual pelo link; não muda estado (anônimo) |
| `quote.accept` | token, versão, hash, key | Aceite da versão vista, dentro da validade; reserva revalidada na mesma transação; não marca pagamento (anônimo) |
| `quote.decline` | token, versão, hash, key | Recusa registrada; uma decisão por orçamento (anônimo) |
| `plan.current` | — | Plano em vigor (versão fixada), uso da franquia e catálogo atual |
| `plan.subscribe` | versão, hash do escopo, key | Troca de plano registrada (cobrança manual); franquia aplicada no servidor |
| `order.request` | versão do serviço, hash do escopo, observação, key | Pedido com escopo aceito, preço e franquia de minutos fixados |
| `order.list` | — | Pedidos com minutos medidos, entregas, concessões e histórico |
| `order.cancel` | order_id, expected_version, key | Cancelado; concessões revogadas |
| `order.review_delivery` | order_id, deliverable_id, decisão, nota, key | Aprova (entregue, acessos revogados) ou pede ajustes (reabre com registro) |
| `access.grant` | order_id, escopos, prazo (≤ 30 dias), justificativa, key | Acesso pessoal do responsável, auditado |
| `access.revoke` | grant_id, key | Acesso encerrado |
| `access.log` | — | Concessões, leituras e ações da equipe Tinindo no negócio |
| `ops.queue` | — | Fila da operação (só operador; sem negócio selecionado; sem CRM) |
| `ops.assign` | order_id, responsável, prazo, key | Responsável definido; troca revoga o acesso do anterior |
| `ops.start` | order_id, key | Execução iniciada; exige concessão ativa |
| `ops.log_work` | order_id, minutos, tipo, retrabalho, nota, key | Minutos medidos; acima da franquia → 429 |
| `ops.deliver` | order_id, título, evidência, key | Entrega versionada para revisão do cliente |
| `ops.block` | order_id, motivo, key | Bloqueado com motivo registrado |
| `ops.snapshot` | order_id | Leitura mínima nos escopos concedidos; cada leitura auditada |
| `analytics.metrics` | período, baseline opcional | Indicadores com numerador, denominador e estado; cobertura; comparação sem causalidade |
| `analytics.baseline_create` | rótulo, período encerrado, key | Baseline com indicadores congelados |
| `analytics.baseline_list` | — | Baselines do negócio (até 20) |
| `analytics.cost_to_serve` | período, custo-hora | Minutos medidos e custo estimado por cliente (só operação; sem negócio selecionado) |
| `channel.status` | — | Conexão do número, fila, desconhecidos e modelos com aprovação por provedor |
| `channel.connect` | provedor, número, id no provedor, key | Número pendente; código de verificação enfileirado pelo próprio canal |
| `channel.verify` | código, key | Ativa a conexão; tentativa errada fica contada (envelope 422) |
| `channel.disconnect` | key | Desconecta; fila pendente vira falha |
| `inbox.list` | — | Contatos com janela, opt-out, não lidas e última mensagem |
| `conversation.get` | contact_id | Mensagens do contato; zera não lidas |
| `message.send` | contato, texto ou modelo + parâmetros, key | Entra na fila (`queued`); enviado só quando o despacho confirmar |
| `conversation.handoff` | contact_id, assistant/human, key | Humano assume ou devolve |
| `contact.link` | contact_id, customer_id, key | Vincula ao cadastro do mesmo negócio |
| `contact.consent` | contact_id, opted_in, key | Opt-in/opt-out declarado pelo dono |
| `sim.phone` | número | Telefone simulado (só conexão simulada) |
| `sim.inbound` | mensagem do cliente ou status, key | Entra pelo MESMO webhook assinado (só simulado) |
| `payment.charges` | — | Cobranças, estornos e contagem de "sem resposta" do negócio |
| `payment.charge_create` | receivable_id, provedor, key | Cobrança pelo saldo em aberto: pendente com Pix e link, falhou com motivo ou `unknown` (sem resposta, consultar) |
| `payment.charge_cancel` | charge_id, versão, key | Cancela pendente/desconhecida; pagamento tardio vira diferença na conciliação |
| `payment.refund` | charge_id, motivo, key | Estorno total; concluído só com confirmação do PSP (reversão no caixa) |
| `payment.reconcile` | provedor, dia, key | Relatório do PSP × caixa; diferenças listadas |
| `payment.reconciliations` | — | Últimas conciliações por dia |
| `payment.link_view` | token (anônimo, no corpo) | Valor, Pix e estado da cobrança |
| `payment.sim_pay` | token, paid/expired, notify | Só cobrança simulada: o "cliente" paga; `notify=false` perde o webhook |
| `lifecycle.settings_get` | — | Réguas do negócio (padrão se nunca salvas) e envios de hoje |
| `lifecycle.settings_save` | campos alterados, versão, key | Liga/desliga réguas, horas dos lembretes, prazos, teto diário |
| `lifecycle.steps` | estado opcional | Passos da régua com estado por palavra e contagens |
| `lifecycle.step_mark_shared` | step_id, key | Passo manual compartilhado pelo dono (compartilhar ≠ entregar) |
| `lifecycle.step_cancel` | step_id, key | Cancela passo pendente |
| `lifecycle.consent_set` | customer_id, finalidade, granted, key | Consentimento transacional/marketing registrado pelo dono; revogar para a régua |
| `lifecycle.audience` | — | Público elegível à reativação agora, com hash |
| `lifecycle.campaign_approve` | audience_hash, max_sends, key | Aprova a campanha citando o público visto e o teto; agenda os passos |
| `lifecycle.campaigns` | — | Campanhas com agendados/enviados/pulados |
| `recurrence.plan_save` | plano (novo ou id + versão), serviço, sessões por ciclo, dias, preço, ativo, key | Plano do profissional; mudar não afeta assinaturas em curso |
| `recurrence.plans` | — | Planos com assinantes ativos |
| `recurrence.subscribe` | plan_id, customer_id, key | Adesão declarada: termos congelados (hash) e primeiro ciclo (pacote + recebível) |
| `recurrence.cancel` | subscription_id, versão, fim do ciclo (padrão) ou agora, motivo, key | Preserva termos e saldo do ciclo corrente |
| `recurrence.resume` | subscription_id, versão, key | Desfaz o cancelamento ao fim do ciclo |
| `recurrence.subscriptions` | — | Assinaturas com o ciclo corrente (saldo e recebível) |
| `recurrence.cycles` | subscription_id | Histórico de ciclos |
| `referrals.dashboard` | — | Regras do programa, convites de colega com adesão (medida) e benefício, resumo da franquia |
| `referrals.rewards` | — | Benefícios concedidos (crédito de franquia por mês) |
| `campaign.preview` | segment | Público autorizado do segmento (consentimento de marketing, sem atendimento futuro, fora de campanha em curso) e hash |
| `campaign.approve` | name, segment, audience_hash, control_pct, max_sends, spend_cap_cents, window_days, offer, key | Aprova citando o público visto; o servidor sorteia o controle, aplica tetos de envio e gasto, cria os passos (P13) e abre a janela |
| `campaign.list` | — | Campanhas com resultado por braço (intervalo) e veredito pelo desenho |
| `campaign.get` | campaign_id | Campanha com participantes por braço e estado do passo |
| `campaign.cancel` | campaign_id, expected_version, key | Para os passos pendentes; o que saiu não muda; resultado congela como observação parcial |

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

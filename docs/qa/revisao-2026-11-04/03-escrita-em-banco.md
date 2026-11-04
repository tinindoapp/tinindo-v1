# 03 · Escrita em banco: gravar de verdade, uma vez só, e falha visível

Revisão de confiabilidade de dados do Tinindo. Repositório `/home/user/tinindo-v1`, `main` b7b58fc. Só leitura: nada foi alterado no repositório.
Evidências e scripts em `scratchpad/a3/`.

Legenda: **[comprovado]** = reproduzido no banco ou visível sem ambiguidade no código, com o cenário descrito; **[suspeita]** = depende de intenção de produto ou de comportamento externo (provedor) que não deu para verificar.

## 1. Resumo

**O lado do banco está sólido.** São 152 comandos em `operations.ts`. Os 125 que passam pelo `rpc-handler` foram conferidos de forma automática:
- todos enviam à RPC exatamente os parâmetros que ela declara, sem faltar nem sobrar (conferido contra `pg_proc` num banco migrado);
- nenhum campo do contrato zod deixa de chegar à RPC (os três "unions" foram vistos à mão);
- em todas as RPCs com `app.idempotency_claim`, a autorização vem **antes** do claim, e todo `return` de sucesso vem logo depois de `app.idempotency_complete`.

As poucas RPCs sem claim/complete têm idempotência própria ou natural e são de propósito:
- `public_booking_request` usa `idem_key` próprio;
- `sales_quote_accept`/`decline` e `public_booking_confirm` devolvem a mesma decisão se repetidas;
- `review_*` e `network_referral_*` são idempotentes por unicidade.

Outbox e auditoria aparecem onde o domínio precisa (agenda, caixa, cobrança, orçamento, site, fiscal). A remarcação emite evento por gatilho (P13). Os testes de banco, de concorrência e de integração passam todos (seção 4).

**O ponto fraco é o front: a chave de idempotência não é estável por intenção em vários fluxos que criam dados.** Três padrões se repetem:
1. **A tela troca a chave quando dá erro** (`setKey(newKey())` dentro do `catch`). Se a resposta se perder (timeout ou queda de rede depois do commit) e a pessoa tocar de novo, sai uma chave nova e o dado é gravado **duas vezes**. Isso acontece em:
   - compra de materiais: estoque em dobro e despesa em dobro no Caixa;
   - envio de mensagem no Canal: o cliente recebe a mensagem duas vezes.
2. **A chave nasce no toque** (`newKey()` em linha) em comandos que criam algo sem unicidade natural: conta a pagar mensal (a série inteira em dobro), plano de recorrência, modelo de mensagem.
3. **O payload que forma a chave inclui `now()`.** No Caixa, "Registrar recebimento" e "Registrar despesa" com data de hoje calculam `received_at`/`paid_at` com `port.now()` a cada toque. Cada nova tentativa vira outra chave, e um recebimento parcial ou uma despesa é gravado duas vezes. A mensagem de erro da tela diz o contrário: *"Tentar de novo é seguro: o pedido usa a mesma chave e não duplica."* A demonstração usa relógio fixo, então lá o problema não aparece (falha de paridade demo×servidor).

Na maioria dos outros comandos, chave nova por toque **não** duplica, porque a RPC barra pela versão (`expected_version` → 409) ou pelo estado (já cancelado/estornado → 422). O custo é outro: a pessoa vê erro depois de um sucesso real. A mensagem genérica "Tentar de novo é seguro", repetida em 15 arquivos `labels.ts`, só é verdadeira onde a chave é estável.

Outros achados:
- **[comprovado]** `channel_verify` grava a resposta de idempotência como `NULL` no caminho "código errado". Repetir com a mesma chave dá 500 em vez de 422.
- O `AdjustForm` de materiais não desliga o botão durante o envio.
- Reserva de equipe (P28) não emite evento de outbox [suspeita de lacuna de integração].
- O `link_token` da cobrança fica em texto puro na tabela de idempotência.

Não encontrei atualização otimista que mostre "salvo" antes da resposta nos fluxos amostrados (Agenda, Caixa, Clientes, Materiais, Canal, Recorrência, Contas, Link público): o aviso de sucesso sempre vem depois do `await`.

## 2. Tabela por operação

Como ler as colunas:
- **Chave no front**:
  - "OK (conteúdo)" = mesma chave enquanto o payload não muda, renovada depois do sucesso;
  - "OK (por tela/intenção)" = chave fixa enquanto a tela está montada, ou trocada só por decisão nova;
  - "nova por toque" = `newKey()` no clique (só é segura se a RPC barra a repetição por versão ou estado);
  - "✗" = duplica em nova tentativa (ver achados).
- **Idempotência na RPC**: "claim/complete" = `app.idempotency_claim`/`complete`; "própria" = chave ou estado próprios; "natural" = repetir devolve o mesmo resultado ou é barrado por unicidade. Todas rodam numa única transação (chamada PostgREST).
- **Tenant**: "?" = rota pública por token (sem negócio no cabeçalho); a autorização vem do token ou do login.
- **Erro na tela**: só os fluxos que abri ("ok (amostra)" = mostra a mensagem do catálogo perto da ação ou em Toast, inclusive sem rede via `PROVIDER_UNAVAILABLE`); "não verificado" = não abri a tela.
- **Testes**: prefixo numérico dos arquivos em `supabase/tests/database`, `tests/db-concurrency` e `tests/integration` que citam a RPC ou a operação.
- O arquivo:linha é a **última** definição da RPC nas migrations.

| Operação | Tela | RPC (arquivo:linha) | Chave no front | Idempotência na RPC | Tenant | Versão | Outbox | Audit | Erro na tela | Demo×servidor | Testes (db / conc / integ) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `business.create` | Conta/Negócio | `business_create` 20261018120000_p01_identity_onboarding:101 | OK (conteúdo) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 01 / 01 / 46 |
| `onboarding.save` | Conta/Negócio | `onboarding_save` 20261018120000_p01_identity_onboarding:198 | OK (conteúdo) | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 01 / — / 00,46 |
| `customer_link.issue` | Conta/Negócio | `customer_link_issue` 20261018120200_p01_customer_links:87 | sem tela | claim/complete | ok | — | — | ok | — | — | 03 / 01 / 13 |
| `customer_link.redeem` | Conta/Negócio | `customer_link_redeem` 20261018120200_p01_customer_links:151 | OK (conteúdo) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 03 / 01 / 13 |
| `customer_link.revoke` | Conta/Negócio | `customer_link_revoke` 20261018120200_p01_customer_links:234 | OK (conteúdo) | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 03 / — / — |
| `customer.upsert` | Clientes/Serviços | `crm_customer_upsert` 20261018120100_p02_crm:178 | OK (conteúdo) | claim/complete | ok | ok | — | ok | ok (amostra) | ≠ (demo só leitura) | 02 / — / 00 |
| `service.save` | Clientes/Serviços | `crm_service_save` 20261018120100_p02_crm:393 | OK (conteúdo) | claim/complete | ok | ok | — | ok | ok (amostra) | ≠ (demo só leitura) | 02 / — / 00,10,11 |
| `customer.archive` | Clientes/Serviços | `crm_customer_archive` 20261018120100_p02_crm:254 | OK (conteúdo) | claim/complete | ok | ok | — | ok | ok (amostra) | ≠ (demo só leitura) | 02 / — / — |
| `customer.import` | Clientes/Serviços | `crm_customer_import` 20261018120100_p02_crm:518 | OK (conteúdo) | claim/complete | ok | — | — | ok | ok (amostra) | ≠ (demo só leitura) | 02 / — / 10 |
| `booking.create` | Agenda | `scheduling_booking_create` 20261018130000_p03_scheduling:443 | OK (conteúdo) | claim/complete | ok | — | — | — | ok (amostra) | ok (emula chave) | 04,06,07,08,10,15,26,30 / 03,07,08,15,25,28 / 00,10,11,12,13,20,32,35,42,45 |
| `booking.reschedule` | Agenda | `scheduling_booking_reschedule` 20261018150000_p05_pricing:698 | OK (conteúdo) | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 04,06,15 / 03 / 11,32 |
| `booking.cancel` | Agenda | `scheduling_booking_cancel` 20261018130000_p03_scheduling:660 | OK (por tela/intenção) | claim/complete | ok | ok | ok | ok | ok (amostra) | ok (emula chave) | 04,07,15,30 / 03,07 / 10,12,32,45 |
| `booking.complete` | Agenda | `scheduling_booking_complete` 20261018130000_p03_scheduling:707 | OK (por tela/intenção) | claim/complete | ok | ok | ok | ok | ok (amostra) | ok (emula chave) | 04,05 / 05 / 10,12 |
| `booking.confirm` | Agenda | `scheduling_booking_confirm` 20261018150000_p05_pricing:651 | OK (por tela/intenção) | claim/complete | ok | ok | ok | ok | ok (amostra) | ok (emula chave) | 04,06 / — / — |
| `booking.no_show` | Agenda | `scheduling_booking_no_show` 20261018130000_p03_scheduling:751 | OK (por tela/intenção) | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 04 / — / — |
| `booking.create_series` | Agenda | `scheduling_booking_create_series` 20261018130000_p03_scheduling:482 | sem tela | claim/complete | ok | — | — | — | — | — | 04 / — / 12 |
| `schedule.rules_save` | Agenda | `scheduling_rules_save` 20261018130000_p03_scheduling:896 | OK (conteúdo) | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 04,06,07,08,10,25,31 / 03,07,08,10,24 / 10,11,12,13,20,32,46 |
| `schedule.block_create` | Agenda | `scheduling_block_create` 20261018130000_p03_scheduling:972 | OK (conteúdo); Desfazer: nova | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 04,26 / — / — |
| `schedule.block_remove` | Agenda | `scheduling_block_remove` 20261018130000_p03_scheduling:1023 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 04 / — / — |
| `pricing.propose_rule` | Preços | `pricing_propose_rule` 20261018150000_p05_pricing:294 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 06 / 06 / 10,47 |
| `pricing.approve_rule` | Preços | `pricing_approve_rule` 20261018150000_p05_pricing:388 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 06 / 06 / 10 |
| `pricing.publish_rule` | Preços | `pricing_publish_rule` 20261018150000_p05_pricing:432 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 06 / 06 / 10 |
| `pricing.deactivate_rule` | Preços | `pricing_deactivate_rule` 20261018150000_p05_pricing:506 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 06 / — / — |
| `waitlist.join` | Lista de espera | `waitlist_join` 20261018160000_p06_waitlist_jobs:280 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 07 / 07 / 10 |
| `waitlist.prepare_offer` | Lista de espera | `waitlist_prepare_offer` 20261018160000_p06_waitlist_jobs:378 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 07 / 07 / 10 |
| `waitlist.accept_offer` | Lista de espera | `waitlist_accept_offer` 20261018160000_p06_waitlist_jobs:550 | não verificado | própria | ? | — | ok | ok | não verificado | ok (emula chave) | 07 / 07 / 10 |
| `consent.record` | Lista de espera | `consent_record` 20261018160000_p06_waitlist_jobs:214 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 07 / 07 / 10 |
| `consent.revoke` | Lista de espera | `consent_revoke` 20261018160000_p06_waitlist_jobs:245 | sem tela | claim/complete | ok | — | — | ok | — | — | 07 / — / — |
| `waitlist.withdraw` | Lista de espera | `waitlist_withdraw` 20261018160000_p06_waitlist_jobs:337 | não verificado | claim/complete | ok | ok | — | ok | não verificado | ok (emula chave) | — / — / — |
| `waitlist.mark_shared` | Lista de espera | `waitlist_mark_shared` 20261018160000_p06_waitlist_jobs:446 | não verificado | claim/complete | ok | — | — | — | não verificado | ok (emula chave) | 07 / — / — |
| `waitlist.cancel_offer` | Lista de espera | `waitlist_cancel_offer` 20261018160000_p06_waitlist_jobs:472 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | — / — / — |
| `waitlist.decline_offer` | Lista de espera | `waitlist_decline_offer` 20261018160000_p06_waitlist_jobs:587 | não verificado | natural | ? | — | — | ok | não verificado | ok (emula chave) | 07 / — / — |
| `finance.record_payment` | Caixa | `finance_record_payment` 20261018140000_p07_finance:363 | ✗ payload com now() | claim/complete | ok | — | ok | ok | ⚠ diz "tentar de novo é seguro" | ✗ (demo: relógio fixo) | 05,12,15 / 05 / 10,12,32,42,44 |
| `package.consume` | Caixa | `package_consume` 20261018140000_p07_finance:621 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 05,16 / 05 / 12 |
| `finance.create_receivable` | Caixa | `finance_receivable_create` 20261018140000_p07_finance:225 | OK (conteúdo) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 05,14,15 / 05,14 / 00,31,32,44 |
| `finance.charge_booking` | Caixa | `finance_charge_booking` 20261018140000_p07_finance:268 | OK (conteúdo) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 05,12 / — / 10,12 |
| `finance.cancel_receivable` | Caixa | `finance_receivable_cancel` 20261018140000_p07_finance:320 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 05,14 / — / — |
| `finance.reverse_payment` | Caixa | `finance_reverse_payment` 20261018140000_p07_finance:422 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 05 / 05 / — |
| `finance.record_expense` | Caixa | `finance_record_expense` 20261018140000_p07_finance:478 | ✗ payload com now() | claim/complete | ok | — | — | ok | ⚠ diz "tentar de novo é seguro" | ✗ (demo: relógio fixo) | 05,12 / — / — |
| `finance.reverse_expense` | Caixa | `finance_reverse_expense` 20261018140000_p07_finance:514 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 05 / — / — |
| `package.sell` | Caixa | `package_sell` 20261018140000_p07_finance:558 | OK (conteúdo) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 05 / 05 / 12 |
| `package.reverse` | Caixa | `package_reverse` 20261018140000_p07_finance:705 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 05 / — / — |
| `action.approve` | Assistente | `action_approve` 20261018170000_p08_agent:451 | OK (por tela/intenção) | claim/complete | ok | ok | ok | ok | ok (amostra) | ok (emula chave) | 08 / 08 / 20 |
| `action.execute` | Assistente | `action_execute` 20261018170000_p08_agent:510 | OK (por tela/intenção) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 08 / 08 / 20 |
| `profile.publish` | Perfil/Link público | `network_profile_publish` 20261018120300_p09_network:155 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 09,28 / — / 10,46 |
| `profile.unpublish` | Perfil/Link público | `network_profile_unpublish` 20261018120300_p09_network:213 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 09 / — / — |
| `profile.media` | Perfil/Link público | `network_profile_media_set` 20261029034000_p09_profile_photo:129 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 28 / — / — |
| `public.book` | Perfil/Link público | `public_booking_request` 20261029033000_p43_replace_pending_request:38 | OK (por tela/intenção) | própria | ok | — | ok | ok | ok (amostra) | ok (emula chave) | 25 / 24 / 00,10,12,13,20,34,40,41,43,47 |
| `public.confirm` | Perfil/Link público | `public_booking_confirm` 20261026164500_p43_public_booking:217 | nova por toque | natural | ? | — | ok | ok | ok (amostra) | ok (emula chave) | 25 / 24 / 41 |
| `referral.create` | Perfil/Link público | `network_referral_create` 20261018120300_p09_network:288 | OK (por tela/intenção) | própria | ok | — | — | ok | ok (amostra) | ok (emula chave) | 09,17 / — / 34 |
| `referral.claim` | Perfil/Link público | `network_referral_claim` 20261018120300_p09_network:388 | OK (por tela/intenção) | natural | ok | — | — | ok | ok (amostra) | ok (emula chave) | 09,17 / — / 34 |
| `quote.create` | Orçamentos | `sales_quote_create` 20261018180000_p11_sales:275 | OK (por tela/intenção) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 10,15 / 10 / 00,20,32,43 |
| `quote.revise` | Orçamentos | `sales_quote_revise` 20261018180000_p11_sales:314 | OK (por tela/intenção) | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 10 / 10 / 20 |
| `quote.send` | Orçamentos | `sales_quote_send` 20261018180000_p11_sales:363 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 10,15 / 10 / 20,32 |
| `quote.cancel` | Orçamentos | `sales_quote_cancel` 20261018180000_p11_sales:412 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 10 / — / — |
| `quote.accept` | Orçamentos | `sales_quote_accept` 20261018180000_p11_sales:511 | OK (por tela/intenção) | própria | ? | — | ok | ok | ok (amostra) | ok (emula chave) | 10,15 / 10 / 20,32 |
| `quote.decline` | Orçamentos | `sales_quote_decline` 20261018180000_p11_sales:573 | OK (por tela/intenção) | natural | ? | — | ok | ok | ok (amostra) | ok (emula chave) | 10 / — / — |
| `plan.subscribe` | Serviços Tinindo | `service_plan_subscribe` 20261018190000_p15_service_ops:413 | ✗ troca no erro | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 11 / 11 / 20 |
| `order.request` | Serviços Tinindo | `service_order_request` 20261018190000_p15_service_ops:468 | ✗ troca no erro | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 11 / 11 / 20 |
| `order.cancel` | Serviços Tinindo | `service_order_cancel` 20261018190000_p15_service_ops:532 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 11 / — / — |
| `order.review_delivery` | Serviços Tinindo | `service_delivery_review` 20261018190000_p15_service_ops:566 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 11 / — / — |
| `access.grant` | Serviços Tinindo | `service_access_grant` 20261018190000_p15_service_ops:610 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 11 / 11 / 20 |
| `access.revoke` | Serviços Tinindo | `service_access_revoke` 20261018190000_p15_service_ops:654 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 11 / — / — |
| `ops.assign` | Serviços Tinindo | `service_ops_assign` 20261018190000_p15_service_ops:721 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 11 / 11 / 20 |
| `ops.start` | Serviços Tinindo | `service_ops_start` 20261018190000_p15_service_ops:767 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 11 / 11 / 20 |
| `ops.log_work` | Serviços Tinindo | `service_ops_log_work` 20261018190000_p15_service_ops:802 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 11 / 11 / 20 |
| `ops.deliver` | Serviços Tinindo | `service_ops_deliver` 20261018190000_p15_service_ops:850 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 11 / — / — |
| `ops.block` | Serviços Tinindo | `service_ops_block` 20261018190000_p15_service_ops:893 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | — / — / — |
| `analytics.baseline_create` | Resultados | `analytics_baseline_create` 20261018200000_p18_analytics:228 | OK (troca só no sucesso) | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 12 / 12 / 20 |
| `channel.connect` | Canal | `channel_connect` 20261022120000_p12_messaging:261 | ✗ troca no erro | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 13 / 13 / 30,32 |
| `channel.verify` | Canal | `channel_verify` 20261022120000_p12_messaging:308 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 13 / 13 / 30,32 |
| `channel.disconnect` | Canal | `channel_disconnect` 20261022120000_p12_messaging:349 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 13 / 13 / 30 |
| `message.send` | Canal | `channel_send` 20261022120000_p12_messaging:423 | ✗ troca no erro | claim/complete | ok | — | — | ok | ⚠ diz "tentar de novo é seguro" | ok (emula chave) | 13 / 13 / 30 |
| `conversation.handoff` | Canal | `channel_handoff` 20261022120000_p12_messaging:486 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 13 / — / 30 |
| `contact.link` | Canal | `channel_contact_link` 20261022120000_p12_messaging:517 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 13 / — / 30 |
| `contact.consent` | Canal | `channel_contact_consent` 20261022120000_p12_messaging:552 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 13 / — / 30 |
| `sim.inbound` | Canal | `channel_sim_inbound` ? | sem tela | ? | ? | ? | ? | ? | — | — | — / — / 30,32 |
| `payment.charge_create` | Cobranças | `payment_charge_create` 20261022130000_p14_payments:259 | ✗ troca no erro | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 14 / 14 / 31,33,44 |
| `payment.charge_cancel` | Cobranças | `payment_charge_cancel` 20261022130000_p14_payments:304 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 14 / — / 31 |
| `payment.refund` | Cobranças | `payment_refund_request` 20261022130000_p14_payments:352 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 14 / 14 / 31 |
| `payment.reconcile` | Cobranças | `payment_reconcile` 20261022130000_p14_payments:407 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 14 / — / 31 |
| `payment.sim_pay` | Cobranças | `payment_sim_create` 20261022130000_p14_payments:672 | sem tela | natural | ? | — | — | — | — | — | — / — / 31,33,44 |
| `lifecycle.settings_save` | Relacionamento | `lifecycle_settings_save` 20261022140000_p13_lifecycle:507 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 15 / — / 32 |
| `lifecycle.step_mark_shared` | Relacionamento | `lifecycle_step_mark_shared` 20261022140000_p13_lifecycle:573 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 15 / — / 32 |
| `lifecycle.step_cancel` | Relacionamento | `lifecycle_step_cancel` 20261022140000_p13_lifecycle:603 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | — / — / — |
| `lifecycle.consent_set` | Relacionamento | `lifecycle_consent_set` 20261022140000_p13_lifecycle:635 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 15 / — / 32 |
| `lifecycle.campaign_approve` | Relacionamento | `lifecycle_campaign_approve` 20261022140000_p13_lifecycle:720 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 15 / 15 / 32 |
| `recurrence.plan_save` | Recorrência | `recurrence_plan_save` 20261022150000_p20_recurrence:233 | ✗ nova por toque (cria) | claim/complete | ok | ok | — | ok | ⚠ diz "tentar de novo é seguro" | ok (emula chave) | 16 / 16 / 33 |
| `recurrence.subscribe` | Recorrência | `recurrence_subscribe` 20261022150000_p20_recurrence:300 | ✗ troca no erro | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 16 / 16 / 33 |
| `recurrence.cancel` | Recorrência | `recurrence_cancel` 20261022150000_p20_recurrence:354 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 16 / — / 33 |
| `recurrence.resume` | Recorrência | `recurrence_resume` 20261022150000_p20_recurrence:398 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 16 / — / 33 |
| `campaign.approve` | Campanhas | `campaign_approve` 20261022170000_p19_campaigns:353 | ✗ troca no erro | claim/complete | ok | — | ok | ok | ok (amostra) | ok (emula chave) | 18 / 18 / 35 |
| `campaign.cancel` | Campanhas | `campaign_cancel` 20261022170000_p19_campaigns:481 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 18 / — / 35 |
| `goal.save` | Metas/Insights | `goal_save` 20261022180000_p22_growth_advice:274 | não verificado | claim/complete | ok | ok | — | ok | não verificado | ok (emula chave) | 19 / 19 / 36 |
| `goal.archive` | Metas/Insights | `goal_archive` 20261022180000_p22_growth_advice:339 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | — / — / 36 |
| `advice.decide` | Metas/Insights | `advice_decide` 20261022180000_p22_growth_advice:394 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 19 / — / 36 |
| `content.publish` | Metas/Insights | `content_publish` 20261022180000_p22_growth_advice:458 | nova por toque | claim/complete | ok | — | ok | ok | ok (amostra) | ok (emula chave) | 19 / 19 / 36 |
| `content.unpublish` | Metas/Insights | `content_unpublish` 20261022180000_p22_growth_advice:499 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 19 / — / 36 |
| `insight.snooze` | Metas/Insights | `insight_snooze` 20261103150000_p45_insights:869 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 32 / — / 47 |
| `insight.act` | Metas/Insights | `insight_act` 20261103150000_p45_insights:910 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 32 / 30 / 47 |
| `site.save` | Site | `presence_site_save` 20261024141000_fix_first_save_race:6 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 20 / 22 / 37 |
| `site.publish` | Site | `presence_site_publish` 20261024120000_p17_presence:341 | nova por toque | claim/complete | ok | — | ok | ok | ok (amostra) | ok (emula chave) | 20 / 20 / 37 |
| `site.unpublish` | Site | `presence_site_unpublish` 20261024120000_p17_presence:390 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 20 / — / 37 |
| `site.restore` | Site | `presence_site_restore` 20261024120000_p17_presence:420 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 20 / — / 37 |
| `domain.add` | Site | `presence_domain_add` 20261024120000_p17_presence:462 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 20 / 20 / 37 |
| `domain.remove` | Site | `presence_domain_remove` 20261024120000_p17_presence:501 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 20 / — / — |
| `google.set` | Site | `presence_google_set` 20261024120000_p17_presence:596 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 20 / — / 37 |
| `ops.presence_delivery` | Site | `presence_delivery_record` 20261024120000_p17_presence:652 | sem tela | claim/complete | ok | — | — | ok | — | — | 20 / — / 37 |
| `fiscal.profile_save` | Notas | `fiscal_profile_save` 20261024141000_fix_first_save_race:60 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 21 / 22 / 38 |
| `fiscal.representation` | Notas | `fiscal_representation_set` 20261024130000_p16_fiscal:322 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 21 / — / 38 |
| `fiscal.emit` | Notas | `fiscal_emit` 20261024130000_p16_fiscal:394 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 21 / 21 / 38 |
| `fiscal.cancel` | Notas | `fiscal_cancel` 20261024130000_p16_fiscal:498 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 21 / — / 38 |
| `discovery.save` | Diretório | `discovery_save` 20261024140000_p23_discovery:115 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 22 / 22 / 39 |
| `review.submit` | Avaliações | `review_submit` 20261024150000_p24_reputation:151 | nova por toque | própria | ok | — | ok | ok | ok (amostra) | ok (emula chave) | 23 / 23 / 40 |
| `review.withdraw` | Avaliações | `review_withdraw` 20261024150000_p24_reputation:192 | nova por toque | natural | ok | — | — | ok | ok (amostra) | ok (emula chave) | 23 / — / — |
| `review.report` | Avaliações | `review_report` 20261024150000_p24_reputation:207 | nova por toque | natural | ok | — | — | — | ok (amostra) | ok (emula chave) | 23 / — / 40 |
| `review.reply` | Avaliações | `review_reply` 20261024150000_p24_reputation:246 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 23 / — / 40 |
| `resources.save` | Equipe | `resources_save` 20261027220500_p28_team_resources:417 | não verificado | claim/complete | ok | ok | — | ok | não verificado | ok (emula chave) | 26 / 25 / 42 |
| `resources.commission_rule_save` | Equipe | `resources_commission_rule_save` 20261027220500_p28_team_resources:486 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 26 / — / 42 |
| `resources.booking_create` | Equipe | `resources_booking_create` 20261027220500_p28_team_resources:593 | ✗ troca no erro | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 26 / 25 / 42 |
| `resources.booking_cancel` | Equipe | `resources_booking_cancel` 20261027220500_p28_team_resources:649 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 26 / — / — |
| `resources.booking_complete` | Equipe | `resources_booking_complete` 20261027220500_p28_team_resources:687 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 26 / 25 / 42 |
| `resources.class_create` | Equipe | `resources_class_create` 20261027220500_p28_team_resources:751 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 26 / 25 / 42 |
| `resources.class_enroll` | Equipe | `resources_class_enroll` 20261027220500_p28_team_resources:813 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 26 / 25 / 42 |
| `resources.class_seat_cancel` | Equipe | `resources_class_seat_cancel` 20261027220500_p28_team_resources:857 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 26 / — / — |
| `resources.class_cancel` | Equipe | `resources_class_cancel` 20261027220500_p28_team_resources:898 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | — / — / — |
| `resources.class_complete` | Equipe | `resources_class_complete` 20261027220500_p28_team_resources:936 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 26 / — / 42 |
| `resources.commission_reverse` | Equipe | `resources_commission_reverse` 20261027220500_p28_team_resources:1011 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 26 / — / 42 |
| `materials.item_save` | Materiais | `materials_item_save` 20261027223200_p30_materials:221 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 27 / 26 / 43 |
| `materials.usage_save` | Materiais | `materials_usage_save` 20261027223200_p30_materials:277 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 27 / 26 / 43 |
| `materials.purchase` | Materiais | `materials_purchase` 20261027223200_p30_materials:336 | ✗ troca no erro | claim/complete | ok | — | — | ok | ⚠ diz "tentar de novo é seguro" | ok (emula chave) | 27 / 26 / 43 |
| `materials.purchase_reverse` | Materiais | `materials_purchase_reverse` 20261027223200_p30_materials:402 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 27 / — / 43 |
| `materials.adjust` | Materiais | `materials_adjust` 20261027223200_p30_materials:455 | nova por toque | claim/complete | ok | ok | — | ok | ⚠ diz "tentar de novo é seguro" | ok (emula chave) | 27 / — / — |
| `materials.consume` | Materiais | `materials_consume` 20261027223200_p30_materials:512 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 27 / 26 / 43 |
| `materials.consume_reverse` | Materiais | `materials_consume_reverse` 20261027223200_p30_materials:586 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 27 / 26 / 43 |
| `accounts.category_save` | Contas | `accounts_category_save` 20261103011000_p31_finance_advanced:254 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 29 / — / 44 |
| `accounts.classify` | Contas | `accounts_classify` 20261103011000_p31_finance_advanced:310 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 29 / — / 44 |
| `accounts.payable_save` | Contas | `accounts_payable_save` 20261103011000_p31_finance_advanced:418 | ✗ nova por toque (cria) | claim/complete | ok | ok | — | ok | ⚠ diz "tentar de novo é seguro" | ok (emula chave) | 29 / 27 / 44 |
| `accounts.payable_pay` | Contas | `accounts_payable_pay` 20261103011000_p31_finance_advanced:499 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 29 / 27 / 44 |
| `accounts.payable_reverse` | Contas | `accounts_payable_reverse` 20261103011000_p31_finance_advanced:557 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 29 / 27 / 44 |
| `accounts.payable_cancel` | Contas | `accounts_payable_cancel` 20261103011000_p31_finance_advanced:606 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 29 / 27 / — |
| `accounts.series_update` | Contas | `accounts_series_update` 20261103011000_p31_finance_advanced:642 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 29 / 27 / 44 |
| `accounts.reconcile_save` | Contas | `accounts_reconcile_save` 20261103011000_p31_finance_advanced:738 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 29 / — / 44 |
| `field.settings_save` | Domicílio | `field_settings_save` 20261103030000_p29_field_service:264 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 30 / 28 / 45 |
| `field.zone_save` | Domicílio | `field_zone_save` 20261103030000_p29_field_service:305 | nova por toque | claim/complete | ok | ok | — | ok | ok (amostra) | ok (emula chave) | 30 / 28 / 45 |
| `field.travel_save` | Domicílio | `field_travel_save` 20261103030000_p29_field_service:364 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 30 / — / 45 |
| `field.visit_attach` | Domicílio | `field_visit_attach` 20261103030000_p29_field_service:430 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 30 / 28 / 45 |
| `field.visit_detach` | Domicílio | `field_visit_detach` 20261103030000_p29_field_service:489 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 30 / — / 45 |
| `field.route_rebuild` | Domicílio | `field_route_rebuild` 20261103030000_p29_field_service:523 | nova por toque | claim/complete | ok | — | — | ok | ok (amostra) | ok (emula chave) | 30 / 28 / 45 |
| `setup.dismiss` | Configuração | `setup_dismiss` 20261103134122_p44_setup:242 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 31 / 29 / 46 |
| `setup.services_apply` | Configuração | `setup_services_apply` 20261103134122_p44_setup:344 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 31 / 29 / 46 |
| `setup.draft_apply` | Configuração | `setup_draft_apply` 20261103134122_p44_setup:374 | não verificado | claim/complete | ok | — | — | ok | não verificado | ok (emula chave) | 31 / — / 46 |

## 3. Achados

Ordem: impacto primeiro.

### A1 · Compra de materiais duplica estoque e despesa em nova tentativa · **alto** · [comprovado]
- **Onde:** `src/features/materials/MaterialsPage.tsx:85` (chave em estado), `:107-108` (troca no sucesso) e **`:110-111` (troca no erro)**; mensagem em `src/features/materials/labels.ts:38` ("Tentar de novo é seguro").
- **Cenário:** a dona registra uma compra de 3 itens (R$ 240) com "Lançar como despesa" marcado. O `materials_purchase` faz commit, mas a resposta se perde (rede do celular caiu, timeout do proxy). O cliente recebe `PROVIDER_UNAVAILABLE`, o `catch` gera chave nova e a tela diz que tentar de novo é seguro. No segundo toque, o servidor não reconhece a chave e grava **outra compra**: estoque somado duas vezes e **duas despesas de materiais** no Caixa.
- **Correção:** manter a chave depois do erro (trocar só no sucesso ou quando o payload muda, como o `createKeyRing` do CRM).

### A2 · Mensagem do Canal sai duas vezes para o cliente · **alto** · [comprovado]
- **Onde:** `src/features/messaging/InboxPage.tsx:88/100-106` (texto livre: chave trocada no `catch`, e o texto continua no campo) e `:165` (modelo: `newKey()` a cada toque).
- **Cenário:** "Responder" com timeout depois do commit. `channel_send` já pôs a mensagem na fila de despacho. A pessoa toca "Enviar" de novo, o texto ainda está lá e a chave é nova, então `channel_send` enfileira **outra** mensagem. Não há deduplicação natural: o índice único é só por `provider_message_id` ou `external_event_id`. O cliente recebe o mesmo WhatsApp duas vezes, e com modelo isso custa uma conversa paga no provedor.
- **Correção:** chave por conteúdo, mantida no erro e renovada só depois de sucesso (vale também para o envio de modelo).

### A3 · Caixa: recebimento e despesa "de hoje" geram chave nova a cada toque · **alto** · [comprovado]
- **Onde:** `src/features/finance/FinancePage.tsx:454`, com `received_at = port.now().toISOString()` calculado dentro do `submit`, e a chave tirada desse payload em `:459`. O mesmo em `:619` (`paid_at`) e `:624`. A mensagem que promete o contrário está em `:76`.
- **Cenário:**
  - **Recebimento parcial:** R$ 50 de R$ 120 recebidos hoje por Pix. A resposta se perde, a tela mostra "Sem resposta do servidor. Tentar de novo é seguro: o pedido usa a mesma chave e não duplica.". No novo toque, `received_at` muda em milissegundos, o hash muda, a chave é nova e `finance_record_payment` grava **outro** recebimento de R$ 50: saldo errado (R$ 100 recebidos). A trava de saldo só barra quando a soma passa do total.
  - **Despesa:** não tem trava nenhuma e duplica sempre.
- **Paridade:** na demonstração não acontece, porque `src/features/finance/demoPort.ts:96` usa `FIXED_NOW`. O teste `src/features/finance/useKeyFor.test.tsx:9` também usa um payload sem `received_at`.
- **Correção:** fixar o horário quando o formulário abre, como já faz `FinancePage.tsx:334` (`useState(() => port.now()...)`), ou tirar o timestamp da assinatura da chave.

### A4 · Conta a pagar mensal: nova tentativa cria a série inteira de novo · **médio** · [comprovado]
- **Onde:** `src/features/finance-advanced/AccountsPage.tsx:40-41`, com `newKey()` na chamada de `savePayable`. No servidor, `accounts_payable_save` (`20261103011000_p31_finance_advanced.sql:418`) cria uma série nova a cada chamada. O índice `fin_payables_one_per_month` vale só **dentro** da série.
- **Cenário:** "Aluguel R$ 1.500 todo mês" com timeout depois do commit. Novo toque cria uma segunda série de contas mensais, e o fluxo de caixa projetado dobra o aluguel.
- **Correção:** chave por conteúdo (padrão `useKeyFor`/`createKeyRing`), mantida no erro.

### A5 · Plano de recorrência novo duplica em nova tentativa · **médio** · [comprovado]
- **Onde:** `src/features/recurrence/RecurrencePage.tsx:39`, com `newKey()` em `savePlan` e `plan_id: null`. A tabela `recurrence_plans` não tem nome único (`20261022150000_p20_recurrence.sql`). A mensagem em `src/features/recurrence/labels.ts:30` diz que tentar de novo é seguro.
- **Cenário:** timeout ao criar o plano "Mensal 4 sessões". O novo toque cria dois planos iguais, e a cliente pode ser assinada no plano errado.
- **Correção:** chave por conteúdo, mantida no erro.

### A6 · `channel_verify` grava resposta NULL e repetir com a mesma chave dá 500 · **médio** · [comprovado: reproduzido no Postgres]
- **Onde:** `supabase/migrations/20261022120000_p12_messaging.sql:338` chama `app.idempotency_complete(..., 422, null)`. Com isso, `app.idempotency_claim` (`20261017120000_foundation.sql:220`) cai em "registro sem resposta" e levanta PT500.
- **Reprodução:** `a3/repro-channel-verify.log`. O primeiro envio devolve `{"status_code":422,"error":"POLICY_REJECTED"}`. Repetir com a mesma chave dá `ERROR: INTERNAL_ERROR / registro de idempotência sem resposta`, e o registro fica com `status_code=422, response NULL`.
- **Impacto hoje:** a tela usa chave nova por código (`InboxPage.tsx:63`), então só aparece em retry de rede automático ou repetição com a mesma chave. Mesmo assim viola o contrato: deveria devolver 422 de novo. É a mesma classe de bug que derrubaria qualquer RPC futura que copie o padrão.
- **Correção:** gravar a resposta do erro (`jsonb_build_object('error','POLICY_REJECTED','field','code')`) e fazer o claim devolver `{status_code, error, field}` em repetição.

### A7 · Repetição de comando barrado por versão ou estado mostra erro depois de um sucesso real · **médio** · [comprovado por leitura]
- **Onde:** cerca de 80 chamadas com `newKey()` no toque (lista em `a3/table.md`, coluna "nova por toque"). Exemplos:
  - `materials.adjust`: `MaterialsPage.tsx:64`, e o botão em `:74` **não** tem `loading`, então dois toques enviam duas requisições;
  - `presence.site.save`: `PresencePage.tsx:39`;
  - `finance.reverse_payment`: `FinancePage.tsx:557`;
  - `accounts.payable_pay`: `AccountsPage.tsx:72`, que também usa `new Date()` no payload.
- **Cenário:** timeout depois do commit, e a pessoa toca de novo. A RPC devolve `STALE_VERSION` (409) ou `POLICY_REJECTED` (422, "já estornado"). Não há duplicação, mas a tela diz que **não** deu certo e manda conferir, quando deu. No `AdjustForm`, o segundo `onDone("danger")` sobrescreve o aviso de sucesso do primeiro.
- **Correção:** usar a chave por conteúdo em toda a base (um hook só, compartilhado), pôr `loading` no botão de ajuste e trocar o texto genérico "Tentar de novo é seguro" dos 15 `labels.ts` por algo que só prometa isso onde a chave é estável.

### A8 · Reserva de equipe (P28) não emite evento de outbox · **médio** · [suspeita de lacuna]
- **Onde:** `resources_booking_create`/`_cancel`/`_complete` (`20261027220500_p28_team_resources.sql:593/649/687`) gravam em `team_bookings` e auditam, mas não chamam `app.emit_event`. Os consumidores do worker (régua P13, lista de espera P06, `lc_on_event`) só reagem a `booking.*.v1` da tabela `bookings`.
- **Cenário:** um atendimento marcado pela tela Equipe não gera confirmação nem lembrete pela régua, e o cancelamento não libera vaga para a lista de espera. Pode ser recorte intencional do P28, mas não está escrito no `tasks/P28.md` nem na migration.
- **Correção:** confirmar o recorte; se a reserva de equipe deve ter régua e lista de espera, emitir `booking.confirmed/cancelled/completed.v1` (ou um `team_booking.*.v1` próprio) com consumidor.

### A9 · `link_token` da cobrança guardado em texto puro na idempotência · **baixo** · [comprovado]
- **Onde:** `20261022130000_p14_payments.sql:299` monta o `v_body` com `link_token` e o grava via `idempotency_complete`. O comentário da função diz "só o hash fica". `sales_quote_send` (`20261018180000_p11_sales.sql:408`) faz o certo e grava `token: null`.
- **Impacto:** quem lê `idempotency_records` (backend, backup, restore drill) consegue montar o link de pagamento. Não perde nem duplica dado, mas está fora do padrão.
- **Correção:** gravar o body sem o token (como em `quote.send`) e aceitar que a repetição devolva o link sem token, ou reemitir o token.

### A10 · Resposta fora do contrato depois do commit vira 500 permanente · **baixo** · [suspeita]
- **Onde:** `supabase/functions/_shared/http/rpc-handler.ts:142-143` (o mesmo em `crm/handler.ts`, `respond`). Se a RPC grava e devolve um body que não passa no zod de saída, a pessoa vê erro. Toda repetição devolve o mesmo body gravado e falha de novo, mas o dado **está** salvo.
- Hoje os testes de integração cobrem os formatos, então isso só acontece com divergência entre a migration e o contrato.
- **Correção:** registrar o desvio em log e, em comando já gravado, devolver um sucesso mínimo (id e versão) ou um código específico ("gravado, recarregue").

### A11 · Lacunas de teste em comandos que gravam · **baixo** · [comprovado]
- Sem nenhum teste (pgTAP, concorrência ou integração) que cite a RPC: `waitlist.withdraw`, `waitlist.cancel_offer`, `ops.block`, `lifecycle.step_cancel`, `resources.class_cancel`.
- Sem tela nenhuma (existem só no servidor): `booking.create_series`, `customer_link.issue`, `consent.revoke` (lista de espera), `ops.presence_delivery` (operação interna).
- **Correção:** um pgTAP mínimo por RPC (claim/replay/mismatch, versão e tenant alheio); para as que não têm tela, decidir se ficam no contrato.

### Observações sem achado

- **Pagamentos, repetição de `payment.charge_create`:** o body gravado traz `status: "creating"`, então o handler chama o PSP de novo (`payments/handler.ts:117-131`). Isso é seguro porque o PSP recebe `Idempotency-Key: chg:<id>` (`_shared/domain/payments/providers.ts:176`) e `payment_charge_result` ignora quem não está em `creating`/`unknown`. Vale um teste contra o PSP real para confirmar que ele respeita o cabeçalho [suspeita leve].
- **Fiscal, `fiscal.emit`:** a repetição não reenvia ao provedor, porque o body gravado não leva `request` (`fiscal/handler.ts:85`). OK.
- **CRM:** demo só de leitura (`crm/api.ts:159`), enquanto o "Novo cliente" da Agenda grava na demo (fixturePort). É diferença de paridade conhecida e rotulada, sem perda de dado.
- **Handler do CRM:** é próprio e não traduz envelope 4xx gravado (`crm/handler.ts:218-220`). Hoje nenhuma RPC do CRM devolve esse envelope; se alguma passar a devolver, vira 500.

## 4. Testes executados

Ambiente: Postgres 16 num cluster meu, iniciado como `postgres` em `/tmp/tinindo-a3-pg` (porta 54329, socket em `/tmp/tinindo-a3-pg/sock`). O diretório do scratchpad não é acessível ao usuário `postgres` (pais com modo 700), por isso o cluster ficou fora dele. A configuração do Postgres do sistema não foi tocada.

| Comando | Resultado | Log |
|---|---|---|
| `npm run db:test:local` | **passou**: 33 arquivos pgTAP, 1.779 `ok`, 0 `not ok` | `a3/db-test-local.log` |
| `npm run db:test:concurrency` | **passou**: 27 scripts | `a3/db-concurrency.log` |
| `npm run test:integration` | **passou**: 24 arquivos, 142 testes | `a3/integration.log` |
| Reprodução A6 (`channel_verify` com a mesma chave) | **falha reproduzida** (PT500) | `a3/repro-channel-verify.log` |
| Varredura de argumentos rota → RPC (`a3/tools/argkeys.mjs` + `pg_proc`) | 125 rotas de comando, 0 divergências | `a3/argkeys.jsonl`, `a3/sigs.txt` |
| Varredura de campos do contrato que não chegam à RPC (`a3/tools/fields.mjs`) | 0, além de 3 unions conferidas à mão | — |
| Varredura de autorização antes do claim e de `complete` antes de cada `return` (`a3/tools/order.py`, `ret.py`) | 0 problemas | `a3/scan.tsv` |

Os testes existentes não pegam A1–A5 e A7 porque testam o banco (que está certo) e o hook `useKeyFor` isolado. Falta teste de tela no fluxo "erro de rede depois do commit, depois novo toque", com a porta de servidor e um `fetch` que grava e depois falha.

Cluster temporário parado ao final (dados em `/tmp/tinindo-a3-pg/data`, com o banco de apoio `review_a3`; para religar: `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/tinindo-a3-pg/data -o '-p 54329 -k /tmp/tinindo-a3-pg/sock' start"`).

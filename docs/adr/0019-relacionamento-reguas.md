# ADR-0019 · Relacionamento: réguas sobre o outbox (P13)

Status: aceita · 2026-10-22 · integrador (onda 2, PR 4; plano em `docs/plano-onda-2.md`)

## Contexto

Confirmação, lembretes, acompanhamento de orçamento parado, lembrete de cobrança vencida e reativação são as "réguas" que o doc15 pede. Precisam parar sozinhas quando o fato muda (aceite, cancelamento, pagamento, oposição), nunca enviar duas vezes, respeitar consentimento por finalidade e um teto de gasto, e funcionar sem canal conectado (compartilhamento manual, como as ofertas do P06). O indicador de lembretes do P18 estava "indisponível" até existir isto.

## Decisões

1. **Cada passo é um registro** (`lifecycle_steps`): régua, agregado, chave, vencimento, estado por palavra (`scheduled`, `deferred`, `sent`, `manual`, `shared`, `skipped`, `cancelled`), motivo quando pulado/cancelado, texto renderizado e a mensagem do canal quando enviada. `UNIQUE (tenant, rule, aggregate_id, step_key)` é o dedupe: repetir o evento não cria outro passo. **Enviado ao canal ≠ entregue**: a entrega é a do P12 e aparece na fila como estado da mensagem.
2. **Réguas reagem ao outbox** (`app.lc_on_event`, chamada por `app.jobs_handle`): `booking.confirmed` cria confirmação (agora) e lembretes (24 h e 2 h antes, configuráveis); `booking.cancelled`/`completed` param; `sales.quote.accepted`/`declined` param o acompanhamento; `payment.recorded` para o lembrete de cobrança; `channel.message.received` com opt-out cancela tudo da cliente. Consumidor idempotente por `event_id` (`lifecycle_processed_events`).
3. **Remarcação emite evento.** A RPC de remarcar do P03 atualiza a reserva no lugar e não emitia nada. Um gatilho aditivo (`bookings_rescheduled_event`) emite `booking.rescheduled.v1` quando um atendimento confirmado muda de horário; a régua cancela os passos antigos (`rescheduled`) e cria os novos para a nova versão. `EventType` ganha o tipo (aditivo).
4. **Prazos sem evento são varridos pelo tick** (`app.lc_tick`, chamado por `public.jobs_run` a cada rodada): orçamento `sent` há N dias, sem decisão e dentro da validade → acompanhamento; recebível em aberto vencido há mais de 1 dia → lembrete de cobrança. Um por agregado.
5. **Despacho** (`app.lc_dispatch`, sob `for update skip locked`): confere o agregado (ainda confirmado/enviado/em aberto), a permissão, o canal, o teto e o modelo. Sem canal (cliente sem telefone ou sem conexão ativa) → `manual` com o texto pronto; o dono marca `shared`. Com canal → mensagem de modelo na fila do P12 (`channel_messages`), nunca texto livre. Teto diário atingido → `deferred` para amanhã às 09:00 no fuso do negócio, nunca descartado.
6. **Consentimento por finalidade.** Transacional (confirmação, lembrete, acompanhamento do orçamento que a cliente pediu, cobrança do que ela deve) é permitido salvo oposição: SAIR no canal ou consentimento transacional revogado pelo dono em nome da cliente. Marketing (reativação) exige consentimento registrado pelo dono (`lifecycle_consents`). Nome, serviço e horário entram como parâmetros do modelo: dados, não instruções.
7. **Reativação só como campanha.** O dono vê o público elegível (consentimento de marketing, sem visita há N dias, sem atendimento futuro, sem reativação nos últimos 90 dias) e aprova citando o `audience_hash` do que viu e um teto de envios. Público diferente → `STALE_VERSION`. A campanha agenda os passos; o despacho respeita o teto diário. Nenhuma reativação automática.
8. **P18 medido.** `app.an_metrics` passa a calcular `reminders`: atendimentos com cliente no período que tiveram lembrete `sent` ou `shared`, sobre os atendimentos (confirmados, concluídos, faltas). A nota diz "enviado não é entregue nem lido".
9. **Modelos novos** (`lembrete_orcamento`, `lembrete_cobranca`, `reativacao`) aprovados só no simulado; no provedor real, aprovação da Meta por migration.
10. **Privacidade.** Auditoria guarda régua, modelo e ids, nunca telefone, nome ou texto. RLS: dono lê passos, consentimentos, campanhas e configuração do próprio negócio; `lifecycle_processed_events` sem grant.

## Consequências

- `public.jobs_run` e `app.jobs_handle` foram substituídos (`create or replace`) para chamar a régua: o cron do `jobs` cobre o P13 sem novo agendamento. O resultado do worker ganha a chave `lifecycle` (aditivo).
- Clientes sem telefone ou sem canal recebem tudo por compartilhamento manual: a tela mostra o texto e o dono decide. Isso é o mesmo gate do P06 e vale até o canal estar conectado.
- Estorno de consentimento transacional é raro e fica rotulado como oposição registrada; a reativação continua opt-in puro.
- Quando o P12 ganhar provedor real, os modelos novos precisam de aprovação antes de qualquer envio fora do simulado.

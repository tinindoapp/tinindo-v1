# ADR-0017 · Canal oficial de mensagens (P12)

Status: aceita · 2026-10-22 · integrador (onda 2, PR 2; plano em `docs/plano-onda-2.md`)

## Contexto

O P12 liga o número do negócio a um canal de mensagens para a cliente escrever e o dono responder, e para as réguas do P13 saírem por ele. A regra do projeto é só API oficial (nunca automação do WhatsApp Web nem API não oficial), e nenhum provedor real pode ser contratado nem configurado sem autorização. Enviado, entregue, lido, falhou e desconhecido precisam ser estados distintos (docs/02, docs/05).

## Decisões

1. **Provedor atrás de porta.** `Provider` (`_shared/domain/messaging/providers.ts`) tem `send`, `status`, `verifySignature` e `normalize`. Dois adaptadores: `simulated` (determinístico, sem rede, entrega ao telefone fictício `channel_sim_phone`; número terminado em `0000` falha, em `9999` fica desconhecido uma vez) e `whatsapp_cloud` (Graph API oficial; só com `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_APP_SECRET`; sem eles `configured = false`, conectar responde 503 e nada é gravado). A demonstração offline e o CI só conhecem o simulado.
2. **Número verificado pelo próprio canal.** `channel.connect` registra o número e enfileira um código de 6 dígitos que só sai pelo despacho, como mensagem do modelo `verificacao_numero`. O código fica em `channel_verifications` (sem acesso pela Data API; só o hash é comparado) com validade de 10 min e 5 tentativas. Código errado não é RAISE: a RPC devolve um envelope 4xx que o `rpc-handler` traduz, para a tentativa ficar gravada.
3. **Webhook assinado, deduplicado, só pelo backend.** `channel.webhook/<provider>` confere `X-Hub-Signature-256` (HMAC-SHA256 sobre o corpo bruto, comparação em tempo constante) antes de ler qualquer coisa; eventos normalizados vão a `channel_webhook_ingest` com `service_role`; `(provider, external_event_id)` deduplica; evento de conta não ativa fica registrado como `unmatched_account`. O dono nunca grava mensagem de entrada nem estado de entrega.
4. **Estados de entrega.** `queued → sending → sent → delivered → read`, ou `failed`, ou `delivery_unknown` (timeout, 5xx, rede). Só avançam; falha é final. `delivery_unknown` não dispara reenvio: depois de 1 min o despacho consulta o status (`channel_dispatch_unknown`); a API oficial não oferece consulta, então ali só o webhook resolve. `attempts` prova que não houve reenvio.
5. **Janela de 24 h, modelos e opt-out.** Texto livre só dentro de 24 h após a última mensagem da cliente. Fora dela, só modelo com `approved_providers` contendo o provedor da conexão e com opt-in (mensagem da cliente ou declaração do dono). `SAIR`/`PARAR`/`STOP`/`CANCELAR` da própria cliente bloqueia envios; só o dono pode reverter, e a tela diz que isso só vale se a cliente pediu pessoalmente. Conteúdo da cliente é dado (o nome de perfil vem rotulado como tal).
6. **Despacho como rota de sistema.** `channel.dispatch` (header `X-Tinindo-Dispatch-Secret` ≥ 32 caracteres) reserva a fila com `for update skip locked`, chama o provedor e grava cada resultado. Agendamento é configuração de ambiente, como o `jobs` (ADR-0011). Mensagens e verificações pendentes falham com motivo quando o canal é desconectado.
7. **Simulador pela mesma porta.** `sim.inbound` (dono, só conexão simulada) monta um webhook simulado ASSINADO com `MESSAGING_SIM_SECRET` e o entrega ao mesmo caminho do provedor real; a `Idempotency-Key` vira o id do evento, então repetir é duplicado. A tela `/app/mensagens/simulador` é rotulada como simulação em todo lugar.
8. **Privacidade.** Auditoria guarda provedor, tipo e modelo, nunca telefone nem texto. Logs da função só `fn`, `route`, `request_id`, `status`, `ms`. RLS: dono lê conexões, contatos e mensagens do próprio negócio; `channel_verifications`, `channel_webhook_events` e `channel_sim_phone` não têm grant nem política.

## Consequências

- O P13 pode enfileirar modelos pelo mesmo `channel_messages` (via RPC de backend a definir) e cessar réguas por `channel.message.received.v1` / `channel.message.failed.v1`.
- Contratar e configurar o WhatsApp oficial (conta, número, modelos aprovados pela Meta, webhook público) é decisão do dono do projeto; o código já aceita os segredos, mas nada foi contratado.
- O despacho depende de um cron a cada minuto, como o `jobs`; sem ele, nada sai da fila.

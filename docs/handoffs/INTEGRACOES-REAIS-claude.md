# Handoff · Integrações reais prontas para ligar (WhatsApp oficial e Pix por parceiro)

Sessão: Claude Code na nuvem, para @fffalleiros · 2026-11-21
Branch: `claude/kind-allen-m9zju9`. Um PR por bloco, nesta ordem: 1 camada de provedor; 2 WhatsApp oficial (Meta Cloud API); 3 Pix por parceiro (Asaas); 4 testes sem rede e o teste opcional com credencial real; 5 `release/WHATSAPP.md` e `release/PIX.md`.
Nenhuma credencial foi configurada e nenhum provedor real foi chamado. Nada foi aplicado na homologação.

## Bloco 1 · Camada de provedor única, escolhida só por segredo

`supabase/functions/_shared/providers/selection.ts`:

| Segredo | Valores | Nome no banco | Chaves exigidas |
|---|---|---|---|
| `MESSAGING_PROVIDER` | `simulado` (padrão) · `meta` | `simulated` · `whatsapp_cloud` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |
| `PSP_PROVIDER` | `simulado` (padrão) · `asaas` | `simulated` · `asaas` | `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` |

- Segredo ausente ou vazio vale simulado. Valor desconhecido também vale simulado, com o motivo no log da partida (`{"fn":"messaging","startup":…}`, sem valor de segredo).
- **Provedor real sem as chaves não cai para o simulado.** Ele fica escolhido e "não configurado", e conectar número ou criar cobrança responde 503 antes do banco. Cair sozinho no simulado mandaria cliente de verdade para telefone ou Pix de mentira.
- **O servidor decide; a tela não escolhe.** `channel.connect` e `payment.charge_create` trocam o `provider` do corpo pelo provedor ativo, e o campo ficou opcional no contrato, para clientes antigos. `payment.reconcile` sem `provider` concilia o ativo.
- **O que já existe segue no provedor em que nasceu.** Webhook, consulta, cancelamento e estorno usam o provedor gravado na linha.
- `channel.status` e `payment.charges` ganharam `provider: { active, real, configured }`, opcional no contrato. As telas trocaram o seletor por "Provedor: …" / "Como receber: …" e, com provedor real sem chaves, avisam e desabilitam o botão.
- Trocar de provedor = `npx supabase secrets set MESSAGING_PROVIDER=meta …` e reiniciar a função. Nenhum deploy de código.
- O esqueleto genérico `psp` do P14 continua no código e no banco (nenhuma linha usa), mas nenhum segredo o escolhe. `asaas` entrou no enum do contrato; o adaptador e a migration vêm no bloco 3.

Testes: `selection.test.ts` (padrão, desconhecido, real sem chaves, troca do corpo), handler de `messaging` (503 com `meta` sem chaves, corpo ignorado, estado sem segredo) e de `payments` (503 com `asaas` sem chaves, corpo ignorado). A integração `31_p14` agora espera a regra de cobrança repetida, porque o `psp` do corpo é ignorado. Os e2e de Mensagens, Pagamentos e a jornada do servidor conferem a linha do provedor no lugar do seletor.

Recado: #190 (`release/smoke.sh` reprova `PSP_*` e não vê `ASAAS_*`/`MESSAGING_PROVIDER`).

## Bloco 2 · WhatsApp oficial pela Cloud API da Meta

Adaptador em `supabase/functions/_shared/providers/meta.ts` (o `_shared/domain/messaging/providers.ts` reexporta; tipos e assinatura em `_shared/domain/messaging/port.ts`). Banco em `supabase/migrations/20261121114407_whatsapp_meta.sql` (nome provisório). Tabela dos modelos no código: `_shared/providers/meta-templates.ts`; o teste de integração `55_whatsapp_meta` confere que ela é igual ao banco.

### O que mudou

- **Conectar com a Meta.** Com `MESSAGING_PROVIDER=meta`, a tela pede o número, o ID do número na Meta (`phone_number_id`, só dígitos) e o WhatsApp **pessoal** do dono. Antes de gravar, a função confere o dono (`channel_status`) e lê o número na Graph (`GET /{phone_number_id}?fields=display_phone_number,verified_name,quality_rating`). ID que a Meta não reconhece: 422 `external_account_id`. ID de outro número: 422 `display_phone_number`. Graph fora do ar: 503, nada gravado. O código de 6 números sai pelo número do negócio, como modelo de autenticação, para o WhatsApp pessoal: a Meta não entrega mensagem do número para ele mesmo (código 131021).
- **Estado real na tela.** "Aguardando o código" mostra o envio do código (na fila, enviado, ou "não saiu" com o motivo, ex.: modelo não aprovado). A conexão mostra o ID na Meta. Na conversa, uma mensagem esperando por limite mostra "nova tentativa a partir de HH:MM" e o motivo. "Enviada" nunca aparece como "Entregue".
- **Janela de 24 h.** O banco já recusava texto livre fora da janela na hora de pôr na fila (`channel_send`, pgTAP 13). Agora o despacho confere de novo para a Meta: texto que ficou na fila além da janela falha `window_closed` sem chamar a Graph (a Meta recusaria com 131047). No simulado, o despacho segue como no P12.
- **Webhook.** Assinatura sobre os **bytes** como chegaram (antes: texto decodificado), header só `sha256=<64 hex>`, corpo que não é UTF-8 válido = 400, `Content-Length` acima de 256 KB = 400 antes de ler. `object` diferente de `whatsapp_business_account` é ignorado. Resposta por botão (`type: button`) e interativa entram como texto (o "SAIR" de resposta rápida funciona). Dedupe continua `(provider, external_event_id)`.
- **Status que chega antes do id.** Se o webhook de enviado/entregue/lido chega antes de o despacho gravar o id da mensagem, ele fica guardado em `channel_webhook_events` (só id, estado e motivo) e é aplicado quando o id chega. Trava por id (`pg_advisory_xact_lock`) entre o webhook e o resultado do despacho: nenhum dos dois perde o outro (concorrência `33_whatsapp_meta`, parte 1). Status só avança (`app.ch_apply_status`): lido não volta a entregue, entregue não volta a enviado, falha não vem depois de entregue.
- **Opt-out no servidor.** `app.ch_is_opt_out`: SAIR, PARAR, STOP ou CANCELAR (a lista da ADR-0017), em qualquer caixa e com pontuação ou espaço em volta ("sair!", "Stop."). Frase com a palavra ("não quero parar") não é saída. Ao receber, o que estava na fila daquele contato falha `opted_out` na hora (com `channel.message.failed.v1`). O despacho confere de novo antes de entregar ao provedor, então nem o que entrar na fila por outro caminho (régua, campanha) sai. O que o provedor já aceitou não dá para desfazer.
- **Limite e retentativa pela fila do P12.** `app.ch_dispatch_rules()`: até 20 envios por número por rodada; 5 tentativas; espera 60 s × 2^(n-1) até 30 min (ou a espera da Graph, `Retry-After`, se maior). Resultado `retry` (429 e códigos de limite) volta para `queued` com `next_attempt_at`; no teto, falha `retries_exhausted`. Quando um número bate o limite, o resto da rodada daquele número (ou do par número→cliente, ou da conta inteira, conforme o código) volta como `requeue`, sem chamar a Graph e sem gastar tentativa. 5xx e tempo esgotado continuam `delivery_unknown`, sem reenvio. Verificação e código de reserva com limite voltam para `queued` e saem na rodada seguinte enquanto não vencem.
- **Modelos.** `channel_templates` ganhou `meta_name`, `meta_category`, `meta_language`, `meta_body` e `meta_params` (origem de cada variável: 0 = nome do negócio, k = k-ésimo parâmetro do app). O despacho manda `provider_template` com os parâmetros na ordem da Meta. O texto que o app guarda e mostra é igual ao que a Meta mostra (pgTAP 51 confere todos). `link_orcamento` e `oferta_vaga` ganharam uma frase no fim: a Meta não aceita corpo que termina em variável. Nenhum modelo nasce aprovado na Meta.
- **Aprovar na Meta = `channel_template_set_approval(código, 'whatsapp_cloud', true)`**, só `service_role` (o dono não aprova). O despacho e a tela só tratam como aprovado com `approved_providers` contendo o provedor **e** o cadastro da Meta preenchido.

### Modelos para cadastrar e aprovar na Meta

Todos em **pt_BR** e todos precisam de aprovação no Gerenciador do WhatsApp antes de marcar no banco. Nos modelos ao cliente, `{{1}}` = nome do negócio e as demais variáveis seguem a ordem dos parâmetros do app.

| Código interno | Nome na Meta | Categoria | Corpo | Variáveis |
|---|---|---|---|---|
| `verificacao_numero` | `verificacao_numero` | authentication | texto fixo da Meta para código ("{{1}} é seu código de verificação.") | {{1}} código de 6 números para conectar o número |
| `codigo_reserva` | `codigo_reserva` | authentication | texto fixo da Meta para código | {{1}} código de 6 números da reserva pelo link |
| `confirmacao_agendamento` | `confirmacao_agendamento` | utility | Olá, {{2}}! {{1}} confirmou seu horário de {{3}} em {{4}}. Para remarcar, responda aqui. Responda SAIR para não receber mais avisos. | {{1}} negócio · {{2}} cliente · {{3}} serviço · {{4}} dia e hora |
| `lembrete_agendamento` | `lembrete_agendamento` | utility | Lembrete de {{1}}: {{2}} em {{3}}. Se precisar remarcar, responda esta mensagem. | {{1}} negócio · {{2}} serviço · {{3}} dia e hora |
| `link_orcamento` | `link_orcamento` | utility | Olá, {{2}}! {{1}} preparou seu orçamento. Veja e responda pelo link: {{3}} Se tiver dúvida, responda esta mensagem. | {{1}} negócio · {{2}} cliente · {{3}} link do orçamento |
| `oferta_vaga` | `oferta_vaga` | utility | Olá, {{2}}! Abriu um horário de {{3}} em {{4}} com {{1}}. Veja e aceite aqui: {{5}} Se não puder, é só ignorar. | {{1}} negócio · {{2}} cliente · {{3}} serviço · {{4}} dia e hora · {{5}} link para aceitar |
| `lembrete_orcamento` | `lembrete_orcamento` | utility | Olá, {{2}}! Seu orçamento de {{3}} com {{1}} continua disponível até {{4}}. Se tiver dúvida, responda esta mensagem. | {{1}} negócio · {{2}} cliente · {{3}} orçamento · {{4}} validade |
| `lembrete_cobranca` | `lembrete_cobranca` | utility | Olá, {{2}}! Aqui é {{1}}. Ficou em aberto {{3}} de {{4}}. Se já pagou, desconsidere. Dúvidas, responda aqui. | {{1}} negócio · {{2}} cliente · {{3}} valor · {{4}} descrição |
| `pacote_vencendo` | `pacote_vencendo` | utility | Olá, {{2}}! Aqui é {{1}}. Seu pacote de {{3}} ainda tem {{4}} e vale até {{5}}. Quer marcar? Responda esta mensagem. | {{1}} negócio · {{2}} cliente · {{3}} pacote · {{4}} o que resta · {{5}} validade |
| `reativacao` | `reativacao` | marketing | Olá, {{2}}! Faz tempo que não nos vemos no {{1}}. Quer agendar um horário? Responda SAIR para não receber mais convites. | {{1}} negócio · {{2}} cliente |
| `oferta_campanha` | `oferta_campanha` | marketing | Olá, {{2}}! {{1}} tem uma oferta para você: {{3}}. Vale até {{4}}. Responda SAIR para não receber mais convites. | {{1}} negócio · {{2}} cliente · {{3}} oferta · {{4}} validade |

Exemplos de cada variável (a Meta pede ao cadastrar) estão em `meta-templates.ts`.

### Testes

- Sem rede: `meta.test.ts` (corpo do envio, classificação das respostas, webhook, leitura do número); `tests/contracts/messaging/meta-graph.test.ts` contra um servidor falso que imita a Graph (`fake-graph.ts`: sucesso, 4xx com código, token errado, 429, códigos de limite, 5xx, tempo esgotado, leitura do número; webhook assinado, assinatura inválida, repetição, desafio GET; despacho com 429); `handler.test.ts` (conexão com a Meta, rodada com limite por número, par e conta, bytes do webhook).
- Banco: pgTAP `51_whatsapp_meta` (67 asserções); concorrência `33_whatsapp_meta` (status junto com o resultado do despacho, retentativa duplicada em paralelo e despachos em paralelo, SAIR junto com o despacho); integração `55_whatsapp_meta` (banco real + Graph falsa, de ponta a ponta).
- Com a Meta de verdade (fora do CI): `tests/contracts/messaging/meta-live.test.ts`, só com `WHATSAPP_LIVE=1`; sem as chaves aparece pulado com o motivo.

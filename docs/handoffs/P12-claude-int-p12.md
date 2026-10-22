# Handoff · P12 Canal oficial de mensagens

Sessão: `claude-int-p12` (integrador contínuo, Claude Code na nuvem, para @fffalleiros) · 2026-10-22
Branch: `claude/p12-canal` → PR para `main`. Decisões em `docs/adr/0017-canal-oficial-de-mensagens.md`. Onda 2, PR 2 (`docs/plano-onda-2.md`).

## Resultado

- **Banco** (`20261022120000_p12_messaging.sql`): modelos, conexões, verificações (backend), contatos, mensagens, eventos de webhook (dedupe), telefone simulado; 12 RPCs do dono e 5 de backend; eventos `channel.message.received.v1` e `channel.message.failed.v1`.
- **Edge Function `messaging`**: 11 rotas do dono pelo `rpc-handler`, `channel.webhook/<provider>` (GET desafio da API oficial, POST assinado), `channel.dispatch` (segredo), `sim.inbound` (simulador pelo mesmo webhook). `rpc-handler` passou a traduzir envelopes 4xx devolvidos pela RPC (tentativa de código errado fica gravada).
- **Provedores** (`_shared/domain/messaging/providers.ts`): `simulated` e `whatsapp_cloud` (Graph API), atrás da mesma porta.
- **Contratos** (`_shared/contracts/messaging.ts`), registro v1 (módulo `messaging`, 13 operações), docs/01 e docs/03.
- **Telas**: `/app/mensagens` (conexão e verificação, caixa de entrada, conversa com estados por palavra, resposta na janela, modelo aprovado, assumir conversa, opt-out) e `/app/mensagens/simulador` (telefone fictício, cliente escreve, provedor confirma entregue/lida/falhou, despacho manual na demonstração).

## Aceite do pacote (tasks/P12.md)

| Critério | Evidência |
|---|---|
| Validar webhook e identidade | teste do handler (assinatura inválida 401, corpo alterado 401, desafio só com token); int `30_p12_canal` SEC (webhook forjado não entra); pgTAP 13 (conta não ativa → `unmatched_account`); número verificado só pelo código entregue no canal (int passo 1, e2e) |
| Deduplicar | pgTAP 13 e int passo 2 (`duplicates: 1`), chave `(provider, external_event_id)`; `sim.inbound` repetido = duplicado |
| Distinguir status | pgTAP 13, int passos 3 e 5, e2e: fila → enviada → lida; entregue depois de lida não volta; falhou com motivo; desconhecida consultada sem reenvio (`attempts = 1`) |
| Handoff humano | pgTAP 13, int passo 6, e2e ("Assumir a conversa") |
| Não usar API não oficial | só `simulated` e `whatsapp_cloud` (Graph); sem segredos, conectar o oficial = 503 antes do banco (teste do handler, e2e) |
| Entre tenants | pgTAP 13 e int SEC: outro dono 403 em leitura, envio e simulador; RLS 0 linhas; tabelas de backend sem grant |
| Falha externa, replay, recuperação | provedor: 5xx/timeout = desconhecido, 4xx = falha com código (teste dos provedores); desconectar falha a fila com motivo; conc `13_messaging` (dois despachos não pegam o mesmo item) |
| Opt-out e janela | pgTAP 13, int passos 4 e 6, e2e: SAIR bloqueia; fora de 24 h só modelo aprovado com opt-in |

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` · `typecheck` · `build` | ok |
| `npx vitest run` (unit + contratos) | ver PR |
| `npm run test:integration` | ver PR (novo: `30_p12_canal`, 8 passos) |
| `npm run db:test:local` | ok (P12: 67 asserções) |
| `npm run db:test:concurrency` | ok (`13_messaging`) |
| `npm run db:restore:drill` | ok |
| `deno check --frozen` | ok |
| `npx playwright test` | ver PR (novo: `tests/e2e/messaging`, desktop + mobile) |
| gitleaks (PR) | sem achados |

## Decisões tomadas sem consulta

- Provedor real = WhatsApp Cloud API (Graph v21), por ser a oficial; nada foi contratado nem configurado. Segredos esperados: `MESSAGING_DISPATCH_SECRET`, `MESSAGING_SIM_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (gate ADR-0006).
- Modelos semeados (`verificacao_numero`, `confirmacao_agendamento`, `lembrete_agendamento`, `link_orcamento`, `oferta_vaga`) aprovados só no simulado; na API oficial, a aprovação da Meta entra em `approved_providers` por migration.
- Mídia (imagem, áudio) fica fora do piloto: o webhook ignora e registra `ignored`.
- O simulador existe em produção para a conexão simulada (rotulado), não só na demonstração: é o caminho de homologação sem provedor contratado.
- O P12 não estava no manifesto (mesmo caso do P10/P11/P15/P18); o quadro não foi alterado.

## Limitações e próximos passos

- Sem cron: o despacho precisa de agendamento (POST a cada minuto com o segredo), como o `jobs`.
- Sem consulta de status na API oficial: `delivery_unknown` ali só sai pelo webhook.
- Sem vínculo manual do contato a um cliente do CRM pela tela (a API `contact.link` existe; a tela só desvincula). O vínculo automático é pelo telefone.
- P13 (réguas) e P18 (indicador de lembretes) ligam aqui: próximos PRs da onda.
- Staging: rodar `tests/e2e/messaging` contra o projeto hospedado com a conexão simulada antes de qualquer provedor real.

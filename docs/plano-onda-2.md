# Plano · Onda 2 (F2 restante + F3) sem intervenção do dono

Proposta de execução autônoma · 2026-10-22 · rascunho para aprovação; nada aqui está implementado.

## O que é

Oito PRs em sequência, cada um um pacote completo (migration, contratos, Edge Function, tela, testes em cinco camadas, ADR e handoff), mergeados por mim quando o CI estiver verde. Ao final, a Tinindo tem canal de mensagens, pagamentos, réguas de relacionamento, planos recorrentes, indicação de colegas, campanhas e metas, tudo rodando sobre dados sintéticos e provedores simulados, pronto para receber credenciais reais.

O que **não** entra, por regra do AGENTS.md: contratar provedor de WhatsApp ou PSP, mover dinheiro, enviar mensagens reais, aplicar migration em banco compartilhado. Cada integração externa nasce atrás de uma porta com um provedor simulado e uma flag desligada por padrão. Quando você tiver as credenciais, liga a flag: o código não muda.

## Sequência

| # | PR | Pacote | Depende de | Conteúdo | Gate externo (depois) |
|---|---|---|---|---|---|
| 1 | `claude/p10-integracao` | P10 · Integração (parte de código) | P01–P09 | Camada nova de teste **handler ↔ banco real** (vitest chamando cada Edge Function contra o Postgres local, sem mock de RPC); destravar os 19 UATs `fixme`; checklist de release (`release/`), runbook de rollback e restore; limites de corpo/rate por função | Projeto Supabase hospedado, SMTP, cron, testadores |
| 2 | `claude/p12-canal` | P12 · Canal oficial | P01, P06, P08 | Porta de mensageria com dois adaptadores: **simulado** (in-repo, determinístico) e **WhatsApp Cloud API** (assinatura `X-Hub-Signature-256`, templates, janela de 24 h). Vinculação de número por verificação, inbox por cliente, estados `sent`/`delivered`/`read`/`failed` distintos, opt-in/opt-out, transferência para humano, fila pelo outbox com retry | Conta Meta/BSP, número, templates aprovados |
| 3 | `claude/p14-pagamentos` | P14 · Pagamento conectado | P01, P07 | Porta de PSP com adaptador **simulado** e esqueleto para um PSP real (Pix por cobrança). Link de pagamento por recebível, webhook idempotente (notificação repetida não dá baixa duas vezes), estado `delivery_unknown` com consulta ativa, estorno vinculado, conciliação diária com diferenças listadas. `payment_entries.source` ganha `provider` | Contrato com PSP, chaves de sandbox |
| 4 | `claude/p13-relacionamento` | P13 · Lembretes e acompanhamento | P11, P12, P06 | Réguas determinísticas sobre o outbox: confirmação e lembrete (24 h / 2 h) após `booking.confirmed`; follow-up de orçamento 2 dias sem decisão; parada por aceite, recusa, cancelamento, pagamento ou oposição; reativação após N dias sem atendimento. Consentimento por finalidade, dedupe por evento, orçamento diário de envios. Com canal desligado, cai no compartilhamento manual (como P06). Liga o indicador de lembretes do P18 | Nenhum além do P12 |
| 5 | `claude/p20-recorrencia` | P20 · Planos recorrentes do profissional | P07, P11, P14 | Assinatura de serviços do profissional para o cliente dele (ex.: 4 cortes/mês), renovação, saldo de sessões sobre `session_packages`, cancelamento que preserva regras e saldo aceitos, cobrança recorrente pelo P14 (simulado) ou manual | Nenhum |
| 6 | `claude/p21-indicacao` | P21 · Indicação de colegas | P09, P15, P18 | Convite rastreado entre profissionais, adesão elegível, benefício como crédito de franquia (nunca avaliação ou nota), autoindicação e duplicidade bloqueadas, painel de indicações | Definir o benefício real |
| 7 | `claude/p19-campanhas` | P19 · Campanhas e experimentos | P13, P18 | Segmentos por dados existentes (sem atendimento há N dias, com crédito sobrando), público autorizado, limite de gasto aplicado no servidor, oferta vinculada (P05/P11), **grupo de controle** sorteado e comparação com intervalo, sem causalidade afirmada fora do desenho | Canal real para envio |
| 8 | `claude/p22-metas` | P22 · Metas e conteúdo | P15, P18, P19 | Metas por indicador do P18 (ocupação, faltas, recebido), progresso com denominador, sugestões só a partir de dado existente (regras, não LLM), conteúdo pré-aprovado por profissão com publicação só pelo escopo autorizado (P09) | Nenhum |

P16 (fiscal) e P17 (site/Google) ficam fora: o doc15 diz que só entram com demanda contratada, e os dois dependem de credenciais de terceiros que não posso obter.

## Como cada PR é fechado

1. Branch a partir de `origin/main` atualizada.
2. Migration append-only, contratos aditivos no registro v1, Edge Function sobre o handler genérico, tela com demonstração offline rotulada e porta de servidor.
3. Testes, todos obrigatórios e sem `--passWithNoTests`:
   - unit (regras puras e demonstração), contratos (registro ↔ rotas ↔ parâmetros SQL ↔ docs/03);
   - pgTAP (isolamento, RLS, idempotência, estados, append-only);
   - concorrência real (várias conexões: webhooks repetidos, envios paralelos, renovações simultâneas);
   - **handler ↔ banco** (novo no PR 1): cada rota chamada de ponta a ponta contra o Postgres local;
   - e2e Playwright desktop + mobile na demonstração;
   - `deno check`, lint, typecheck, build, gitleaks.
4. Mutação conferida: pelo menos um invariante por pacote com "se eu tirar esta linha, este teste cai", registrada no handoff.
5. ADR com as decisões e handoff com PR, SHA, comandos, resultados, mocks restantes e gates.
6. PR com o template, CI verde, merge por mim, branch seguinte rebaseada.

Se o CI quebrar, corrijo e repito. Se uma decisão de produto for necessária, decido pelo doc mais específico (doc15 > doc17 > doc00), anoto no ADR e sigo. Não paro para perguntar.

## Decisões que vou tomar sozinho (para você revisar depois)

- Adaptadores reais (WhatsApp Cloud API, PSP) ficam atrás de flag `channel.provider` / `payments.provider` = `simulated`. Ligar exige segredos no ambiente; sem eles a função responde 503 explícito, nunca finge sucesso.
- O PSP real terá só o **esqueleto** (interface, mapeamento de webhook, assinatura); não escolho fornecedor. O adaptador simulado reproduz os casos do doc02: sucesso, falha, timeout com resultado desconhecido, notificação duplicada, estorno.
- Réguas do P13 com horários fixos (24 h e 2 h antes; follow-up em 2 dias; reativação em 45 dias), configuráveis por negócio depois.
- Benefício de indicação (P21) = crédito de perguntas do assistente, não dinheiro.
- Campanhas (P19) só com grupo de controle; sem controle, a tela mostra o resultado como observação, não como efeito.
- Metas (P22) sem LLM: sugestões por regras sobre os indicadores do P18.

## Esforço e ordem de entrega

Cada PR tem o tamanho do P15 (migration de ~900 linhas, 15–20 operações, 60–70 asserções pgTAP, e2e). Entrego na ordem da tabela, um PR mergeado antes de abrir o próximo, para que `main` fique sempre utilizável. Se um pacote travar por algo fora do meu alcance, registro o bloqueio no handoff, mergeio o que está verde e sigo para o próximo que não depende dele.

## O que fica para você no fim

- Credenciais: Meta/BSP (P12), PSP (P14), projeto Supabase hospedado (P10).
- Decisões comerciais: catálogo de serviços assistidos, franquias por plano, benefício de indicação, preços recorrentes.
- Revisão humana dos ADRs 0016–0023 e dos handoffs antes de qualquer dado real.
- Marcar P10 como concluído no quadro depois do UAT com testadores reais (eu não altero o quadro).

# 10 · Qualidade e gates

## Matriz de testes

| ID | Evidência requerida | Resultado de sucesso |
|---|---|---|
| SEC-01 | Usuário A tenta SELECT/INSERT/UPDATE/DELETE no tenant B | Acesso negado sem revelar PII |
| SEC-02 | Cliente que usa A/B acessa outra pessoa e finanças | Apenas seus dados explicitamente permitidos |
| SEC-03 | Views, storage, RPC privilegiada e worker | Mesma fronteira, sem bypass involuntário |
| SEC-04 | Conteúdo malicioso pede troca de tenant/exportação | Ferramenta negada; nenhum vazamento |
| BOOK-01 | 20 requests concorrentes para um slot | Uma reserva; restantes conflito |
| BOOK-02 | Reagendar para ocupado e cancelar duas vezes | Reserva anterior preservada; evento único |
| BOOK-03 | Hold vencido e recorrência com conflito | Prazo aplicado no banco; falha explícita |
| PRICE-01 | Teto, piso, custos faltantes e arredondamento | Valores determinísticos e explicáveis |
| PRICE-02 | Cotação/regra alterada após aprovação | Versão revalidada; não executa aprovação velha |
| WAIT-01 | Dois cliques/duas sessões aceitam oferta | Uma confirmação, resposta idempotente |
| WAIT-02 | Worker falha, reinicia e recebe evento duplicado | Sem duplicar convite/hold; recuperação |
| FIN-01 | Pacote pago e sessões consumidas | Caixa registrado uma vez; saldo correto |
| FIN-02 | Pagamento parcial, estorno e retry | Sem saldo impossível nem dupla baixa |
| AI-01 | Perguntas financeiras com registros conhecidos | Número/período/fonte corretos |
| AI-02 | Desconto, campanha ou mudança sem aprovação | Bloqueado no servidor |
| NET-01 | Invite informal, claim e perfil privado | Sem publicar telefone nem disparar mensagem |
| OPS-01 | Restore em ambiente isolado | Dados e app utilizáveis; tempo registrado |
| OPS-02 | LLM/WhatsApp indisponível | Operação visual continua; estado honesto |
| UX-01 | iPhone Safari e desktop, teclado e leitores básicos | Sem fluxo bloqueado; foco/contraste legíveis |

Evidência executada no CI (P10, 2026-10-22). `pgTAP` = `supabase/tests/database`; `conc` = `tests/db-concurrency`; `int` = `tests/integration` (cada Edge Function com a lógica de produção chamando as RPCs num Postgres migrado do zero, sem mock de RPC); `e2e` = Playwright na demonstração offline.

| ID | Onde está provado | Pendente |
|---|---|---|
| SEC-01 | int `00_seguranca` (todas as funções, header é seleção), pgTAP de cada módulo | — |
| SEC-02 | int `13_uat_cliente_dois` (RLS real da cliente vinculada a dois negócios) | área da cliente na tela |
| SEC-03 | int `00_seguranca` (worker só `service_role`, anônimo só nas rotas de link), pgTAP 06/07/08 | storage (não há buckets ainda) |
| SEC-04 | `tests/agent-evals` AE-21…32, int `10_uat_barbeiro` passo 8 | LLM real (sem provedor no piloto) |
| BOOK-01 | conc `03_scheduling` (20 disputas → 1 reserva) | — |
| BOOK-02 | pgTAP 04, int `11_uat_cabeleireira` passo 3 | — |
| BOOK-03 | pgTAP 04 (hold vencido), int `12_uat_personal` passo 2 (recorrência com conflito) | — |
| PRICE-01 | `tests/contracts/pricing/price-domain`, pgTAP 06 | — |
| PRICE-02 | pgTAP 06 e 08 (STALE_VERSION), int `10_uat_barbeiro` passo 5 | — |
| WAIT-01 | conc `07_waitlist`, int `10_uat_barbeiro` passo 6 | — |
| WAIT-02 | conc `07_waitlist` (três workers, evento repetido) | — |
| FIN-01 | pgTAP 05, int `12_uat_personal` passos 1 e 3 | — |
| FIN-02 | pgTAP 05, conc `05_finance`, int `12_uat_personal` passo 4 | — |
| AI-01 | `tests/agent-evals` AE-01…18 | — |
| AI-02 | pgTAP 08, int `20_f2_jornada` (aprovar ≠ executar) | — |
| NET-01 | pgTAP 09, int `10_uat_barbeiro` passo 4 | — |
| OPS-01 | `npm run db:restore:drill` (dump → restore → integridade → comando real; tempo medido) | restore do backup hospedado |
| OPS-02 | testes de handler com RPC indisponível → 503; assistente sem LLM; canal: provedor sem segredo → 503, 5xx/timeout → entrega desconhecida sem reenvio (`providers.test`, int `30_p12_canal`) | PSP (P14) |
| MSG-01 | webhook assinado e deduplicado; estados enviado/entregue/lido/falhou/desconhecido distintos; opt-out; humano assume (pgTAP 13, conc `13_messaging`, int `30_p12_canal`, e2e `messaging`) | provedor oficial no staging |
| UX-01 | e2e desktop + Pixel 7, `tests/e2e/foundation/a11y`, auditoria `docs/qa` | iPhone Safari real |

A suite `tests_coordination` cobre outro objeto: a reserva de tarefas. Os roteiros UAT com usuários reais exigem o staging hospedado (gate do ADR-0006).

## Cenários UAT com usuários

**Barbeiro:** cria corte de 30min; importa cinco clientes; agenda um; abre link público; cliente escolhe vaga; aplica oferta terça com piso; cancela; lista de espera recupera; conclui; marca recebido; consulta “o que tenho amanhã?”.

**Cabeleireira:** serviço de 90min e buffer; não cabe em intervalo de 60min; muda duração e verifica novas reservas, preservando as antigas; cliente reagenda para faixa permitida; preço contratado não muda.

**Personal:** vende pacote de 10 sessões, registra pagamento, agenda recorrência de oito semanas com conflito em uma data, resolve, conclui duas sessões, resta saldo 8, cancela terceira conforme regra sem duplicar caixa. Sem dados de saúde.

**Cliente de dois profissionais:** a mesma conta acessa suas reservas de ambos; não vê notas privadas, lista de clientes nem custos; um profissional não descobre o histórico do outro.

## Definition of Done de pacote

Código revisado; contrato respeitado; testes do risco executados com resultado anexado; migration proposta/aceita; estados vazios/erro/loading; política de dados aplicada; sem segredo; feature flag padrão seguro; handoff com limitações e próximo consumidor. PR merged e quadro atualizado por integrador. “Tela renderizou” não satisfaz regra de agenda.

## Definition of Ready para piloto real

Todos os SEC e BOOK críticos passam; PRICE/WAIT/FIN passam; nenhum mock interno no fluxo; política de privacidade final; usuários convidados e suporte definidos; restore demonstrado; flags e logs; limitações externas comunicadas. WhatsApp sandbox não pode aparecer como atendimento automatizado comercial.

## Métricas dos primeiros 14 dias

Hipóteses de aceitação propostas: ≥6 de 10 profissionais completam onboarding assistido em ≤20min; ≥5 registram atendimentos em duas semanas consecutivas; ao menos 3 testam uma oferta ou lista de espera; zero dupla reserva/vazamento; registrar suporte por usuário e motivo de abandono. Se nenhum vê valor além da agenda, rever a promessa/fluxo antes de adicionar módulos.

Oferta: comparar margem, conversão e incômodo. Abandonar regra que gera reclamação recorrente, apenas desconta compra habitual ou exige suporte manual que supera ganho. A disposição a pagar se testa por cobrança real depois de valor percebido, não só por elogio à demo.

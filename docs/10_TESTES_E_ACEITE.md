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

Esses testes são exigências para o aplicativo. O kit entregue não os executou contra um aplicativo ainda não construído. A suite `tests_coordination` cobre outro objeto: a reserva de tarefas.

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

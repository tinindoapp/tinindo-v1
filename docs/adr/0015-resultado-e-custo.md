# ADR-0015 · Resultado e custo (P18)

Status: aceita · 2026-10-19 · integrador (implementou o P18 por pedido direto do dono do projeto)

## Decisões

1. **Indicador = conta explícita.** Cada indicador volta com `numerator`, `denominator`, `value`, `status` e uma nota com a definição. `insufficient` (denominador zero, expediente ausente) e `unavailable` (a fonte não existe) têm `value = null`; a tela mostra "Dados insuficientes" e "Ainda não medido", nunca 0%.
2. **Definições do doc15, calculadas no banco** (`app.an_metrics`):
   - Ocupação: minutos de reservas confirmadas, concluídas e faltas **dentro** do expediente vendável (expediente − bloqueios, via `app.sched_open_hours`) / minutos vendáveis. Holds, cancelados e intervalos entre atendimentos não contam. A falta conta como tempo reservado (o horário foi vendido e perdido), embora o P03 libere a capacidade dela.
   - Faltas: faltas / (concluídos + faltas) com início no passado. Cancelamentos: cancelados / (concluídos + faltas + cancelados). Atendimentos passados ainda "confirmados" ficam fora e aparecem na cobertura.
   - Ofertas de vaga aceitas (P06) e orçamentos aceitos (P11): razões com o denominador explícito.
   - Recebimentos e despesas registrados (P07), já descontados os estornos: observações, não lucro nem efeito.
   - Atendimentos com cobrança registrada: qualidade do registro.
   - Minutos da equipe Tinindo (P15): medidos, com automação e retrabalho à parte.
   - Lembretes (P13): `unavailable` até o P13 existir.
3. **Cobertura.** A resposta lista o que falta: período com dias futuros, expediente não configurado, atendimentos sem desfecho e concluídos sem cobrança.
4. **Baseline congelada.** `analytics_baselines` (append-only) guarda os indicadores e a cobertura calculados na criação. Só aceita período encerrado (fim ≤ agora), para não mudar depois. Lançamentos posteriores no mesmo período não alteram a baseline (pgTAP).
5. **Sem causalidade.** A comparação devolve a diferença por indicador, `causality: "not_established"` (literal no contrato: uma resposta que afirme causa é rejeitada pela função) e um aviso fixo. O sistema não estima efeito sem desenho comparável (P19).
6. **Custo por cliente é da operação.** `analytics.cost_to_serve` (só operador do P15, sem negócio selecionado): minutos medidos por negócio × custo-hora **informado por quem consulta** (premissa, não custo contábil), ao lado do plano e dos serviços contratados (cobrança manual, não confirmada). Não inclui infraestrutura, canal, impostos nem aquisição.

## Contrato (aditivo)

Módulo `analytics`: `analytics.metrics`, `analytics.baseline_create`, `analytics.baseline_list`, `analytics.cost_to_serve`.

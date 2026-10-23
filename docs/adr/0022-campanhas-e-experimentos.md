# ADR-0022 · Campanhas e experimentos com grupo de controle (P19)

Status: aceita · 2026-10-23 · integrador (onda 2, PR 7; plano em `docs/plano-onda-2.md`)

## Contexto

O P13 já faz reativação como campanha aprovada (público visto + teto) sobre o canal do P12. O P19 generaliza: segmentos por dados existentes, oferta vinculada e, principalmente, medição honesta do que aconteceu. O risco de produto é afirmar "a campanha trouxe X clientes" sem desenho que sustente isso (docs/00 e doc17: avaliação de resultado sem causalidade presumida) e gastar além do combinado (envios e descontos).

## Decisões

1. **Segmentos só por dados existentes.** `inactive_days` (sem atendimento há N dias, 14–365), `credit_remaining` (saldo em pacote do P07) e `marketing_all`. Nenhum campo livre, nenhum dado externo. `app.cp_segment` devolve o público e o hash do conjunto.
2. **Público autorizado no servidor.** Só clientes ativas com consentimento de marketing (P13, `app.lc_denied(..., 'marketing')`), sem atendimento futuro e fora de outra campanha em curso. A aprovação cita o `audience_hash` visto; público diferente → `STALE_VERSION`. Público vazio não aprova.
3. **Limites aplicados no servidor.** `max_sends` (1–500) limita o braço tratado; `spend_cap_cents` (opcional) limita pelo custo estimado da oferta (preço base × desconto × tratadas), reduzindo o braço em vez de estourar. O teto diário do P13 continua valendo no despacho. `estimated_cost_cents` fica gravado.
4. **Oferta vinculada, não texto livre.** `none`, `discount_pct` (5–50%, opcionalmente em um serviço do negócio) ou `pricing_rule` (regra publicada do P05, ativa). O texto da oferta é gerado pelo servidor; a aplicação do desconto no atendimento continua pelo P05/P11 (a campanha não altera preço sozinha).
5. **Grupo de controle sorteado no servidor.** `control_pct` 0–50%; a ordem é `md5(campaign_id || customer_id)`: estável, não manipulável pelo cliente. Controle não recebe mensagem. `campaign_members` é append-only (braço não muda). Membros de campanha em curso não entram em outra.
6. **Envio pela régua do P13.** Passos `rule = 'campaign'` (valor novo no check de `lifecycle_steps.rule`, alteração aditiva) com o modelo `oferta_campanha` (marketing). `app.lc_dispatch` substituído para tratar `campaign` como marketing e cancelar passos de campanha fora de curso. O vínculo passo ↔ campanha fica em `campaign_members.step_id`; `lifecycle_steps.campaign_id` segue exclusivo das reativações do P13. Sem canal, vira "para compartilhar", como no P13.
7. **Conversão medida, nunca declarada.** Convertida = agendamento (`confirmed/completed/no_show`) criado entre a entrada na campanha e o fim da janela (`window_days` 7–60). Receita = atendimentos concluídos na janela. Cada braço traz n, convertidas, taxa e intervalo de Wilson 95%.
8. **Veredito só pelo desenho.** Com controle e ≥ 5 por braço: diferença tratado − controle com intervalo (Newcombe); `difference_detected` só se o intervalo exclui zero; senão `no_difference_detected`. Braços pequenos: `inconclusive`. Sem controle: `observation_only`. Os textos da tela nunca dizem "efeito" ou "causou" fora desses casos, e mesmo "diferença detectada" é apresentada como comparação entre grupos.
9. **Fechamento pelo worker.** `app.cp_tick` (em `jobs_run`, substituído) fecha campanhas vencidas sob `for update skip locked`, congela `result` e emite `campaign.closed.v1`. Cancelar para passos pendentes, não muda o que saiu e congela o resultado como observação parcial.

## Consequências

- `jobs_run` passa a devolver `campaigns.closed`. Cinco responsabilidades por rodada; separar em crons é o próximo passo natural quando houver volume.
- `lifecycle_steps.rule` aceita `campaign`; o contrato `LifecycleRule` do P13 não foi alterado (os passos de campanha aparecem na tela de Relacionamento pela listagem genérica só se o contrato for ampliado; decisão adiada, registrada aqui).
- Oferta por `pricing_rule` depende de regra ativa do P05; sem regra, o dono usa desconto percentual.

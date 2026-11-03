# ADR-0035 · Insights proativos: motor diário de regras, proposta no fluxo dono e resumo semanal (P45)

Status: aceita · 2026-11-03 · integrador (sessão `claude-int-p45`, pedido do dono: plano em `docs/plano-assistente-configuracao-e-insights.md` §3)

## Contexto

O P22 (ADR-0023) já tinha sugestões por regra com evidência e acompanhamento em 30 dias, mas só cinco regras sobre os indicadores do mês, calculadas na hora em que a tela abre e escondidas em `/app/metas`. O plano do P45 pede um motor diário por negócio, nove regras ligadas a fluxos que já existem, até três insights na Home com "Ver" e "Agora não", lista completa em "Metas e sugestões", acompanhamento pelo `advice_decisions` e um resumo semanal por modelo fixo. Aceite: insuficiente ≠ zero; nenhuma ação executa sem aprovação; todo insight mostra período e denominador; duas rodadas do job não duplicam insight.

## Decisões

1. **Motor no worker `jobs`, uma vez por dia por negócio.** `public.jobs_run` (create or replace) chama `app.gi_tick(20)` depois do outbox e da régua. A reserva da rodada é a chave primária `insight_runs (tenant_id, run_date)` com `run_date` no fuso do negócio: dois workers que chegam juntos esperam a mesma chave e só um avalia (`insert … on conflict do nothing returning`). As outras rodadas do dia não fazem nada. A falha de um negócio fica registrada na rodada (`result.error`) e não para os outros.

2. **Nove regras fixas em SQL, sem LLM.** Catálogo em `insight_rules` (só por migration) e uma função por regra (`app.gi_<código>(tenant, now)`), com o instante como parâmetro para teste determinístico. Cada regra devolve `fire`, `quiet` ou `insufficient` com o motivo; insuficiente nunca vira zero e aparece na tela ("O que a conta olhou"). Limiares:

   | Regra | Mínimo de dado | Dispara quando | Ação (fluxo) |
   |---|---|---|---|
   | `uncharged_bookings` | 5 concluídos em 30 dias (indicador `charge_coverage` do P18) | cobertura < 90% | abre o Caixa (P07) |
   | `waitlist_opening` | lista de espera já usada | vaga aberta futura (candidata do P06 sem oferta) e gente ativa esperando | abre a Lista de espera (P06) |
   | `no_show_concentration` | 20 atendimentos com desfecho em 60 dias | um dia da semana com ≥ 5 atendimentos, ≥ 3 faltas e taxa ≥ 1,5× a média; ou clientes que faltam ≥ 2 vezes e em metade das vezes | abre Relacionamento (lembretes, P13) |
   | `package_expiring` | algum pacote vendido (P07) | pacote com sessões que vence em 15 dias | **proposta**: rascunhos manuais de aviso (P13) |
   | `lapsed_customers` | 5 clientes com 2+ atendimentos em 12 meses | passou do costume do serviço (1,5 × mediana dos intervalos, mínimo 14 dias, com 3+ intervalos; senão o prazo de reativação do P13, 60 dias) e sem atendimento futuro | **proposta**: convites de retorno como rascunhos manuais (P13), só com consentimento de marketing |
   | `idle_slot` | expediente, 5 semanas de conta e 10 atendimentos nas 5 semanas encerradas | faixa contínua de 2 h+ vazia em 4 das 5 semanas | **proposta**: regra de preço inativa (P05), 10% por 4 semanas só na faixa |
   | `low_margin_service` | algum serviço com ficha e custo conhecido (P30) | materiais > 30% do preço | abre Preços (P05) |
   | `profile_incomplete` | algum serviço ou perfil (antes disso fala o P44) | falta perfil publicado, foto, preço ou canal verificado | abre a tela que resolve (passo do P44) |
   | `month_closing` | algum registro de caixa no mês | últimos 5 dias do mês | só informa (P07/P31), sem ação |

3. **Evidência obrigatória.** `insights.evidence` tem `CHECK (evidence ?& array['period_start','period_end','numerator','denominator'])`; o contrato (`InsightEvidence`) exige os quatro e a resposta sem eles vira 500 no handler. Só contagens, taxas e nome de serviço; nunca nome, telefone ou e-mail de cliente. Ids de clientes e pacotes ficam no `payload` interno da ação, que não sai na leitura.

4. **Um insight por (negócio, regra, assunto).** `UNIQUE (tenant_id, rule_code, subject_key)` e upsert: rodar de novo atualiza a evidência e a validade, nunca duplica. O assunto identifica a situação (ex.: `wd2-14-16`); outro assunto aberto da mesma regra vira `resolved`. Regra que deixou de disparar resolve o aberto.

5. **"Agora não" e "Preparar" deixam a regra quieta por 30 dias.** `insight.snooze` → `snoozed` com `quiet_until = agora + 30 dias`; `insight.act` → `acted` com o mesmo prazo (é o tempo do acompanhamento). Dentro do prazo a regra não reaparece, nem com outro assunto; depois, se ainda disparar, volta como aberta.

6. **Ação só como proposta no fluxo dono.** `insight.act` reavalia a regra com o dado de agora; se não dispara mais ou mudou de assunto, recusa (`POLICY_REJECTED/stale`). Depois:
   - P05: chama `pricing_propose_rule` (proposta `proposed`, que expira em 24 h). Publicar continua sendo "Aprovar e publicar" em Preços, com o hash do que foi visto.
   - P13: grava passos `manual` (texto pelo modelo aprovado, `reativacao` ou o novo `pacote_vencendo`). Passo manual não é despachado pelo worker; o dono revisa, compartilha ou cancela em Relacionamento. Clientes sem permissão (`app.lc_denied`) são pulados e contados.
   - Ações de tela (P06, P07, P13, P44) só devolvem a rota.
   Um teste de contrato garante que a migration não chama publicação de preço, envio pelo canal, aprovação de campanha nem o despacho da régua.

7. **Acompanhamento pelo P22.** "Preparar"/"Ver" registra `accepted` e "Agora não" registra `dismissed` em `advice_decisions` (uma por regra e mês, `on conflict do nothing`), com o número da regra congelado (`measure`). `app.ga_tick` (create or replace) mede decisões de regras do P45 reavaliando a própria regra 30 dias depois, com o sentido do catálogo (`direction`); as do P22 seguem como antes. Variação observada, nunca efeito.

8. **A regra de cobrança sai do P22.** `app.ga_rules` (create or replace) perde `charge_coverage`, que passa a ser `uncharged_bookings` no motor (plano §3, "já existe no P22; passa para cá"). As outras quatro do P22 ficam em "Sugestões do mês".

9. **Resumo semanal por modelo fixo.** Na primeira rodada de cada semana, `app.gi_digest` grava em `insight_digests (tenant_id, week_start)` o resumo da semana encerrada (segunda a domingo, fuso do negócio): atendimentos concluídos, faltas e cancelamentos, recebido e despesas registrados (estornado sai), clientes novos e quantas sugestões estão abertas. Sem agenda registrada, diz isso em vez de "0". O resumo aparece na caixa de Mensagens do dono (o app injeta o cartão no Mensagens; módulo não importa módulo) e em Metas e sugestões. E-mail fica para quando o envio estiver ligado (recado #75).

10. **P13, aditivo.** A régua ganha `package_expiry` (agregado `package`) e o modelo `pacote_vencendo` (utility, aprovado só no simulado). Os CHECKs de `lifecycle_steps` são alargados na migration nova; o contrato `LifecycleRule` ganha o valor.

## Consequências

- `jobs_run` devolve também `insights: {tenants, failed}`. Com muitos negócios, 20 por rodada de minuto cobrem 28.800 por dia.
- A Home perde a linha "N sugestões com base nos seus números" das Pendências: o cartão "Para você esta semana" ocupa esse papel. O cartão do P44 entra acima dele.
- O menu passa a dizer "Metas e sugestões"; a rota continua `/app/metas`.
- Mudar limiar ou texto de regra é migration (`create or replace app.gi_<código>`), com o pgTAP da regra atualizado.
- P46 (LLM) pode redigir a explicação a partir da evidência calculada; os números continuam vindo do motor.

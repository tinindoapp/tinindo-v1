# 06 · Agenda, preço e lista de espera

## Agenda mínima útil

Calendário diário/semanal, duração por serviço, intervalos antes/depois, folgas, pausa e exceções. No piloto: um recurso por negócio e atendimento individual. Recorrência simples semanal com horizonte finito (ex.: oito semanas), cada ocorrência materializada e passível de conflito. Nunca exibir “série confirmada” se algumas datas falharam; pedir decisão de todas-ou-nada ou criar as disponíveis explicitamente.

Estados: `held → confirmed → completed`; alternativas `held → expired`, `confirmed → cancelled/no_show`. Toda transição valida versão/política. Reserva concluída não muda retroativamente a preço atual. Bloqueio pessoal é indisponibilidade, não cliente fictício. Cliente vê slots, sem saber com quem o profissional está ocupado.

Serviço externo usa buffer informado pelo profissional na semana 1. Não anunciar otimização de rotas sem geocodificação, tempo de viagem e teste. Personal com aula coletiva e salão com várias cadeiras são fases posteriores; não simular capacidade >1 criando horários que podem colidir.

## Precificação dinâmica sem adivinhação

Primeira versão é oferta por janela de horário e regra aprovada. O mesmo profissional pode ter terça à tarde com desconto e sábado com preço normal. Começar por desconto público de horário, sem cobrar mais a alguém por inferência de renda ou perfil pessoal. Preço de pacote/contrato já vendido fica protegido.

Entradas: base, piso do profissional, custo estimado do serviço, taxa percentual, margem de contribuição alvo, faixa de horário e desconto máximo. Sem custos suficientes, sinalizar que o piso é manual e não equivale a rentabilidade comprovada.

```text
piso_economico = ceil(custo_estimado_centavos * 10000 /
                     (10000 - taxa_bps - margem_alvo_bps))
piso = max(piso_manual, piso_economico quando calculável)
desconto = min(desconto_regra, teto_aprovado)
preco_candidato = round_half_up(base * (10000 - desconto) / 10000)
preco_final = max(preco_candidato, piso)
```

Se denominador ≤0, rejeitar configuração. Se piso > base, bloquear oferta e pedir revisão; não elevar silenciosamente o preço. No piloto, uma regra ativa aplicável, prioridade explícita, sem empilhar cupons. Limitar desconto a teto configurado e respeitar mínimo. Arredondamento é implementado em inteiros/racionais com fixtures.

Exemplo hipotético: base R$100, custo estimado R$40, taxa 5%, margem de contribuição alvo 25%. Piso econômico = R$57,15. Com piso manual R$80 e desconto pedido de 30%, teto aprovado de 15% resulta em R$85. Tudo é mostrado antes de publicar. Não confundir contribuição com lucro líquido: faltam custos fixos, tributos e pró-labore conforme modelo.

Ocupação futura = minutos confirmados / minutos vendáveis na janela, excluindo pausas/bloqueios. Não contar holds como receita confirmada. Aviso “terça 40% ocupada” é cálculo; “27 clientes têm propensão” só pode ser segmentação simples identificada como tal, até existir modelo validado.

## Lista de espera e cancelamento

1. Cliente escolhe serviço, faixas de horário e canal autorizado.
2. Cancelamento libera capacidade e emite evento na mesma transação.
3. Worker seleciona elegíveis por compatibilidade, validade e ordem de entrada; desempate estável. Não prioriza maior poder aquisitivo inferido.
4. Criar hold exclusivo e cotação para uma pessoa de cada vez no piloto. Owner aprova a oferta, a menos que já exista política delimitada aprovada. Validade configurável, ex.: 15 minutos; expiração efetiva é o menor prazo entre oferta, cotação e hold.
5. Mensagem leva a página de aceite com valor e regras. Abrir link não reserva automaticamente.
6. POST de aceite valida prazo/token/versão e confirma hold atomicamente. Repetir retorna a mesma reserva.
7. Expiração libera hold; só então oferecer ao próximo. Se worker cair, a retomada não duplica oferta nem mantém slot bloqueado indefinidamente.

Uma oferta deve poder ser recusada, expirada, invalidada por mudança da agenda ou confirmada. Não disparar a vinte pessoas uma promessa de vaga garantida. Pode haver modo “primeiro a aceitar” depois, com linguagem explícita e sem vinte holds sobrepostos.

## Cancelamentos e créditos

Política simples por negócio: antecedência mínima, como reagendar, devolução de crédito. Exibir antes da contratação e guardar versão. Sem multa cobrada automaticamente na semana. No-show marcado pelo profissional, reversível com motivo. Consumir crédito no evento definido pela política (padrão: atendimento concluído), com estorno auditado.

## Como saber se funciona

Medir por negócio: slots vagos identificados; ofertas aprovadas; mensagens compartilhadas/enviadas; aceites; atendimentos realmente concluídos; receita/margem estimada; reclamações e opt-out. Não confundir clique com atendimento. Primeiras comparações devem preservar preço de contratos e evitar descontos a clientes que já comprariam aquele horário.

## Testes que bloqueiam o lançamento

Dez requests simultâneos para um slot: uma confirmação e nove conflitos. Dois aceites na mesma oferta: uma reserva. Reagendar para slot ocupado: reserva antiga permanece. Hold vencido: aceite negado e capacidade reaproveitável. Regra alterada após aprovação: nova aprovação. Cancelamento duplicado: um evento efetivo. Pacote consumido duas vezes: um débito. Alteração de timezone: instantes existentes preservados e novas regras explícitas.

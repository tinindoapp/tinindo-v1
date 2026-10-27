# ADR-0032 · Materiais e custos (P30)

Status: aceita · 2026-10-27 · integrador (sessão `claude-int-p30`, pedido do dono: "decida pelos docs")

## Contexto

O P30 pede produtos e consumíveis, compras, uso por serviço e margem real, com o aceite: "consumo e estorno não duplicam estoque; conta não depende de texto livre do agente". O P02 já tem `estimated_cost_cents` por serviço (estimativa digitada); o P07 tem despesas append-only com estorno; o P11 tem orçamentos com itens por serviço. Não é ERP: sem lote, validade, fornecedor cadastrado, nota de entrada ou revenda com baixa no Caixa.

## Decisões

1. **Razão append-only + saldo cacheado no item.** `material_movements` registra toda entrada e saída (compra, consumo, ajuste, estorno), com quantidade e valor com sinal. `material_items.on_hand` e `stock_value_cents` mudam só junto com um movimento, sob `FOR UPDATE` do item. Todo comando trava os itens em ordem de id, então não há deadlock nem atualização perdida. O teste de concorrência confere que saldo e valor batem com a soma do razão.
2. **Custo médio ponderado, em centavos inteiros.** A compra entra pelo valor pago. A saída sai por `round(valor × qtd / saldo)`; a última unidade leva o valor restante, de modo que valor e quantidade zeram juntos (CHECK). Quantidades em `numeric(14,3)` (até 3 casas: ml, g, un). Estoque negativo é proibido por CHECK, e a falta de estoque recusa o comando inteiro (`POLICY_REJECTED`, campo `stock`).
3. **Consumo por atendimento concluído (P03), tudo ou nada.** `materials.consume` usa a ficha do serviço (`material_service_usage`) ou as quantidades informadas. Cabeçalho `material_consumptions` com índice único "um ativo por atendimento": repetir com outra chave dá `POLICY_REJECTED/consumed`, e repetir com a mesma chave devolve a mesma resposta. Só atendimento `completed`. Reservas da equipe (P28) ficam para depois.
4. **Estorno exato, uma vez.** O estorno do consumo devolve cada item pelo valor com que saiu (`reversal_of` único) e marca o cabeçalho como `reversed`; depois disso o uso pode ser registrado de novo. O estorno da compra tira cada linha pelo custo médio atual, exige saldo (com parte já usada, é recusado) e estorna a despesa do Caixa vinculada.
5. **Compra e Caixa.** A compra pode registrar a despesa (P07, categoria `supplies`) na mesma transação (padrão ligado na tela). Estoque é valorização; Caixa é dinheiro. Os dois não se misturam: o consumo não lança despesa.
6. **Margem real com cobertura.** `materials.margin` soma, por serviço, a receita combinada (`agreed_price_cents`) dos atendimentos concluídos e o custo dos materiais efetivamente consumidos. A margem é calculada só sobre os atendimentos com consumo registrado (`covered_revenue_cents`), e os demais aparecem como não cobertos, nunca como custo zero. Não é DRE (P31): não inclui taxa, comissão nem rateio.
7. **Custo do orçamento (P11), só leitura.** `materials.quote_cost` estima o custo de materiais da versão atual pela ficha × quantidade × custo médio atual e diz quais linhas estão cobertas. Não muda o orçamento nem o preço.
8. **Nada vem de texto livre.** Todas as contas usam fichas, quantidades e o razão. O motivo do ajuste é texto do dono: fica fora da auditoria e da leitura direta (coluna sem grant).
9. **Acesso só do dono**, RLS só do dono e RPCs `security definer` com `app.mt_owner` primeiro, como no P20.

## Consequências

- Inventário físico: o ajuste informa a quantidade contada. Uma sobra entra pelo custo médio atual, ou com custo zero se o item está sem saldo.
- Venda de produto ao cliente (revenda) ainda não baixa o estoque pelo Caixa; hoje o dono ajusta a contagem. Ligar a venda ao recebível é uma expansão.
- `estimated_cost_cents` do serviço (P02) continua como estimativa manual; a margem real e o custo do orçamento usam o razão.

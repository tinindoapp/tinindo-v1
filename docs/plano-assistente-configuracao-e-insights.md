# Plano · Assistente de configuração, insights e camada de linguagem

Pedido do Felipe em 03/11/2026: um agente que ajude o profissional a configurar o negócio ao entrar, que dê dicas e insights ao longo do uso, e que sirva a outros fluxos. Este documento diz o que já existe, o que falta e como entregar em três pacotes.

## 1. O que já existe

| Capacidade | Onde | Limite de hoje |
|---|---|---|
| Assistente do dono que responde sobre agenda, caixa e clientes e propõe ações com aprovação | P08, `/app/assistente` | Só reage a perguntas; entende um conjunto fixo de frases; sem LLM (ADR-0012 §1) |
| Sugestões mensais com evidência e acompanhamento em 30 dias | P22, `/app/metas` | 5 regras fixas; só sobre indicadores do P18; aparecem numa tela secundária |
| Onboarding mínimo (objetivo e política de cancelamento, presets por profissão) | P01, `/app/conta` | Não guia o resto da configuração: serviços, expediente, primeiro cliente, link público |
| Tela "Hoje" com pendências e até três ações | Home | Ações vêm da agenda e do caixa; nada sobre configuração nem sobre oportunidades |
| Serviços assistidos por pessoa (implantação) | P15 | Humano, pago, sob pedido |
| Previsão e otimização (demanda, cancelamento, teste de preço) | P32 | Planejado para a F5; depende de histórico |

**Conclusão:** não há nada que pegue o profissional pela mão no primeiro dia, e os insights existem mas ficam escondidos e cobrem poucas situações. A camada de linguagem (LLM) nunca foi ligada: é a decisão pendente desde o P08.

## 2. Princípios (docs/05, ADR-0012, P22)

1. Regra calcula, modelo redige. Nenhum número vem do modelo. Tudo passa pelas ferramentas, propostas e aprovações já existentes.
2. Funciona sem provedor de LLM. O modelo melhora a conversa; não é pré-requisito de nenhuma função.
3. Nada muda sozinho. Configuração sugerida é rascunho até o dono confirmar. Insight vira ação só com aprovação.
4. Toda sugestão cita a evidência: período, número e denominador, e diz o que falta nos dados.
5. Dado de um negócio nunca vira contexto de outro. Para o modelo vai o mínimo: nunca telefone, e-mail ou documento de cliente.
6. Custo por negócio com teto (a franquia do P08/P15 já existe) e registro sem PII.

## 3. Os três pacotes

### P44 · Configuração guiada ("Deixe seu negócio pronto")

Determinístico. Sem dependência externa. Primeiro a entrar.

- **Estado de configuração calculado pelos dados reais** (`setup.progress`, leitura no servidor): expediente definido; pelo menos um serviço com duração e preço; política de cancelamento; primeiro cliente; perfil publicado com link de horários; foto e WhatsApp (opcional); canal verificado; caixa com primeiro registro. Cada passo tem `done`, `why` e um link profundo para a tela que resolve.
- **Cartão na Home** "Deixe seu negócio pronto · 3 de 8", com o próximo passo em destaque. Some quando tudo estiver feito; o dono pode dispensar passos opcionais.
- **Modelos por profissão**, aprovados por migration, como o `content_templates` do P22: barbearia (Corte, Barba, Corte e Barba, com durações e faixas de preço típicas), cabeleireira (Corte, Escova, Coloração, Hidratação), personal (Avaliação, Sessão individual, Pacote de 10). Aparecem como sugestão marcável; nada é criado sem confirmação. Preço sugerido vem de faixa, nunca de "média de mercado" inventada.
- **"Descreva seu negócio em uma frase"** (docs/12): "sou barbeiro, sozinho, de terça a sábado das 9 às 19". Um analisador por regras (dias, horários, profissão, quantidade de pessoas) preenche o rascunho do expediente, da profissão e dos serviços sugeridos; o dono revisa cada campo antes de salvar. Quando o P46 entrar, o modelo faz a leitura de frases mais livres e devolve o mesmo rascunho estruturado, validado pelo contrato.
- **Dicas no lugar certo**: cada tela principal ganha um estado "ainda não configurado" com uma frase e um botão (já há padrão de estado vazio da onda 2). Não é chat.
- **Medição**: evento `setup.step_completed.v1` com o passo e o tempo desde o cadastro; indicador "negócios prontos em 24 h" no P18.

Aceite: um negócio recém-criado chega ao link público publicado em menos de 10 minutos, só pela Home, no celular; nenhum serviço, horário ou preço é gravado sem confirmação; pgTAP de isolamento; e2e da jornada completa.

### P45 · Insights proativos ("Para você esta semana")

Generaliza o motor de regras do P22 e o traz para a Home. Sem dependência externa.

- **Motor de regras** (`app.insight_rules`, SQL versionado por migration), rodando no `jobs` uma vez por dia por negócio. Cada regra devolve: código, título, evidência (números com período e denominador), ação sugerida (operação existente + payload de proposta), prioridade e validade.
- **Regras iniciais**, cada uma ligada a um fluxo que já existe:
  | Regra | Evidência | Ação proposta |
  |---|---|---|
  | Horário ocioso recorrente | mesma faixa vazia em 4 das últimas 5 semanas | regra de preço (P05) para a faixa, como proposta |
  | Clientes sem retorno | clientes com 2+ atendimentos e nenhum há mais de N dias (N por serviço) | mensagem de retorno (P13), rascunho para aprovar |
  | Atendimentos sem cobrança | já existe no P22; passa para cá | abrir o caixa nos atendimentos |
  | Faltas concentradas | faltas acima da média num dia ou cliente | lembrete (P13) ou antecedência da política |
  | Lista de espera com gente e cancelamento recente | vaga aberta e pessoas esperando | oferta (P06) |
  | Serviço abaixo da margem | custo de materiais (P30) acima de X% do preço | revisar preço (P05) |
  | Pacote perto de vencer | créditos a vencer em 15 dias | mensagem ao cliente (P13) |
  | Perfil incompleto | sem foto, sem preço, sem canal | passo do P44 |
  | Mês fechando | recebido, a receber e despesas do mês com cobertura | resumo (P07/P31), sem ação |
- **Na Home**: até 3 insights, ordenados por prioridade, cada um com "Ver" (abre a proposta ou a tela) e "Agora não" (silencia por 30 dias). Lista completa em `/app/metas`, que passa a se chamar "Metas e sugestões".
- **Acompanhamento**: reaproveita o `advice_decisions` do P22 (decisão, indicador congelado, medição em 30 dias, sem causalidade).
- **Resumo semanal**: texto por modelo fixo, disponível na caixa de mensagens do dono (P12) e, quando o e-mail estiver ligado (recado #75), por e-mail opcional.

Aceite: nenhuma regra dispara sem dado suficiente (`insufficient` ≠ zero); nenhuma ação executa sem aprovação; cada insight mostra período e denominador; pgTAP por regra com casos positivo, negativo e insuficiente; concorrência do job (duas rodadas → um insight); e2e da Home.

### P46 · Camada de linguagem (LLM)

Liga o provedor nos pontos que o ADR-0012 §1 deixou prontos. Depende da decisão de provedor, chave e termos de dados (pendência D do jurídico).

- **Adaptador de provedor** em `_shared/llm/` com uma interface só (`complete({system, input, schema})`), saída estruturada validada por zod, tempo máximo, retentativa única e `provider: none` como padrão. Chave no secret store do Supabase; nunca no bundle.
- **Onde o modelo entra**, nesta ordem de valor:
  1. **P08**: entender pedidos livres ("marca a Maria quinta de manhã que nem da outra vez") → intenção e argumentos → as mesmas ferramentas e propostas. O texto de resposta continua vindo dos modelos fixos com os números das ferramentas.
  2. **P44**: a frase do negócio em linguagem livre → rascunho estruturado.
  3. **Redação**: mensagens do P13, bio do perfil e textos de campanha no tom do dono, a partir de um rascunho aprovado. O dono edita antes de enviar.
  4. **Explicação de insight** em uma frase simples, a partir da evidência calculada.
- **Configuração em conversa**: no `/app/assistente`, "Me ajuda a configurar" conduz pelos passos do P44 (o estado vem de `setup.progress`), um por vez, e cada confirmação grava pelas operações normais.
- **Segurança e custo**: para o modelo vão só os campos necessários; nomes de clientes viram rótulos ("cliente 1") quando a tarefa permite; nunca telefone, e-mail ou documento. A franquia do P08 cobre as chamadas. Os 40 casos de avaliação ganham variantes em linguagem livre e os critérios fortes continuam (zero ação proibida, zero vazamento, valores corretos em 100% dos casos determinísticos). Registro sem texto da conversa.
- **Decisões do fundador antes de começar**: provedor e modelo; orçamento mensal; DPA e cláusula de não treinamento; texto na política de privacidade (pendência D); região e retenção do provedor.

Aceite: com `provider: none`, tudo do P44 e do P45 funciona igual; com provedor, as avaliações passam; um provedor fora do ar devolve a resposta determinística, não erro.

## 4. Ordem e esforço

| Ordem | Pacote | Depende de | Esforço estimado |
|---|---|---|---|
| 1 | P44 | nada | 1 sessão longa (6 h) |
| 2 | P45 | P44 (passo "perfil incompleto"), P22 | 1 sessão longa (6 h) |
| 3 | P46 | decisão de provedor + chave | 1 sessão longa, depois de P44 e P45 |

P44 e P45 podem rodar em paralelo se as áreas ficarem separadas: P44 em `src/features/setup/` e `supabase/functions/setup/`; P45 em `src/features/growth-advice/` (estende o P22) e no `jobs`. A Home é do integrador; cada pacote entrega o cartão como componente e o integrador liga.

## 5. Fora deste plano

- Recepção automática para clientes pelo WhatsApp (docs/05, "Recepção do profissional"): depende do canal oficial e de elegibilidade com a Meta.
- Previsão de demanda e teste de preço (P32): precisa de meses de histórico.
- Qualquer ação autônoma sem aprovação.

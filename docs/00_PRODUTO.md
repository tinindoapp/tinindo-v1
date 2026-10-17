# 00 · Produto e modelo de negócio

## A empresa que estamos construindo

Tinindo entrega trabalho de operação e crescimento para profissionais de serviço. O prestador compra organização do negócio, menos faltas, oportunidades de preencher horários e clareza sobre recebimentos. Software, IA e serviço humano são meios de entregar esses resultados.

A formulação comercial recomendada é **“uma equipe digital para cuidar do seu negócio de serviços”**. “Service as Software” é uma tese operacional interna, não uma obrigação de esconder a agenda ou obrigar toda ação a passar por conversa. Um calendário é melhor que texto para escolher entre vinte horários; uma conversa é melhor para pedir “me mostre quem pode voltar nesta semana”.

Há três ofertas relacionadas, com economia própria:

| Oferta | Entrega | Receita | Momento |
|---|---|---|---|
| Operação Tinindo | Agenda, clientes, caixa e agentes delimitados | Assinatura por negócio + franquias de uso | Agora |
| Implantação e presença | Importação assistida, página, organização inicial e Google | Serviço com escopo/preço separado | Agora, manual e limitado |
| Rede Tinindo | Perfil, indicação, reputação e descoberta | Freemium; monetização de demanda validada depois | Perfil no piloto; marketplace local na fase 3 |

Não prometer agenda cheia, renda garantida, posição no Google ou retorno financeiro causal antes de ter evidência. Site profissional próprio pode ser um serviço rentável, mas não deve transformar a equipe de produto em fábrica ilimitada de sites por R$79.

## Cliente inicial por comportamento

Obrigatoriamente incluir cabeleireiros, barbeiros e personal trainers da rede dos fundadores. Selecionar pessoas com agenda semanal ativa, pelo menos alguns clientes recorrentes, preços conhecidos e disposição para operar parte da semana na Tinindo. Começar com 6–10 profissionais; ampliar para 50 após passar os controles de lançamento.

Hipótese operacional para teste, não dado de mercado: 40–200 atendimentos/mês, atendimento individual, pagamentos majoritariamente fora do aplicativo, comunicação pelo WhatsApp e agenda fragmentada. Evitar inicialmente salões com múltiplas cadeiras/assistentes simultâneos, turmas de treino, hospitais, atendimento infantil e grandes equipes externas.

| Particularidade | Beleza/barbearia | Personal trainer |
|---|---|---|
| Agenda | Serviços de durações diferentes | Sessões recorrentes e horários reservados |
| Preço | Tabela avulsa + oferta de horário ocioso | Pacote/crédito de sessões; não reprecificar contrato vendido |
| Reposição | Lista de espera por serviço e faixa de horário | Reposição, reagendamento e renovação do pacote |
| Local | Estabelecimento fixo | Local fixo ou buffer manual de deslocamento |
| Dados | Preferências de atendimento | Apenas operação; sem prontuário, lesões ou prescrição |

## Trabalho central e métrica

Primeiro trabalho: **transformar a agenda em um fluxo completo de atendimento, retorno e recebimento**. A sequência operacional é cliente → serviço → horário/preço → confirmação → atendimento → recebimento → retorno/indicação.

Métrica principal inicial: profissionais que completam esse ciclo na semana com dados reais. Complementos: vagas recuperadas, margem estimada das ofertas, recebíveis atualizados, minutos de administração relatados e retenção semanal. Tempo de tela não é sucesso.

Receita de reserva com oferta não é automaticamente receita incremental. Registrar `source`, `offer_id`, preço original, preço aceito e grupo elegível. Comparar horários semelhantes ou usar pequenos grupos de controle voluntários. Tempo poupado começa como estimativa explícita, validada por diário de uso; não inventar “2 horas economizadas” porque houve dez chamadas de ferramenta.

## Contrato de escopo do piloto de sete dias

**Operacional de verdade:** login, negócio isolado, serviços e clientes, disponibilidade, criação/reagendamento/cancelamento, preço congelado, bloqueio de conflito, ofertas por regras aprovadas, lista de espera com aceite seguro, créditos de sessões simples, registro de recebido/a receber, perfil compartilhável, convite de colega e assistente web com ferramentas limitadas.

**Assistido e claramente identificado:** importar CSV, compartilhar mensagem pelo WhatsApp pelo próprio prestador, configurar horários/custos, suporte de fundador.

**Sandbox se houver tempo:** adaptador oficial WhatsApp, pagamento teste e emissão fiscal teste. Devem exibir “simulação” e jamais gerar prova falsa de pagamento/nota/envio.

**Depois:** WhatsApp integrado por negócio, campanhas em escala, Google Calendar bidirecional, cobrança Pix por PSP, conciliação, NFSe, Google Business automatizado, marketplace de busca amplo, app iOS, roteirização, previsão de demanda, múltiplos recursos, produtos/estoque, escola e equipes próprias.

O piloto de uma semana é plausível se P00 ocorrer no primeiro dia, as credenciais de infraestrutura existirem, houver dois donos disponíveis para revisar e o recorte se mantiver. Não é uma previsão garantida. Falhas de isolamento ou de reserva impedem abertura, independentemente da data.

## Monetização e canais

Preservar a promessa pública já divulgada: plano gratuito e Completo a R$79/mês de fundador por 12 meses, com serviços humanos separados. Não aumentar preço retroativamente para quem aderiu a esses termos. Definir franquias claras antes de ativar cobrança; testar planos posteriores com novos clientes, sem inventar disposição a pagar.

Grátis: perfil e gestão básica suficiente para experimentar. Pago: automações, assistente, ofertas, recuperação de agenda e relatórios. Não bloquear exportação básica nem condicionar reputação ao plano pago. Inicialmente cobrar assinatura manualmente/por link externo, com entitlement controlado no backend; gateway de assinatura não bloqueia validação de produto.

Aquisição inicial: convites pessoais dos fundadores; profissionais convidam colegas pelo ganho de organização; clientes convidam profissionais pela recomendação. Separar esses mecanismos nos dados e na comunicação. Condomínio é canal de aquisição e comunidade, não um tenant que possa ler a agenda ou finanças de seus prestadores.

## Ciclos de indicação

1. **Cliente indica um profissional:** cria recomendação privada/pending, informa categoria e nome, recebe link para compartilhar pessoalmente. O profissional confirma contato e decide publicar. O telefone fornecido por terceiro não dispara marketing automático.
2. **Profissional convida colega:** atribuição de aquisição, sem nota, qualidade ou aumento artificial de ranking. Recompensa eventual só após ativação real; limitar autoconvite/fraude.
3. **Avaliação de atendimento:** nota escolhida pelo cliente, autoria validada e moderação. Uma recomendação externa não recebe selo de atendimento verificado. Não pré-selecionar cinco estrelas.

O futuro diferencial pode vir da relação entre capacidade real, disponibilidade, reputação legítima e demanda local. O diretório sozinho e o chat com IA são copiáveis. A hipótese de vantagem precisa ser demonstrada com dados de uso e distribuição, não tratada como moat já existente.

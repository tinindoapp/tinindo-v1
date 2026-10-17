# 12 · Site e experiência

## Diagnóstico do site atual

Observado em 17/10/2026, sem login. A página é limpa, com preto, branco e laranja, e explica entregas humanas. Hero: “Mais clientes, dinheiro organizado e menos papelada.” A seção de soluções começa por site/Google; preços dão destaque aos serviços da equipe; assistente aparece como preparação de mensagens. Existe login em `/cliente/` e chamada de plano grátis.

Conclusão: a comunicação transmite apoio à pequena empresa, mas ainda não evidencia o diferencial de um agente que executa tarefas de agenda, retorno, preço e caixa. A ênfase residencial/eletricista também não representa claramente os barbeiros, cabeleireiros e personais obrigatórios do piloto. Não é necessário redesenhar tudo para corrigir isso.

## Mudanças pequenas, de alta prioridade

1. Hero com promessa operacional: **“Seu serviço bem-feito. Seu negócio tinindo.”** Sub: “Organize clientes, agenda e recebimentos. A Tinindo ajuda a recuperar horários vagos, preparar ofertas e cuidar da rotina com você.” Só chamar de IA onde funcionalidade está disponível ou identificada como piloto.
2. CTA principal “Quero testar no meu negócio”; secundário “Conheça a Tinindo em 1 minuto”. Manter diagnóstico como caminho secundário, não obstáculo para experimentar.
3. Uma demonstração concreta: “Terça tem dois horários livres. Preparar uma oferta?” → preview de preço/público → aprovação → resultado. Exemplo sintético rotulado.
4. Explicitar três públicos sem três apps: “Sou profissional”, “Quero encontrar/indicar alguém”, “Quero ajuda para implantar”. Se busca ainda não existir, convidar a acompanhar, não abrir diretório vazio como produto maduro.
5. Mostrar beleza/barbearia e personal entre os exemplos; manter serviços residenciais como expansão.
6. Separar “Agentes e ferramentas” de “Serviços executados pela equipe”, com escopo/preço próprios e status de disponibilidade.
7. Incluir “Indique um colega” no onboarding e após primeiro valor, não a cada login. Cliente pode “Indicar um profissional” por link compartilhável sem envio automático ao indicado.
8. Corrigir privacidade provisória e validar afirmações fiscais/datas com responsável antes de mantê-las como banner; não tratar copy legal como fonte técnica do produto.

## Navegação do app

Home “Hoje” com próximos atendimentos, pendências e até três ações úteis. Navegação: Hoje, Agenda, Clientes, Dinheiro, Assistente; configurações e perfil em menu secundário. Ofertas e lista de espera aparecem no contexto da agenda, sem exigir navegar por dez módulos. Mobile web é prioridade desde a primeira entrega.

Onboarding ideal: profissão → horário/local → 1–3 serviços/preços → primeiro cliente/reserva → link público. Custos/margem, política de cancelamento, importação e canal vêm progressivamente. A frase “sou barbeiro, sozinho, terça a sábado” pode preencher um rascunho; usuário confirma horários/preços antes de publicação. Sem wizard de 30 campos.

Dia 1: criar primeira reserva em minutos e verificar o que aparece para o cliente. Semana 1: acompanhar agenda, concluir atendimento, registrar recebido, convidar retorno. Se dados faltam, mostrar a lacuna e a próxima ação. Não inventar gráficos positivos em conta vazia.

## Direção visual

Preservar marca existente; não fazer rebranding durante o bootstrap. Tipografia clara, espaçamento, estados bons, feedback de salvamento e contraste. “Liquid glass” apenas em superfícies secundárias se não reduzir leitura; números, horários e aprovações precisam ser opacos e inequívocos. Movimento respeita `prefers-reduced-motion`. Alvo de acessibilidade WCAG AA como critério de produto, a validar.

Toda ação irreversível ou que afete terceiros exibe destinatários, valor, horário e consequência. Mensagem do agente deve diferenciar “preparei”, “aguardando aprovação”, “executando”, “concluído”, “falhou” e “resultado desconhecido”. Botão de aprovação não pode virar sucesso antes da confirmação do servidor.

## Portais

Profissional e cliente podem usar o mesmo frontend com rotas e permissões distintas. Cliente acessa perfil, disponibilidade e própria reserva por link seguro, com conta progressiva quando útil. Não obrigar cada cliente a instalar um app para agendar. No futuro, a mesma identidade poderá encontrar outros profissionais, mas os CRMs continuam separados.

## Complemento da reconciliação

Usar quatro jornadas do Gabriel: Ser encontrado, Converter contatos, Agenda organizada, Financeiro digital. Marcar claramente disponível / serviço assistido / piloto. Perfil público não é website personalizado. Agendamento web compartilhado não é recepcionista WhatsApp. Orçamento com aceite só anunciar pronto se P11 ou código existente auditado funcionar. Free/R$79 e serviços adicionais devem ter limites visíveis.

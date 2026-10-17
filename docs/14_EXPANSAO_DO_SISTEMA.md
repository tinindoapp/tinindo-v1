# 14 · Arquitetura de expansão

Este capítulo explica as extensões da arquitetura; o mapa oficial de fases e pacotes está no doc17. As macrofases não ativam tarefas automaticamente. O integrador detalha contratos, arquivos e aceite antes de incluir novos IDs no manifesto. O coordenador avança por ondas concluídas, que podem reunir pacotes de mais de uma macrofase. P00–P41 são os IDs do programa atual; não reutilizar um ID para trabalho diferente.

## Um core compartilhado, configurações por operação

O core horizontal possui identidade, negócio, cliente, catálogo, disponibilidade, atendimento, preço, recebível, pagamento, consentimento e auditoria. Configuração vertical seleciona defaults, rótulos, políticas, KPIs e fluxos; não troca regras de autorização nem esquema arbitrariamente.

| Arquétipo | Reutiliza | Extensão real |
|---|---|---|
| Horário individual, beleza | Serviço, duração, cliente, booking, preço e retorno | Recursos/cadeiras e comissão de equipe quando necessários |
| Sessões recorrentes, personal | Booking, cliente, recebíveis e comunicação | Créditos, reposição, pacote, recorrência e renovação |
| Visita externa | Booking, cliente, preço, orçamento | Área, endereço protegido, deslocamento e janela de chegada |
| Projeto/orçamento, marceneiro | Cliente, catálogo, proposta e recebíveis | Etapas, dependências, sinal, materiais e prazo de projeto |
| Serviço recorrente residencial | Booking e cobrança | Contrato periódico, rota e checklist de execução |

Não modelar um projeto de três semanas como se fosse um corte de 30 minutos. Compartilhar primitivas é útil; forçar semântica igual não é. JSONB pode guardar configuração validada por schema, não um ERP inteiro escondido em um campo.

## Fase 2 · canais e operação, semanas 2–6

| Bloco | Entrega | Dados/contratos novos | Gate |
|---|---|---|---|
| F2-01 · Canal oficial | Pareamento do dono; integração de um negócio por vez | `channel_connections`, `channel_identities`, inbox, delivery receipts | Elegibilidade, consentimentos, templates, credenciais e escalonamento |
| F2-02 · Automação | Lembretes, retorno e preenchimento sob política | `automation_policies`, versionamento, frequency caps | Aprovação delimitada, opt-out, budget e kill switch |
| F2-03 · Cobrança | Link Pix/boleto/cartão via PSP, pagamento confirmado | `charges`, provider references, inbox, reconciliação | Webhook autenticado, idempotência, estorno e falhas testados |
| F2-04 · Planos | Assinatura Tinindo, franquias e medição | subscription, entitlement, usage ledger | Limites aplicados no backend e cancelamento compreensível |
| F2-05 · Implantação | Importação com mapa/erros; onboarding assistido | import batches, row errors, service orders | Sem importação duplicada ou PII em suporte |
| F2-06 · Presença digital | Página gerada de dados publicados e serviço Google | profile revisions, publishing jobs, delivery checklist | Aprovação da publicação e propriedade do profissional |

Ordem: identidade/canal → inbox/outbox → mensagens limitadas → automação. Cobrança entra sobre financeiro confiável; não começar pelo checkout enquanto a baixa manual ainda duplica. Cada bloco pode andar com outra frente se contratos e ownership forem definidos. Deploy das credenciais e aprovação do canal são serializados.

### Site do profissional como produto padronizado

Primeiro produto: página própria em rota da Tinindo, com serviços, fotos autorizadas, área, horários, CTA e marca do profissional. Gerada por template seguro a partir de dados estruturados. IA sugere texto, usuário aprova. Sem HTML/JS arbitrário, plugins por cliente ou builds separados por profissional.

Domínio próprio e SEO indexável entram com verificação de propriedade, canonical, sitemap, metadados, velocidade e geração estática/SSR apropriada. O SPA privado não precisa de SEO; o diretório e os perfis públicos precisam. Adicionar camada pública renderizada quando essa fase começar, sem reescrever o backend. Não prometer que páginas vazias por cidade produzirão tráfego qualificado.

Serviço humano de Google usa fila interna de entregas: solicitado → proposta aceita → em execução → pendência do cliente → entregue. Um operador registra checklist e tempo. Isso mede margem do serviço, em vez de esconder horas humanas dentro do custo de IA. Acesso a contas do profissional usa delegação oficial e privilégio mínimo, não coleta de senha no chat.

## Fase 4 · descoberta, reputação e comunidade

Separar quatro objetos: `public_profile` (o que o profissional publica), `recommendation` (indicação), `review` (avaliação de experiência) e `verification` (verificação com escopo e evidência). Contagem de convites não é avaliação de qualidade. Identidade verificada não significa competência certificada.

Busca inicial filtra categoria, área de atendimento, disponibilidade publicável e status do perfil. Ranking deve ser explicável: adequação à consulta, distância/região, disponibilidade, evidência de avaliações e confiabilidade operacional, com controle contra manipulação. Evitar ordenar só pela média de estrelas, que privilegia 5,0 com uma avaliação frente a 4,9 com centenas. Ponderação e critérios entram em documento público e testes; não fazer alegação de precisão que não existe.

Fases de implementação:

1. F4-01: perfis consentidos e busca local em uma comunidade com oferta suficiente.
2. F4-02: avaliações, vínculo à reserva quando houver, moderação, denúncia, direito de resposta e antifraude.
3. F4-03: solicitações/matching, prazo de resposta, proposta e disponibilidade real.
4. F4-04: medição de aquisição e eventual monetização de lead/contratação, após testar fuga e satisfação.

Dados novos: `service_requests`, `matches`, `quotes`, `reviews`, `review_evidence`, `moderation_cases`, `verification_records`, `community_memberships` e `attribution_events`. Não criar tudo no piloto. Postgres com índices e busca textual/geográfica pode bastar inicialmente; search engine separada só com requisitos medidos.

Condomínio é comunidade de distribuição. Requer permissão para usar marca/canal da comunidade e controles sobre endereços. Morador não dá automaticamente ao síndico acesso aos seus pedidos privados. Pagamento de destaque, se existir, fica identificado como publicidade e separado da avaliação orgânica. Não vender “habilitado” com base só em assinatura paga.

## Fases 5 e 6 · operação avançada, mobile e escala

**Agenda avançada:** múltiplos recursos por atendimento, reservas simultâneas, capacidade de turma, dependências de espaço/equipamento e comissões. Agenda atual passa a reservar recursos em ordem estável para evitar deadlock. Regras de conflito são reavaliadas; não simplesmente retirar a exclusão de intervalos.

**Serviço externo:** geocodificação, estimativa de viagem, buffers probabilísticos e planejamento de rota. Guardar precisão necessária e finalidade de localização. Mostrar janela realista, não precisão falsa. Começar com sugestão de rota, aprovação e dados de trânsito confiáveis; não vender garantia de chegada.

**Inteligência de demanda:** histórico por serviço/horário, sazonalidade, cancelamento e efeito observado de ofertas. Avaliar baseline simples antes de ML; validação temporal e testes de intervenção. Modelo estima, motor de políticas limita e o proprietário decide. No-show prediction não deve servir para tratar pessoas injustamente nem autorizar overbooking sem uma operação capaz de lidar com excesso.

**Financeiro ampliado:** contas a pagar, categorias/competência, conciliação, provisões e demonstrativo gerencial. Somente chamar de DRE quando política de reconhecimento, custos e dados suportarem. Open Finance via parceiro, não conexão por senha. Exportação para contador antes de tentar substituí-lo.

**Fiscal:** escolher segmento/localidades e provedor primeiro; documentos fiscais, certificados, regime, status, cancelamento e rejeições são domínio próprio. Estado `requested` nunca é `issued`. Os custos e a responsabilidade não desaparecem porque a interface é conversacional.

**Mobile:** React Native/Expo ou nativo conforme necessidade efetiva, decisão por ADR. Reutilizar contratos e backend. Keychain/armazenamento seguro, deep links, notificações e revogação de sessão. Leitura offline pode ser cache; confirmar reserva exige resposta do servidor. Retry móvel usa a mesma chave idempotente. Não manter dois motores de preço em plataformas distintas.

## Fase 7 · formação, certificação e equipes

Formação por parceria tem catálogo de cursos, matrícula, conclusão e evidência de avaliação. Certificação identifica competência, emissor, validade, critérios e possibilidade de revogação. Não equivale a garantia universal de habilitação profissional; atividades reguladas precisam de verificação aplicável. Jovens entram com onboarding, mentoria e segurança, sem promessa de agenda cheia/renda garantida.

Equipes próprias introduzem alocação de pessoal, escala, materiais, responsabilidade por serviço, controle de qualidade, retrabalho, seguros e obrigações trabalhistas/contratuais. Isso muda o negócio, não é só habilitar um módulo. Separar P&L da operação própria, contratos e permissões; só expandir com economia demonstrada e governança apropriada.

## Backoffice Tinindo

Desde o piloto, uma console restrita permite ver integridade do sistema e atender solicitações. Ao crescer, acrescentar gestão de implantação, provedores, billing, moderação, incidentes e dados de avaliação agregados. Acesso aos dados privados de um tenant depende de suporte autorizado e auditoria temporária; um superadmin invisível permanente é um risco, não uma facilidade de produto.

## Decisões que preservam a expansão hoje

IDs estáveis, tenant explícito, catálogo versionado, slots/preços/recebimentos com semântica correta, consentimento por finalidade, eventos idempotentes, perfil público separado, adaptadores e APIs documentadas. Essas escolhas deixam espaço para a empresa crescer. Construir a escola, o marketplace nacional e o ERP antes do primeiro atendimento real não é requisito para preservar a visão.

## Complemento da reconciliação

Docs15–16 acrescentam operação assistida e rastreabilidade228. Pacotes concretos P11–P18 refinam fase2; IDs lógicos anteriores F2-xx são agrupamentos de roadmap, não tarefas concorrentes novas.

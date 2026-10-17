# 15 · Reconciliação com os mapas do Gabriel

> Atualização v2: a numeração oficial das macrofases está no documento17: F0–F7. As referências F3/F4/F5 antigas deste capítulo são históricas; usar a tabela de correspondência do doc17. P00–P18 preservam seus IDs. A atribuição de sócios neste capítulo era ilustrativa; o responsável real é definido na reserva.


Esta revisão incorpora integralmente a leitura de **Tinindo – Produtos** (34 páginas, 228 IDs) e **Tinindo – estratégia** (17 páginas, preparado em 21/09/2026). Os documentos são insumos de planejamento: suas estimativas e alegações externas não se tornam fatos verificados por serem reproduzidas aqui. O catálogo informa versão 2 com contribuições de 13/10/2026; a análise estratégica é anterior. A orientação atual dos fundadores prevalece sobre recomendações antigas.

## Conclusão executiva

A arquitetura anterior cobria o núcleo operacional, mas subespecificava a venda e a execução de serviços assistidos. Gabriel mapeou uma empresa que entrega agenda, presença digital, conversão e financeiro — com gente, automação e parceiros. Faltavam contratos claros para esse trabalho humano: pedido de serviço, escopo, acesso delegado, evidência da entrega, tempo gasto e limite comercial. A solução é acrescentar essa camada sobre o mesmo núcleo, não construir 228 aplicações.

Preservar o piloto web com barbeiros, cabeleireiros e personal trainers, preço por regras, lista de espera e caixa real. Usar as quatro jornadas do Gabriel para comunicação e expansão. Na primeira semana, executar uma jornada completa: **Agenda organizada**. Presença digital mínima é o perfil público compartilhável; website personalizado e gestão Google são entregas assistidas contratadas separadamente. Converter contatos e financeiro digital ampliam depois que os eventos reais existirem.

## O que já estava coberto e o que mudou

| Frente | Plano anterior | Ajuste desta revisão |
|---|---|---|
| Agenda, preços, fila, recorrência | Cobertura forte; invariantes e testes definidos | Mantidos no piloto; painel de ocupação e política de cancelamento explícitos |
| CRM e importação | Cobertos em P02 | Origem do contato e estágio comercial simples; sem pipeline completo na semana 1 |
| Pacotes de personal | Ledger de sessões em P07 | Mantido; diferenciar recebimento de consumo, preservar preço contratado |
| Assistente e ações aprovadas | Cobertos em P08 | Diferenciar assistente do dono e recepcionista do cliente; segundo depende de canal oficial |
| Site e Google | Previstos como serviço, sem operação detalhada | Perfil padronizado no piloto; pedido de serviço, entrega e medição de horas na fase 2 |
| Orçamento e follow-up | Insuficientemente especificados | P11 dedicado a orçamento versionado e aceite; P13 a follow-up e reativação |
| Cobrança, fiscal e pasta do contador | Financeiro básico e integrações futuras | Cobrança/recebimento/documento fiscal separados; P14 e P16 com gates próprios |
| Ofertas e planos comerciais | Free, assinatura e setup separados | Entitlements, quotas e serviço assistido definidos em P15; preservar promessa de R$79 já publicada |
| Diagnóstico, operação e metas | Métricas de produto previstas | Baseline do cliente, minutos humanos e evidência de resultado por jornada |
| Reputação e indicações | Perfil/convites no piloto, reputação depois | Google e reputação Tinindo separados; convite não gera avaliação nem qualidade comprovada |
| 17 áreas / 228 serviços | Roadmap geral, sem rastreabilidade integral | Anexo 16 preserva todos os IDs e dá destino sem transformar oportunidade em compromisso |

Não é honesto dar uma porcentagem única de “cobertura”: agenda web não equivale a recepcionista WhatsApp; caixa não equivale a contabilidade; página de perfil não equivale a website com domínio. A matriz identifica esses limites.

## Divergências que precisam ficar registradas

1. **Saúde versus beleza/fitness.** A estratégia recomenda saúde, ticket R$800–2.000 e validação de consultoria antes do produto. O briefing atual exige produto em uma semana e testes em beleza/fitness. A execução segue o briefing atual. Saúde fica fora, inclusive prontuários, anamnese e Receita Saúde. Personal trainer entra pela agenda e sessões, sem ficha clínica ou prescrições.
2. **Assinatura versus serviço assistido.** Não misturar os resultados dos dois modelos. Produto de R$79 não contém horas ilimitadas, site sob medida, marketing gerenciado ou fechamento contábil. Pacotes assistidos podem usar o mesmo software, mas têm contrato, capacidade e margem próprios. Testar apenas um pacote assistido inicialmente, com poucos clientes e horas registradas.
3. **P1 do catálogo não significa primeira semana.** Há 50 candidatos, não 50 compromissos. O próprio PDF põe NFS-e e follow-up entre as 12 ofertas iniciais, mas os classifica P2 na matriz. Lista de espera é P2 na matriz, porém requisito explícito do piloto atual. Neste kit, fase de construção é autoridade; IDs do catálogo são referências de oportunidade.
4. **Crescimento anterior não prova efeito do software.** Os casos narrados de Ana e Graça são relatos do documento, sem auditoria causal. Não usar “dobramos faturamento” como promessa atribuída à Tinindo. Medir baseline e intervenção.
5. **Regulação e tarifas.** As afirmações de mudanças fiscais, tarifa WhatsApp em outubro, franquias, exigência universal de certificado, ausência de API e regras profissionais requerem confirmação oficial para o caso concreto. Não codificar essas afirmações como constantes. O kit não adota preços por mensagem ou calendário fiscal desses PDFs como verificados.
6. **Mercado.** Aquisição, fechamento de capital ou redução de uma empresa não prova inviabilidade de todo marketplace. A inferência útil é testar densidade e economia local antes de expandir.
7. **Segurança não é produto opcional.** O catálogo pode vender adequação LGPD, backup e acessibilidade em fases futuras como serviços ao cliente. Privacidade, recuperação e acessibilidade básica da própria Tinindo são requisitos desde o piloto.

## As 12 ofertas, reconciliadas

| Oferta / ID Gabriel | Dia 7 | Próxima entrega e pacote | Dependência e evidência de aceite |
|---|---|---|---|
| Site com domínio · 050 | Perfil Tinindo publicado com autorização; sem domínio próprio | P17: página-template, domínio e checklist assistido | Perfil publicado, domínio verificado, SSL e retirada; não prometer posição no Google |
| Gestão Google · 048 | Serviço manual separado se já contratado; fora da sprint do app | P17: pedido, aprovação de conteúdo e evidência | Conta do cliente, acesso delegado e aprovação; API só após elegibilidade |
| Catálogo/pedidos WhatsApp · 068 | Lista de serviços no perfil; nenhum carrinho de produtos | P11: orçamento de serviços; catálogo de produtos fica fora do ICP | Distinguir serviço, orçamento e pedido; não chamar link de integração nativa |
| CRM · 065 | P02: cliente, histórico de agenda, importação e origem | Enriquecimento por eventos, sem coleta externa | Isolamento, dedupe assistido e histórico rastreável |
| Follow-up orçamento · 067 | Fora do fluxo automático | P11 orçamento → P13 follow-up via P12 | Aceite/recusa/cancelamento interrompe régua; dedupe e opt-out |
| Reativação · 057 | Segmento e mensagem sugeridos, compartilhamento manual | P13: campanha com autorização e orçamento de envio | Dados suficientes, destinatários elegíveis, template e limite de gasto |
| Agenda WhatsApp · 035 | P03/P04/P09: agenda real e link compartilhável | P12: canal oficial ligado aos mesmos comandos | Duas reservas disputam slot; só uma confirma; identidade validada |
| Confirmação/anti-falta · 036 | Lembrete preparado, envio manual identificado | P12/P13: jobs 24h/2h, configuráveis | Reagendamento cancela job antigo; status entregue só por evidência |
| Régua cobrança · 018 | P07: contas a receber e texto sugerido | P14/P13: PSP e cobrança controlada | Pagamento cancela pendências; webhook assinado e idempotente |
| NFS-e · 001 | Sem emissão real; nenhuma tela de sucesso fictícia | P16: uma modalidade/município elegível | Cadastro/representação validados, homologação, protocolo; nota não dá baixa no caixa |
| Simulador desconto/margem · 168 | P05: cálculo real, piso e aprovação | Evoluir custos e cenários após qualidade dos dados | Centavos, arredondamento, taxa/margem válidas e preço congelado |
| Resultado do mês · 023 | P07/P08: resumo do caixa registrado e cobertura | P18: demonstrativo gerencial quando houver classificação | Não chamar saldo de lucro nem DRE; mostrar faltas de dados e período |

## Quatro jornadas, um sistema

**Ser encontrado:** perfil público → eventual site/Google → origem do contato registrada. A Tinindo não garante busca, ranking ou novos clientes.

**Converter contatos:** contato → orçamento versionado → aceite → reserva condicionada à disponibilidade. Aceite comercial não cria capacidade inexistente.

**Agenda organizada:** reserva → confirmação → atendimento/cancelamento → fila/retorno. É a primeira jornada completa, com preço por regras e pacotes de sessões.

**Financeiro digital:** recebível → pagamento verificado ou registro manual identificado → documento fiscal separado → resumo com cobertura explícita. Execução fiscal e transferência de dinheiro não são permissões implícitas do agente.

Os eventos conectam as jornadas; não criar um CRM, uma agenda e um financeiro com clientes duplicados.

## Camada de prestação de serviços: o complemento estrutural

Distinguir `provider_services` (corte, sessão, atendimento) de `platform_offerings` (implantação, Google, assistência financeira). Não sobrecarregar a mesma tabela `services` para vender Tinindo e agendar o profissional.

Entidades propostas para P15/P17, sem implementar tudo em P00:

- `platform_offerings` e `offering_versions`: escopo, preço, quantidade, exclusões e SLA versionados.
- `subscriptions` e `entitlements`: recurso permitido, origem comercial e validade. Plano histórico não muda silenciosamente.
- `service_orders`: tenant contratante, oferta, versão aceita, responsável, prazo, status e referência da cobrança Tinindo.
- `work_items` e `work_logs`: tarefa, minutos efetivos, humano/automação, exceção e reprocessamento. Horas estimadas nunca passam por horas medidas.
- `deliverables` e `acceptances`: artefato, versão, aprovação, entregue_em e evidência. Aprovação de conteúdo não implica autorização para mudar DNS ou publicar.
- `access_grants`: operador, tenant, escopo, expiração, justificativa e trilha. Sem suporte com acesso global invisível.
- `usage_ledger`: execução, quantidade, custo estimado/real e chave de deduplicação; integração com quotas.

Fluxo: solicitado → escopo aceito → aguardando acesso → em execução → revisão do cliente → entregue; cancelado/bloqueado são estados próprios. Reabertura gera registro, não apaga histórico.

Semana 1: esse serviço assistido pode ser operado numa lista interna restrita, sem novo painel de backoffice. Não guardar credenciais em issues GitHub, planilhas compartilhadas ou mensagens de agente. Usar acesso delegado e cofre apropriado quando necessário. O painel de operação vem na fase 2, antes de ampliar a carteira assistida.

## Revisão dos pacotes da semana 1

Sem criar um décimo primeiro pacote na sprint. P00 fixa vocabulário, limites comerciais e eventos. P01 inclui diagnóstico operacional mínimo (profissão, horários, duração, política, objetivo), sem inventar score de maturidade. P02 guarda origem e importação. P04 mostra ocupação com denominador explícito. P05 entrega simulação. P07 separa recebido/recebível/crédito. P08 mostra limite dos dados e prepara mensagens. P09 entrega perfil-template, consentimento e compartilhamento. P10 testa jornada completa e registra minutos de onboarding/suporte.

**Orçamento formal com aceite (066) não estava suficientemente detalhado e não cabe disfarçado em “cadastro”.** Vai para P11, imediatamente depois do piloto. Uma cotação de preço/slot em P05 não é contrato comercial completo. Se o site oferece orçamento online como disponível e ainda não existe, rotular “em piloto” até o aceite real. Se já houver código funcional, preservar e auditar antes de duplicar.

As alterações tornam explícitos critérios já próximos do escopo. Não autorizam absorver website sob medida, CRM comercial completo ou fiscal na estimativa de 7 dias.

## Fase 2: pacotes adicionais executáveis

P11–P18 são expansão planejada, não tarefas liberadas no quadro do piloto. O integrador promove um subconjunto para o manifesto apenas após P10 e contratos aprovados. Não ativar os oito de uma vez. Estimativas são faixas iniciais em horas humanas com agentes; integrações externas têm espera adicional não controlada pela equipe.

| Pacote | Fronteira / liderança sugerida | Depende de | Aceite principal | Horas indicativas |
|---|---|---|---|---:|
| P11 · Orçamentos | sales / a definir na reserva | P01,P02,P05,P09 | Versão aceita imutável; aceite idempotente; reserva revalida slot | 8–16 |
| P12 · Canal oficial | messaging / a definir na reserva | P01,P06,P08 | Webhook validado; vinculação segura; envio/entrega distintos; humano assume | 16–32 |
| P13 · Ciclo de relacionamento | lifecycle / a definir na reserva | P11,P12,P06 | Réguas cessam por evento; público aprovado; opt-out e orçamento | 12–24 |
| P14 · Pagamentos | payments / a definir na reserva | P01,P07 | PSP sandbox, assinatura, dedupe, estorno e conciliação; não custodiar | 12–24 |
| P15 · Planos e operação assistida | service-ops / a definir na reserva | P01,P07,P08 | Escopo versionado, quotas, minutos, acesso delegado e entrega auditada | 12–24 |
| P16 · Fiscal seletivo | fiscal / a definir na reserva | P02,P07,P15 | Um caso homologado; credencial protegida; autorização, protocolo e erro tratado | 16–40 |
| P17 · Presença digital | presence / a definir na reserva | P09,P15 | Template, publicação aprovada, domínio e checklist; Google com acesso do cliente | 12–24 |
| P18 · Evidência de valor | analytics / a definir na reserva | P03,P07,P13,P15 | Baseline, dados faltantes, custo e horas; sem causalidade presumida | 8–16 |

Ordem recomendada: P11 + P12; depois P13 + P14 + P15 segundo capacidade; P16/P17 só com demanda contratada; P18 cresce junto à instrumentação. Fiscal básico sai da vaga “sofisticação” para experimento seletivo na fase 2, mas sem prometer cobertura nacional ou data fixa. Fiscal amplo permanece posterior.

Cada pacote mantém frontend próprio, função de domínio própria, propostas de migração em `db/proposals/Pxx/`, testes e handoff. Contratos, dependências e migrations aplicadas continuam exclusivos do integrador. Registro de handlers e eventos é central; um módulo não escreve tabelas privadas de outro.

## Economia: o que o catálogo acrescentou

Os cinco pacotes das pp.32–33 são **hipóteses**, não tabela comercial aprovada. O documento separa receita de capacidade, corretamente. Exemplo: agenda assistida a R$249 com 1,25h/mês por cliente implica 125h para 100 clientes. Financeiro assistido a R$1.190 com 10h implica 1.000h — aproximadamente 8,3 pessoas produtivas a 120h/mês. Não é a mesma empresa operacional que um produto autosserviço.

A receita por 1.000 clientes nas áreas não deve ser somada para projetar faturamento: há adesões hipotéticas, sobreposição, bundles e substituição entre ofertas. “107 serviços automáticos” é classificação do catálogo, não taxa comprovada de automação ponta a ponta.

Preço mínimo do serviço deve cobrir: horas reais + reserva de retrabalho + tecnologia + canal + aquisição/impostos/custos fixos e margem desejada. O cenário do catálogo usa R$60/h e 25% de reserva; o cenário inicial deste kit usa outras premissas. Não misturar os dois cálculos.

Decisão proposta: manter Free e compromisso fundador publicado; oferecer **implantação assistida com escopo fixo** separada; testar depois Agenda Assistida, começando por hipótese R$249 + setup R$690 do Gabriel, sem adotá-la automaticamente. Limitar clientes ao número de horas disponíveis. Não vender de saída os cinco pacotes.

## Métricas e critérios para continuar

- Ativação: profissional cadastra serviços e horários e conclui primeira reserva real; cronometrar onboarding.
- Uso operacional: atendimentos registrados / atendimentos reais estimados; dados incompletos impedem conclusões financeiras.
- Ocupação: minutos reservados confirmados / minutos vendáveis, por janela; bloqueios e duração explícitos.
- Faltas: no-shows / reservas elegíveis do período; excluir futuros e cancelamentos segundo definição publicada.
- Fila: ofertas aceitas / ofertas enviadas; não confundir aceitação com presença ou receita recebida.
- Resultado: receita registrada e custo evitado são observações; receita incremental exige controle ou desenho comparável.
- Eficiência: minutos humanos por cliente por semana, reprocessamento e custo de canal. Medir o trabalho dos fundadores também.
- Retenção: clientes continuam operando e aceitam pagar depois do teste; satisfação de amigos não substitui pagamento.

Gate da expansão: isolamento/concorrência/aprovação aprovados, fluxo usado por pelo menos um testador de cada categoria, falhas recuperáveis, nenhum débito crítico, capacidade de suporte medida. Aumentar até 50 em ondas. Não lançar ao público uma automação que depende de ações manuais ocultas.

## Fontes e limites desta reconciliação

Produtos: pp.1–3 (12 ofertas), pp.3–6 (17 áreas), pp.7–31 (matriz), pp.32–34 (pacotes/capacidade/premissas). Estratégia: §§1,4,5,7,8 (problemas, opções, vertical, escopo e testes), §§6,10 (infra e incertezas). Anexo16 indexa os 228 IDs da matriz. Fontes técnicas verificadas anteriormente estão em docs/13; não são validação automática de toda afirmação regulatória ou comercial desses PDFs.

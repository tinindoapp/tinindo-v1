# 05 · Agentes como serviço

## Um orquestrador, ferramentas específicas

O cliente pode perceber secretária, assistente financeiro e assistente comercial. Internamente começar com um orquestrador e capacidades delimitadas, não uma sociedade de agentes autônomos conversando indefinidamente. Cada habilidade declara dados necessários, permissão, ferramenta, custo, aprovação e recibo esperado.

Fluxo: observar dados/eventos → calcular por ferramenta → recomendar → mostrar aprovação quando exigida → executar comando → registrar resultado → medir. LLM interpreta pedido, redige e explica. Regras de negócio continuam funcionando se o provedor LLM estiver indisponível.

## Catálogo progressivo

| Capacidade | Semana 1 | Autonomia posterior |
|---|---|---|
| Informar agenda/recebíveis | Consultas autorizadas com período e fonte | Autônoma em leitura |
| Analisar ocupação | Cálculo determinístico de minutos vendáveis | Rotina diária |
| Recomendar preço/oferta | Regra, piso e simulação | Recomendar; não publicar sozinho |
| Criar mensagem | Rascunho com nome/horário validado | Automação sob política |
| Executar agendamento | Preview + aprovação + transação | Só pedidos inequívocos e dentro de política |
| Preencher cancelamento | Detectar, selecionar elegíveis e preparar oferta | Envio limitado e aceites atômicos |
| Cobrar pendência | Rascunho, sem assumir inadimplência | Após dados conciliados e política |
| Resumo financeiro | Entrou, saiu, falta receber e cobertura | Autônomo em leitura |
| Emitir nota | Indisponível; informar limitação | Após integração fiscal validada e aprovação |
| Movimentar dinheiro | Indisponível | Projeto separado, não consequência de ter chat |

## Memória e contexto

- Configuração do negócio: profissão, horários, serviços, política de cancelamento e tom. Dados estruturados versionados.
- Histórico operacional: consultas ao banco, não a conversa inteira.
- Contexto de sessão: mensagens recentes mínimas e referências de objetos; prazo limitado.
- Preferências inferidas: propostas para confirmação quando afetarem comportamento; não sobrescrever regra porque “o modelo aprendeu”.

RAG pode ajudar em manuais, FAQs e políticas do negócio. Não usar busca vetorial para obter saldo, decidir disponibilidade ou reconstruir ledger. Memória de um negócio nunca vira contexto de outro. Documentos recuperados são citados e tratados como dados potencialmente não confiáveis.

## Resposta confiável

“Você tem R$820 a receber até sexta, considerando 7 registros lançados na Tinindo. Atualizado às 14h32. Não inclui recebimentos que ainda não foram registrados.” A resposta explica período e cobertura. “Quanto posso retirar?” exige caixa, obrigações e reserva mínima; com dados incompletos, mostrar cenário e faltantes, não declarar que é seguro sacar.

Ferramentas retornam IDs/versões/as_of e totais calculados. A camada de renderização financeira usa esses números diretamente. O modelo não corrige ou arredonda por conta própria. Se pergunta ambígua (“marca a Maria quinta”), desambiguar cliente/data e mostrar proposta. Áudio gera transcrição revisável; nomes, preço e horário aparecem antes de execução. Voz é melhoria posterior se ameaçar o prazo do piloto.

## WhatsApp: dois produtos diferentes

1. **Assistente do dono:** o profissional conversa com a Tinindo para gerir seu negócio. Vincular número a identidade com pareamento dentro do app e verificação; ao trocar telefone, revalidar. Operações sensíveis levam para aprovação autenticada no web.
2. **Recepção do profissional:** clientes conversam com o número daquele negócio. Requer onboarding de canal/conta, configuração por tenant, consentimento, suporte, políticas e custos. Não usar um número compartilhado fingindo ser todos os profissionais.

No piloto, assistente real no web + conteúdo pronto para o dono compartilhar. Isso valida a inteligência sem depender da aprovação da Meta. Testar integração oficial em sandbox quando disponível. Não usar automação de WhatsApp Web, captura de sessão ou API não oficial. A plataforma não ganha acesso a todo histórico pessoal do WhatsApp.

Operação oficial deve tratar janela de atendimento, templates, opt-out, qualidade, limites, retentativas e acesso humano. Rever elegibilidade contratual do caso de IA com Meta/BSP antes da liberação comercial; não presumir que qualquer “AI employee” é aceito. Ver fontes atuais e limitações em `13_DECISOES_E_FONTES.md`.

## Orçamento e avaliação

Por execução: teto de tokens, chamadas e tempo; por tenant: franquia e alertas. Leitura comum usa SQL e resposta de template; LLM só quando agrega interpretação/redação. Cache apenas por tenant, versão de dados e permissão, nunca mistura clientes. Conteúdo de clientes não vai automaticamente para modelos caros.

Suite inicial de 30–50 casos de intenção: consultas corretas, cliente ambíguo, sem dados, prompt injection, cota esgotada, duas aprovações, agenda alterada e retry. Critérios fortes: zero ação proibida; zero vazamento; valores e estado corretos em 100% dos casos determinísticos. Fluência de linguagem não compensa falha nesses critérios.

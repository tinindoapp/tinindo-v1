// Modelos do app para cadastrar e aprovar na Meta (Gerenciador do WhatsApp). Mesma tabela de channel_templates
// (migration 2026112200000X_whatsapp_meta.sql); o teste de integração confere linha a linha.
//
// Regra: nos modelos ao cliente, {{1}} = nome do negócio e as demais variáveis seguem a ordem dos parâmetros do app.
// Exceção: códigos (verificação do número e código da reserva) são da categoria AUTHENTICATION da Meta, que tem texto
// fixo da própria Meta e só aceita o código como variável ({{1}} = código).
// Nenhum modelo sai pela Meta antes de aprovado lá E marcado com channel_template_set_approval(código, 'whatsapp_cloud', true).

export interface MetaTemplateRow {
  /** Código interno (channel_templates.code). */
  code: string;
  /** Nome do modelo na Meta. */
  meta_name: string;
  category: "utility" | "marketing" | "authentication";
  language: "pt_BR";
  /** Corpo como cadastrado na Meta. Na autenticação, é o texto fixo que a Meta mostra (só referência). */
  body: string;
  /** O que vai em cada variável, na ordem {{1}}, {{2}}… */
  variables: string[];
  /** De onde sai cada variável: 0 = nome do negócio; k = k-ésimo parâmetro do app (channel_templates.meta_params). */
  source: number[];
  /** Exemplo de cada variável (a Meta pede exemplo ao cadastrar). */
  examples: string[];
}

export const META_TEMPLATES: readonly MetaTemplateRow[] = [
  {
    code: "verificacao_numero", meta_name: "verificacao_numero", category: "authentication", language: "pt_BR",
    body: "{{1}} é seu código de verificação.",
    variables: ["Código de 6 números para conectar o número à Tinindo"], source: [1], examples: ["123456"],
  },
  {
    code: "codigo_reserva", meta_name: "codigo_reserva", category: "authentication", language: "pt_BR",
    body: "{{1}} é seu código de verificação.",
    variables: ["Código de 6 números para confirmar a reserva pelo link"], source: [3], examples: ["654321"],
  },
  {
    code: "confirmacao_agendamento", meta_name: "confirmacao_agendamento", category: "utility", language: "pt_BR",
    body: "Olá, {{2}}! {{1}} confirmou seu horário de {{3}} em {{4}}. Para remarcar, responda aqui. Responda SAIR para não receber mais avisos.",
    variables: ["Nome do negócio", "Nome da cliente", "Serviço", "Dia e hora"], source: [0, 1, 2, 3],
    examples: ["Barbearia Exemplo", "Ana", "Corte", "21/10 às 10:00"],
  },
  {
    code: "lembrete_agendamento", meta_name: "lembrete_agendamento", category: "utility", language: "pt_BR",
    body: "Lembrete de {{1}}: {{2}} em {{3}}. Se precisar remarcar, responda esta mensagem.",
    variables: ["Nome do negócio", "Serviço", "Dia e hora"], source: [0, 1, 2], examples: ["Barbearia Exemplo", "Corte", "amanhã às 10:00"],
  },
  {
    code: "link_orcamento", meta_name: "link_orcamento", category: "utility", language: "pt_BR",
    body: "Olá, {{2}}! {{1}} preparou seu orçamento. Veja e responda pelo link: {{3}} Se tiver dúvida, responda esta mensagem.",
    variables: ["Nome do negócio", "Nome da cliente", "Link do orçamento"], source: [0, 1, 2],
    examples: ["Barbearia Exemplo", "Ana", "https://app.tinindo.com.br/orcamento#t=exemplo"],
  },
  {
    code: "oferta_vaga", meta_name: "oferta_vaga", category: "utility", language: "pt_BR",
    body: "Olá, {{2}}! Abriu um horário de {{3}} em {{4}} com {{1}}. Veja e aceite aqui: {{5}} Se não puder, é só ignorar.",
    variables: ["Nome do negócio", "Nome da cliente", "Serviço", "Dia e hora", "Link para aceitar"], source: [0, 1, 2, 3, 4],
    examples: ["Barbearia Exemplo", "Ana", "Corte", "quinta às 15:00", "https://app.tinindo.com.br/vaga#t=exemplo"],
  },
  {
    code: "lembrete_orcamento", meta_name: "lembrete_orcamento", category: "utility", language: "pt_BR",
    body: "Olá, {{2}}! Seu orçamento de {{3}} com {{1}} continua disponível até {{4}}. Se tiver dúvida, responda esta mensagem.",
    variables: ["Nome do negócio", "Nome da cliente", "Valor ou descrição do orçamento", "Validade"], source: [0, 1, 2, 3],
    examples: ["Barbearia Exemplo", "Ana", "R$ 120,00", "30/10"],
  },
  {
    code: "lembrete_cobranca", meta_name: "lembrete_cobranca", category: "utility", language: "pt_BR",
    body: "Olá, {{2}}! Aqui é {{1}}. Ficou em aberto {{3}} de {{4}}. Se já pagou, desconsidere. Dúvidas, responda aqui.",
    variables: ["Nome do negócio", "Nome da cliente", "Valor em aberto", "Descrição"], source: [0, 1, 2, 3],
    examples: ["Barbearia Exemplo", "Ana", "R$ 25,00", "Produto"],
  },
  {
    code: "pacote_vencendo", meta_name: "pacote_vencendo", category: "utility", language: "pt_BR",
    body: "Olá, {{2}}! Aqui é {{1}}. Seu pacote de {{3}} ainda tem {{4}} e vale até {{5}}. Quer marcar? Responda esta mensagem.",
    variables: ["Nome do negócio", "Nome da cliente", "Pacote", "Sessões que restam", "Validade"], source: [0, 1, 2, 3, 4],
    examples: ["Barbearia Exemplo", "Ana", "Treino 10 aulas", "3 sessões", "30/11"],
  },
  {
    code: "reativacao", meta_name: "reativacao", category: "marketing", language: "pt_BR",
    body: "Olá, {{2}}! Faz tempo que não nos vemos no {{1}}. Quer agendar um horário? Responda SAIR para não receber mais convites.",
    variables: ["Nome do negócio", "Nome da cliente"], source: [2, 1], examples: ["Barbearia Exemplo", "Ana"],
  },
  {
    code: "oferta_campanha", meta_name: "oferta_campanha", category: "marketing", language: "pt_BR",
    body: "Olá, {{2}}! {{1}} tem uma oferta para você: {{3}}. Vale até {{4}}. Responda SAIR para não receber mais convites.",
    variables: ["Nome do negócio", "Nome da cliente", "Oferta", "Validade"], source: [2, 1, 3, 4],
    examples: ["Barbearia Exemplo", "Ana", "10% no corte", "30/11"],
  },
];

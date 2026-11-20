// Textos do módulo Canal. Estado da mensagem sempre por palavra, nunca só por cor ou ícone.
import type { ChannelMessageStatus } from "@contracts";
import { errorExplainer } from "../../lib/errors.ts";

// +55 no formato local; outros países ficam em E.164 (formatador comum).
export { formatPhone } from "../../lib/phone.ts";

export const MESSAGE_STATUS: Record<ChannelMessageStatus, string> = {
  queued: "Na fila",
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  delivery_unknown: "Entrega desconhecida",
  received: "Recebida",
};
export const CONNECTION_STATUS = {
  pending_verification: "Aguardando o código",
  active: "Conectado",
  disconnected: "Desconectado",
} as const;
export const PROVIDER_LABEL = { simulated: "Simulado (sem envio real)", whatsapp_cloud: "WhatsApp (API oficial)" } as const;
export const FAILURE_REASON: Record<string, string> = {
  invalid_number: "número inválido",
  disconnected: "canal desconectado antes do envio",
  provider_not_configured: "provedor não configurado neste ambiente",
};

export const explain = errorExplainer({
  "POLICY_REJECTED.code": "Código incorreto. Confira a mensagem recebida no número e tente de novo.",
  "POLICY_REJECTED.expired": "Código vencido ou tentativas esgotadas. Desconecte e conecte de novo para receber outro.",
  "POLICY_REJECTED.connection": "O canal não está conectado e verificado.",
  "POLICY_REJECTED.window": "Mais de 24 h desde a última mensagem da cliente: só um modelo aprovado pode ser enviado.",
  "POLICY_REJECTED.opt_in": "Sem permissão da cliente para receber mensagens fora da conversa.",
  "POLICY_REJECTED.opted_out": "A cliente pediu para não receber mensagens. Nada foi enviado.",
  "POLICY_REJECTED.template_code": "Este modelo não está aprovado no provedor conectado.",
  "POLICY_REJECTED.provider": "O simulador só existe com a conexão simulada.",
  "POLICY_REJECTED.phone_e164": "Este número já está conectado a outro negócio.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  PROVIDER_UNAVAILABLE: "O provedor oficial não está configurado neste ambiente. Use o simulado ou peça a configuração.",
  "VALIDATION_ERROR.phone_e164": "Informe o número no formato internacional, como +5511999990000.",
  "VALIDATION_ERROR.template_params": "O modelo pede outra quantidade de campos.",
  VALIDATION_ERROR: "Confira os campos. Nada foi gravado.",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio acessa o canal.",
});

/** Selo da lista: o número escrito, nunca só a cor. */
export const unreadLabel = (n: number) => (n === 1 ? "1 não lida" : `${n} não lidas`);

/** Modelo aprovado com nome legível e o nome de cada campo (item 41), no lugar do código do provedor. */
export interface TemplateInfo {
  name: string;
  /** Nome de cada campo, na ordem de {{1}}, {{2}}… */
  fields: string[];
  /** Exemplo curto embaixo do campo. */
  examples?: string[];
}
export const TEMPLATE_INFO: Record<string, TemplateInfo> = {
  verificacao_numero: { name: "Código de verificação", fields: ["Código"] },
  confirmacao_agendamento: { name: "Confirmação de horário", fields: ["Nome da cliente", "Serviço", "Dia e hora"], examples: ["", "Corte", "quarta, 21/10 às 10h"] },
  lembrete_agendamento: { name: "Lembrete de horário", fields: ["Serviço", "Dia e hora"], examples: ["Corte", "amanhã às 10h"] },
  link_orcamento: { name: "Link do orçamento", fields: ["Nome da cliente", "Link do orçamento"], examples: ["", "https://…"] },
  oferta_vaga: { name: "Horário que abriu", fields: ["Nome da cliente", "Serviço", "Dia e hora", "Link para aceitar"], examples: ["", "Corte", "quinta às 15h", "https://…"] },
};

/** Nome e campos de um modelo; código desconhecido vira texto legível ("aviso_geral" → "Aviso geral"). */
export function templateInfo(code: string, params: number): TemplateInfo {
  const known = TEMPLATE_INFO[code];
  if (known && known.fields.length === params) return known;
  const words = code.replace(/[_-]+/g, " ").trim();
  return { name: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Modelo", fields: Array.from({ length: params }, (_, i) => known?.fields[i] ?? `Informação ${i + 1}`) };
}

/** Texto do modelo com os campos preenchidos; campo vazio aparece como [Nome do campo]. */
export function renderTemplate(body: string, values: string[], fields: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const i = Number(n) - 1;
    const v = values[i]?.trim();
    return v ? v : `[${fields[i] ?? `Informação ${n}`}]`;
  });
}

// Textos do módulo Canal. Estado da mensagem sempre por palavra, nunca só por cor ou ícone.
import type { ChannelMessageStatus } from "@contracts";

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

export const formatTime = (v: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(v));

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "code") return "Código incorreto. Confira a mensagem recebida no número e tente de novo.";
      if (e.field === "expired") return "Código vencido ou tentativas esgotadas. Desconecte e conecte de novo para receber outro.";
      if (e.field === "connection") return "O canal não está conectado e verificado.";
      if (e.field === "window") return "Mais de 24 h desde a última mensagem da cliente: só um modelo aprovado pode ser enviado.";
      if (e.field === "opt_in") return "Sem permissão da cliente para receber mensagens fora da conversa.";
      if (e.field === "opted_out") return "A cliente pediu para não receber mensagens. Nada foi enviado.";
      if (e.field === "template_code") return "Este modelo não está aprovado no provedor conectado.";
      if (e.field === "provider") return "O simulador só existe com a conexão simulada.";
      if (e.field === "phone_e164") return "Este número já está conectado a outro negócio.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "PROVIDER_UNAVAILABLE":
      return "O provedor oficial não está configurado neste ambiente. Use o simulado ou peça a configuração.";
    case "VALIDATION_ERROR":
      if (e.field === "phone_e164") return "Informe o número no formato internacional, como +5511999990000.";
      if (e.field === "template_params") return "O modelo pede outra quantidade de campos.";
      return "Confira os campos. Nada foi gravado.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa o canal.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}

/** Selo da lista: o número escrito, nunca só a cor. */
export const unreadLabel = (n: number) => (n === 1 ? "1 não lida" : `${n} não lidas`);

/** +55 no formato local; outros países ficam em E.164. */
export function formatPhone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

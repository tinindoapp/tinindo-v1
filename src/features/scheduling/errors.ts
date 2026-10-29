// Explica erros do contrato (envelope v1) para o profissional, sem jargão e sem revelar
// dados de terceiros. Especialmente os 409: o que aconteceu, o que NÃO aconteceu e o próximo passo.
import type { ErrorCode } from "@contracts";

export interface ErrorExplanation {
  title: string;
  body: string;
  /** Rótulo da ação sugerida na interface. */
  action: "choose_another_slot" | "reload" | "retry" | "new_quote" | "none";
}

export interface ErrorLike {
  code: ErrorCode;
  retryable?: boolean;
}

export function isErrorLike(e: unknown): e is ErrorLike {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string";
}

export type Operation = "create" | "reschedule" | "cancel" | "complete" | "confirm" | "no_show" | "undo_cancel" | "load";

/** Recusa de regra (422) em ações sobre um atendimento existente: o motivo depende da ação. */
const POLICY_BY_OPERATION: Partial<Record<Operation, ErrorExplanation>> = {
  confirm: {
    title: "A reserva provisória venceu",
    body: "O prazo para confirmar passou e o horário voltou a ficar livre. Para manter o cliente, faça um novo agendamento.",
    action: "none",
  },
  no_show: {
    title: "Não dá para mudar a falta agora",
    body: "Falta só vale para atendimento confirmado que já começou. Nada foi alterado.",
    action: "none",
  },
  complete: {
    title: "Não dá para marcar como atendido",
    body: "Só atendimento confirmado que já começou pode ser marcado como atendido. Nada foi alterado.",
    action: "none",
  },
  cancel: {
    title: "Este atendimento não pode mais ser cancelado",
    body: "Só reserva provisória ou atendimento confirmado pode ser cancelado. Nada foi alterado.",
    action: "none",
  },
  undo_cancel: {
    title: "Não deu para desfazer o cancelamento",
    body: "O horário saiu do expediente ou já passou. Nenhum atendimento foi criado. Marque outro horário.",
    action: "none",
  },
};

export function explainError(error: unknown, operation: Operation): ErrorExplanation {
  if (typeof error === "object" && error !== null && (error as { notConnected?: unknown }).notConnected === true) {
    const e = error as unknown as { what: string; dependsOn: string };
    return {
      title: "Ainda não conectado ao servidor",
      body: `${e.what} depende de ${e.dependsOn}. Até lá, a agenda real não aparece aqui.`,
      action: "none",
    };
  }
  if (!isErrorLike(error)) {
    return { title: "Algo deu errado", body: "Não foi possível concluir. Nada foi alterado por esta tentativa.", action: "retry" };
  }
  switch (error.code) {
    case "SLOT_CONFLICT":
      return {
        title: "Esse horário acabou de ser ocupado",
        body:
          operation === "reschedule"
            ? "Outra reserva confirmou este horário antes de você (conflito 409). O atendimento continua no horário antigo. Atualizamos os horários livres: escolha outro."
            : operation === "undo_cancel"
              ? "Outro atendimento já ocupou este horário depois do cancelamento. Nenhum atendimento foi criado. Marque outro horário."
              : operation === "no_show"
                ? "Outro atendimento já ocupou este horário depois da falta. A falta continua registrada."
                : "Outra reserva confirmou este horário antes de você (conflito 409). Nenhum agendamento foi criado. Atualizamos os horários livres: escolha outro.",
        action: "choose_another_slot",
      };
    case "STALE_VERSION":
      return {
        title: "Este atendimento mudou enquanto você editava",
        body: "Alguém alterou o atendimento em outro lugar (conflito 409). Sua mudança não foi aplicada para não sobrescrever a outra. Recarregamos os dados: revise e tente de novo.",
        action: "reload",
      };
    case "PENDING_REQUEST_EXISTS":
      // Só o link público usa este código; a agenda do dono nunca o recebe.
      return { title: "Já existe um pedido aguardando confirmação", body: "Confirme o pedido anterior com o código ou troque por este.", action: "none" };
    case "IDEMPOTENCY_MISMATCH":
      return {
        title: "Pedido repetido com dados diferentes",
        body: "Esta tentativa reaproveitou um pedido anterior com outros dados (conflito 409). Nada novo foi gravado. Revise e confirme de novo.",
        action: "reload",
      };
    case "POLICY_REJECTED":
      if (POLICY_BY_OPERATION[operation]) return POLICY_BY_OPERATION[operation];
      return {
        title: "As regras do negócio não permitem esta ação",
        body: "O valor pode ter vencido ou o horário saiu do expediente. Peça um novo valor e revise antes de confirmar.",
        action: "new_quote",
      };
    case "VALIDATION_ERROR":
      return { title: "Confira os dados", body: "Algum campo está inválido. Nada foi gravado.", action: "none" };
    case "AUTH_REQUIRED":
      return { title: "Sessão encerrada", body: "Entre de novo para continuar. Nada foi gravado.", action: "none" };
    case "FORBIDDEN":
    case "NOT_FOUND":
      return {
        title: operation === "load" ? "Não encontrado" : "Ação não disponível",
        body: "Este item não existe ou você não tem acesso a ele.",
        action: "none",
      };
    case "QUOTA_EXCEEDED":
      return { title: "Muitas tentativas", body: "Aguarde um pouco e tente de novo.", action: "retry" };
    case "PROVIDER_UNAVAILABLE":
    case "INTERNAL_ERROR":
      return {
        title: "Sem resposta do servidor",
        body:
          operation === "load"
            ? "Não foi possível carregar agora. Tente de novo."
            : "Não sabemos se a ação foi concluída. Tentar de novo é seguro: o pedido usa a mesma chave e não duplica.",
        action: "retry",
      };
  }
}

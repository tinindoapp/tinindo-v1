// Mensagens de erro da Conta. Neutras: não revelam se e-mail, código ou negócio existem.
import { ApiError } from "../../lib/api/client.ts";
import { AuthFlowError } from "./services.tsx";

export function messageFor(e: unknown, context: "business" | "onboarding" | "link" | "auth"): string {
  if (e instanceof AuthFlowError) {
    if (e.kind === "weak_password") return "Senha fraca. Use uma senha maior, que você não usa em outro lugar.";
    if (e.kind === "rate_limited") return "Muitas tentativas. Espere alguns minutos e tente de novo.";
    return "Não foi possível concluir agora. Tente de novo.";
  }
  if (e instanceof ApiError) {
    switch (e.code) {
      case "AUTH_REQUIRED":
        return "Sua sessão terminou. Entre de novo para continuar.";
      case "QUOTA_EXCEEDED":
        return context === "business"
          ? "Você já tem o número máximo de negócios ativos nesta fase do piloto."
          : "Muitas tentativas. Espere alguns minutos e tente de novo.";
      case "STALE_VERSION":
        return "Estas informações foram alteradas em outra tela. Recarregue e confira antes de salvar.";
      case "NOT_FOUND":
        return context === "link" ? "Código inválido, vencido ou já usado. Peça um novo ao profissional." : e.message;
      case "POLICY_REJECTED":
        return context === "link"
          ? "Este código não pode ser usado nesta conta. Fale com o profissional."
          : e.message;
      case "PROVIDER_UNAVAILABLE":
        return "Sem conexão com o servidor. Seus dados não foram perdidos: tente de novo.";
      default:
        return e.message;
    }
  }
  return "Erro inesperado. Tente de novo.";
}

// Textos do módulo Indicações. Estado por palavra; o benefício é crédito de franquia, nunca avaliação.
import type { ReferralInvite } from "@contracts";

import { errorExplainer } from "../../lib/errors.ts";
import { formatDate as formatLocalDate } from "../../lib/time.ts";

/** "20/10/2026". Fuso padrão embutido mantido até a parte 2 (origem do fuso do negócio). */
export const formatDate = (v: string, timeZone = "America/Sao_Paulo") => formatLocalDate(v, timeZone);
export const formatMonth = (ymd: string) => {
  const [y, m] = ymd.split("-");
  return `${m}/${y}`;
};
export const STATE: Record<ReferralInvite["state"], string> = { pending: "Aguardando aceite", claimed: "Aceito", expired: "Expirado", revoked: "Revogado" };
export const BLOCK: Record<NonNullable<NonNullable<ReferralInvite["activation"]>["block_reason"]>, string> = {
  same_tenant: "aceito pelo mesmo negócio que convidou",
  duplicate: "este negócio já aderiu por outro convite",
  window_expired: "janela de uso real vencida",
};
export function activationLabel(inv: ReferralInvite): string {
  const a = inv.activation;
  if (!a) return inv.state === "claimed" ? "Aceito: em avaliação na próxima rodada" : STATE[inv.state];
  switch (a.status) {
    case "awaiting_activity":
      return "Aceito: aguardando uso real";
    case "eligible":
      return "Uso real confirmado: benefício na fila (teto do mês atingido)";
    case "rewarded":
      return "Benefício concedido";
    case "blocked":
      return `Sem benefício: ${a.block_reason ? BLOCK[a.block_reason] : "bloqueado"}`;
  }
}
export const explain = errorExplainer({
  FORBIDDEN: "Só o dono do negócio vê as indicações.",
  default: "Não foi possível carregar agora. Tentar de novo é seguro.",
});

// Textos do módulo Indicações. Estado por palavra; o benefício é crédito de franquia, nunca avaliação.
import type { ReferralInvite } from "@contracts";

export const formatDate = (v: string, timeZone = "America/Sao_Paulo") =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(v));
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
      return `Aceito: aguardando uso real (${Number(a.checks.customers ?? 0)} cliente(s), ${Number(a.checks.completed_bookings ?? 0)} atendimento(s) concluído(s))`;
    case "eligible":
      return "Uso real confirmado: benefício na fila (teto do mês atingido)";
    case "rewarded":
      return "Benefício concedido";
    case "blocked":
      return `Sem benefício: ${a.block_reason ? BLOCK[a.block_reason] : "bloqueado"}`;
  }
}
export function explain(err: unknown): string {
  const e = err as { code?: string } | null;
  switch (e?.code) {
    case "FORBIDDEN":
      return "Só o dono do negócio vê as indicações.";
    default:
      return "Não foi possível carregar agora. Tentar de novo é seguro.";
  }
}

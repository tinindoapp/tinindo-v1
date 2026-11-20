// Rótulos e mensagens do perfil sem dependência de sessão nem do cliente Supabase: usados pelas páginas públicas
// (pacote separado) e reexportados por useNetworkApi.ts para as telas do dono.
import type { Profession } from "@contracts";
import { ApiError } from "../../../lib/api/client.ts";

export const CATEGORY_LABEL: Record<Profession, string> = {
  barber: "Barbearia",
  hairdresser: "Cabeleireiro(a)",
  personal_trainer: "Personal trainer",
  other: "Outro serviço",
};

export { newIdempotencyKey } from "../../../lib/idempotency.ts";

/** Mensagem para a pessoa, sem detalhes técnicos; campos conhecidos ganham texto específico. */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "Falha inesperada. Tente novamente.";
  if (e.field === "slug") return "Este endereço já está em uso. Escolha outro.";
  if (e.field === "contact") return "Confirme seu e-mail antes de aceitar o convite.";
  if (e.code === "POLICY_REJECTED") return "Este convite já foi usado, venceu ou não pode ser aceito por esta conta.";
  if (e.code === "NOT_FOUND") return "Link inválido ou removido.";
  return e.message;
}

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/** "+5511977774343" → "(11) 97777-4343"; outro formato volta como veio. Formatador comum (src/lib/phone.ts). */
export { formatPhone as formatPhoneBr } from "../../../lib/phone.ts";

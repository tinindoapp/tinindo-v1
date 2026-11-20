// Rótulos e mensagens do perfil sem dependência de sessão nem do cliente Supabase: usados pelas páginas públicas
// (pacote separado) e reexportados por useNetworkApi.ts para as telas do dono.
import type { Profession } from "@contracts";
import { ApiError } from "../../../lib/api/client.ts";
import { formatFullDateTime } from "../../../lib/time.ts";

export const CATEGORY_LABEL: Record<Profession, string> = {
  barber: "Barbearia",
  hairdresser: "Cabeleireiro(a)",
  personal_trainer: "Personal trainer",
  other: "Outro serviço",
};

// Reexportado só por useNetworkApi.ts; as telas usam useCommand/useIdempotencyKey de src/lib/idempotency.ts.
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

/** "20/10/2026, 09:30". O fuso padrão fica aqui até o fuso do negócio vir da sessão. */
export const formatDateTime = (iso: string) => formatFullDateTime(iso, "America/Sao_Paulo");

/** "+5511977774343" → "(11) 97777-4343"; outro formato volta como veio. Formatador comum (src/lib/phone.ts). */
export { formatPhone as formatPhoneBr } from "../../../lib/phone.ts";

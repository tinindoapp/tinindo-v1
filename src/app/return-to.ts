// Volta ao destino depois de entrar (pacote "Primeiro acesso de verdade"). Quem abre um link de /app sem sessão (do
// recado, do e-mail, de um favorito) entra e cai no mesmo lugar, e não na Hoje.
// Só caminhos internos do app: nada de outro domínio, de `//host` nem de esquema (`javascript:`), para o parâmetro não
// virar redirecionamento aberto.

/** Por que a pessoa caiu na tela de entrar. */
export type SignInReason = "sessao" | "saiu" | "link";

export const RETURN_PARAM = "volta";
export const REASON_PARAM = "motivo";

const SAFE = /^\/(app|reserva|p|convite|indicar|oferta|orcamento|pagar|avaliar|avaliacoes|diretorio)(?:[/?#]|$)/;

/** O destino se for um caminho interno aceito; senão, null. */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  // Normaliza contra a própria origem: se sair dela, recusa.
  try {
    const url = new URL(value, "https://tinindo.invalid");
    if (url.origin !== "https://tinindo.invalid") return null;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return SAFE.test(path) ? path : null;
  } catch {
    return null;
  }
}

/** Endereço da tela de entrar que volta para `from` (sem o próprio /entrar). */
export function signInHref(from: string | null, reason?: SignInReason): string {
  const params = new URLSearchParams();
  const back = safeReturnPath(from);
  if (back && back !== "/app") params.set(RETURN_PARAM, back);
  if (reason) params.set(REASON_PARAM, reason);
  const q = params.toString();
  return q ? `/entrar?${q}` : "/entrar";
}

/** Erro devolvido pelo Supabase Auth no fragmento de um link de e-mail vencido (`#error_code=otp_expired`). */
export function authLinkError(hash: string): "expired" | "invalid" | null {
  if (!hash.includes("error")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("error_code");
  if (!params.get("error") && !code) return null;
  return code === "otp_expired" ? "expired" : "invalid";
}

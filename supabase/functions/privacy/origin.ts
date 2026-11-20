// Chave da origem para o limite de abuso da reserva pública (P57, D30 a). O banco nunca recebe o IP: recebe o
// sha256 de "origem + dia (UTC) + pimenta". O mesmo IP vira outra chave no dia seguinte, e a tabela de tentativas é
// apagada em 1 dia (retention_policies.origin_hits).
//
// Ligação (recado ao integrador): o handler de `network/public.book` chama, antes de `public_booking_request`,
//   const key = await originKey(req, Deno.env.get("ORIGIN_PEPPER") ?? "");
//   if (key) await call("public_origin_check", { p_origin_hash: key }, false);
// Sem IP conhecido (chamada interna, teste), `originKey` devolve null e o limite por origem não se aplica; os limites
// por contato e o teto de reservas provisórias continuam no banco.

/** IP do cliente como a borda informa (Cloudflare/Supabase). Só o primeiro da lista; nada de texto livre. */
export function clientIp(req: Request): string | null {
  const raw = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip");
  const ip = raw?.trim() ?? "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip.toLowerCase() : null;
}

export async function originKey(req: Request, pepper: string, now: Date = new Date()): Promise<string | null> {
  const ip = clientIp(req);
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${day}|${pepper}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

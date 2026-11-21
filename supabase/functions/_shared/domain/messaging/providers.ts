// Porta do provedor de mensagens (P12). Dois adaptadores:
// * simulated (aqui): determinístico, sem rede. "Entrega" ao telefone fictício (channel_sim_phone) e simula falha
//   permanente (número termina em 0000) e resultado desconhecido (termina em 9999; a consulta de status resolve como enviado).
// * whatsapp_cloud: API oficial (Graph) da Meta, em _shared/providers/meta.ts (reexportado aqui para quem já importava).
// Tipos e assinatura comuns: ./port.ts. Nenhum adaptador reenvia por conta própria.
import { z } from "zod";
import { type Provider, verifyHubSignature } from "./port.ts";

export * from "./port.ts";
export { createWhatsAppProvider, type WhatsAppDeps } from "../../providers/meta.ts";

// ---------------------------------------------------------------------------
// Simulado
// ---------------------------------------------------------------------------

/** Corpo do webhook simulado: a mesma lista de eventos normalizados, assinada com o segredo do simulador. */
export const SimulatedWebhookBody = z.object({
  events: z.array(z.object({
    external_event_id: z.string().min(1).max(200),
    kind: z.enum(["inbound", "status"]),
    external_account_id: z.string().min(1).max(80),
    phone_e164: z.string().optional(),
    text: z.string().max(4096).optional(),
    profile_name: z.string().max(120).optional(),
    provider_message_id: z.string().max(200).optional(),
    status: z.enum(["sent", "delivered", "read", "failed"]).optional(),
    reason: z.string().max(200).optional(),
  })).max(500),
});

export interface SimulatedDeps {
  secret: string;
  /** Guarda a mensagem "entregue" no telefone fictício (RPC channel_sim_deliver, só backend). */
  deliver(phone: string, fromAccount: string, body: string, providerMessageId: string): Promise<void>;
}

export function createSimulatedProvider(deps: SimulatedDeps): Provider {
  const unknownOnce = new Set<string>();
  return {
    name: "simulated",
    configured: deps.secret.length >= 16,
    async send(item) {
      if (item.to.endsWith("0000")) return { outcome: "failed", reason: "invalid_number" };
      if (item.to.endsWith("9999") && !unknownOnce.has(item.ref)) {
        // Primeira vez: timeout sem resposta. A consulta de status resolve.
        unknownOnce.add(item.ref);
        return { outcome: "delivery_unknown" };
      }
      const id = `sim-${item.ref.replace(/[^a-z0-9]/gi, "").slice(-24)}-${Date.now().toString(36)}`;
      await deps.deliver(item.to, item.external_account_id, item.body, id);
      return { outcome: "sent", provider_message_id: id };
    },
    async status(_providerMessageId, ref) {
      return unknownOnce.has(ref) ? "sent" : null;
    },
    verifySignature: (raw, header) => verifyHubSignature(deps.secret, raw, header),
    normalize(body) {
      const parsed = SimulatedWebhookBody.safeParse(body);
      return parsed.success ? parsed.data.events : [];
    },
  };
}

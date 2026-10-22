// Canal oficial de mensagens (P12). Aditivos ao v1; ver ADR-0017.
// Provedor atrás de porta ('simulated' | 'whatsapp_cloud'); enviado ≠ entregue ≠ lido ≠ falhou ≠ desconhecido.
// Texto livre só na janela de 24 h; modelo só aprovado no provedor e com opt-in. Opt-out bloqueia.
import { z } from "zod";
import { IsoDateTime, PhoneE164, Uuid } from "./common.ts";

export const ChannelProvider = z.enum(["simulated", "whatsapp_cloud"]);
export type ChannelProvider = z.infer<typeof ChannelProvider>;

export const ChannelConnection = z.object({
  id: Uuid,
  provider: ChannelProvider,
  phone_e164: PhoneE164,
  status: z.enum(["pending_verification", "active", "disconnected"]),
  verified_at: IsoDateTime.nullable(),
  version: z.int().min(1),
  /** true = provedor fictício: toda tela mostra "simulação". */
  simulated: z.boolean(),
});
export type ChannelConnection = z.infer<typeof ChannelConnection>;

export const ChannelTemplate = z.object({
  code: z.string(),
  category: z.enum(["utility", "marketing"]),
  body: z.string(),
  params: z.int().min(0).max(10),
  /** Aprovado no provedor da conexão atual (ou no simulado, sem conexão). */
  approved: z.boolean(),
});

export const ChannelStatusInput = z.object({});
export const ChannelStatusOutput = z.object({
  connection: ChannelConnection.nullable(),
  queued: z.int().min(0),
  unknown: z.int().min(0),
  templates: z.array(ChannelTemplate),
});

export const ChannelConnectInput = z.object({
  provider: ChannelProvider,
  phone_e164: PhoneE164,
  /** phone_number_id na API oficial; vazio no simulado. */
  external_account_id: z.string().trim().max(80).nullable().optional(),
});
export const ChannelConnectionOutput = z.object({ connection: ChannelConnection });
export const ChannelVerifyInput = z.object({ code: z.string().regex(/^[0-9]{6}$/) });
export const ChannelDisconnectInput = z.object({});

export const ChannelContact = z.object({
  id: Uuid,
  phone_e164: PhoneE164,
  customer_id: Uuid.nullable(),
  customer_name: z.string().nullable().optional(),
  /** Nome que o provedor informa: dado do cliente, não instrução. */
  profile_name: z.string().nullable(),
  handling: z.enum(["assistant", "human"]),
  opted_out: z.boolean(),
  opt_in_source: z.enum(["inbound", "owner_declared"]).nullable(),
  window_open: z.boolean(),
  window_until: IsoDateTime.nullable(),
  last_message_at: IsoDateTime.nullable(),
  unread_count: z.int().min(0),
  version: z.int().min(1),
});
export type ChannelContact = z.infer<typeof ChannelContact>;

export const ChannelMessageStatus = z.enum(["queued", "sending", "sent", "delivered", "read", "failed", "delivery_unknown", "received"]);
export type ChannelMessageStatus = z.infer<typeof ChannelMessageStatus>;
export const ChannelMessage = z.object({
  id: Uuid,
  contact_id: Uuid,
  direction: z.enum(["inbound", "outbound"]),
  kind: z.enum(["text", "template"]),
  body: z.string(),
  template_code: z.string().nullable(),
  status: ChannelMessageStatus,
  failure_reason: z.string().nullable(),
  created_at: IsoDateTime,
  sent_at: IsoDateTime.nullable(),
  delivered_at: IsoDateTime.nullable(),
  read_at: IsoDateTime.nullable(),
  failed_at: IsoDateTime.nullable(),
});
export type ChannelMessage = z.infer<typeof ChannelMessage>;

export const InboxListInput = z.object({});
export const InboxListOutput = z.object({
  contacts: z.array(ChannelContact.extend({
    last_message: z.object({ direction: z.enum(["inbound", "outbound"]), body: z.string(), status: ChannelMessageStatus }).nullable(),
  })).max(200),
});
export const ConversationGetInput = z.object({ contact_id: Uuid });
export const ConversationGetOutput = z.object({ contact: ChannelContact, messages: z.array(ChannelMessage).max(200) });

export const MessageSendInput = z.discriminatedUnion("kind", [
  z.object({ contact_id: Uuid, kind: z.literal("text"), text: z.string().trim().min(1).max(4096) }),
  z.object({ contact_id: Uuid, kind: z.literal("template"), template_code: z.string().regex(/^[a-z0-9_]{3,40}$/), template_params: z.array(z.string().max(300)).max(10) }),
]);
export const MessageSendOutput = z.object({ message: ChannelMessage });
export const ConversationHandoffInput = z.object({ contact_id: Uuid, handling: z.enum(["assistant", "human"]) });
export const ContactOutput = z.object({ contact: ChannelContact });
export const ContactLinkInput = z.object({ contact_id: Uuid, customer_id: Uuid.nullable() });
export const ContactConsentInput = z.object({ contact_id: Uuid, opted_in: z.boolean() });

/** Telefone simulado (só com conexão 'simulated'): o que o provedor fictício entregou ao número. */
export const SimPhoneInput = z.object({ phone_e164: PhoneE164 });
export const SimPhoneOutput = z.object({
  phone_e164: PhoneE164,
  messages: z.array(z.object({ body: z.string(), provider_message_id: z.string().nullable(), created_at: IsoDateTime })),
});
/** Simula o cliente escrevendo ou o provedor confirmando entrega/leitura: passa pelo MESMO webhook, assinado. */
export const SimInboundInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inbound"), phone_e164: PhoneE164, text: z.string().trim().min(1).max(4096), profile_name: z.string().max(120).optional() }),
  z.object({ kind: z.literal("status"), provider_message_id: z.string().min(1).max(200), status: z.enum(["delivered", "read", "failed"]) }),
]);
export const SimInboundOutput = z.object({ applied: z.int().min(0), duplicates: z.int().min(0) });

/** Resultado de uma rodada de despacho (rota de sistema, protegida por segredo). */
export const DispatchOutput = z.object({
  provider_configured: z.boolean(),
  sent: z.int().min(0),
  failed: z.int().min(0),
  unknown: z.int().min(0),
  reconciled: z.int().min(0),
});

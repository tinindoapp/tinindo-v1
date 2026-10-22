// Portas do módulo Canal (P12). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `messaging`.
import type {
  ChannelContact,
  ChannelMessage,
  ChannelProvider,
  ChannelStatusOutput,
  ConversationGetOutput,
  InboxListOutput,
  MessageSendInput,
  SimInboundInput,
  SimInboundOutput,
  SimPhoneOutput,
} from "@contracts";
import type { z } from "zod";

export type ChannelStatus = z.infer<typeof ChannelStatusOutput>;
export type Inbox = z.infer<typeof InboxListOutput>;
export type InboxContact = Inbox["contacts"][number];
export type Conversation = z.infer<typeof ConversationGetOutput>;
export type SendInput = z.infer<typeof MessageSendInput>;
export type SimInbound = z.infer<typeof SimInboundInput>;
export type SimPhone = z.infer<typeof SimPhoneOutput>;
export type { ChannelContact, ChannelMessage, ChannelProvider };

export interface MessagingPort {
  readonly kind: "demo" | "server";
  status(): Promise<ChannelStatus>;
  connect(provider: ChannelProvider, phoneE164: string, key: string): Promise<ChannelStatus["connection"]>;
  verify(code: string, key: string): Promise<ChannelStatus["connection"]>;
  disconnect(key: string): Promise<ChannelStatus["connection"]>;
  inbox(): Promise<Inbox>;
  conversation(contactId: string): Promise<Conversation>;
  send(input: SendInput, key: string): Promise<ChannelMessage>;
  handoff(contactId: string, handling: "assistant" | "human", key: string): Promise<ChannelContact>;
  consent(contactId: string, optedIn: boolean, key: string): Promise<ChannelContact>;
  link(contactId: string, customerId: string | null, key: string): Promise<ChannelContact>;
  /** Telefone fictício (só conexão simulada): o que o provedor "entregou" ao número. */
  simPhone(phoneE164: string): Promise<SimPhone>;
  /** Simula a cliente escrevendo ou o provedor confirmando entrega/leitura, pelo mesmo webhook. */
  simInbound(input: SimInbound, key: string): Promise<z.infer<typeof SimInboundOutput>>;
  /** Só na demonstração: uma rodada do despacho (no servidor, o cron faz isso). */
  dispatch?(): Promise<{ sent: number; failed: number; unknown: number; reconciled: number }>;
}

export const newKey = () => crypto.randomUUID();

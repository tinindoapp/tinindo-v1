// Portas reais do Canal: Edge Function `messaging`. O despacho é do cron (não há `dispatch` aqui).
import {
  ChannelConnectionOutput,
  ChannelStatusOutput,
  ContactOutput,
  ConversationGetOutput,
  InboxListOutput,
  MessageSendOutput,
  SimInboundOutput,
  SimPhoneOutput,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { MessagingPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/messaging/${name}`;

export function createServerPort(call: Call, tenantId: string): MessagingPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async status() {
      return (await call(op("channel.status"), ChannelStatusOutput, post({}))).data;
    },
    async connect(provider, phone_e164, key) {
      return (await call(op("channel.connect"), ChannelConnectionOutput, post({ provider, phone_e164 }, key))).data.connection;
    },
    async verify(code, key) {
      return (await call(op("channel.verify"), ChannelConnectionOutput, post({ code }, key))).data.connection;
    },
    async disconnect(key) {
      return (await call(op("channel.disconnect"), ChannelConnectionOutput, post({}, key))).data.connection;
    },
    async inbox() {
      return (await call(op("inbox.list"), InboxListOutput, post({}))).data;
    },
    async conversation(contact_id) {
      return (await call(op("conversation.get"), ConversationGetOutput, post({ contact_id }))).data;
    },
    async send(input, key) {
      return (await call(op("message.send"), MessageSendOutput, post(input, key))).data.message;
    },
    async handoff(contact_id, handling, key) {
      return (await call(op("conversation.handoff"), ContactOutput, post({ contact_id, handling }, key))).data.contact;
    },
    async consent(contact_id, opted_in, key) {
      return (await call(op("contact.consent"), ContactOutput, post({ contact_id, opted_in }, key))).data.contact;
    },
    async link(contact_id, customer_id, key) {
      return (await call(op("contact.link"), ContactOutput, post({ contact_id, customer_id }, key))).data.contact;
    },
    async simPhone(phone_e164) {
      return (await call(op("sim.phone"), SimPhoneOutput, post({ phone_e164 }))).data;
    },
    async simInbound(input, key) {
      return (await call(op("sim.inbound"), SimInboundOutput, post(input, key))).data;
    },
  };
}

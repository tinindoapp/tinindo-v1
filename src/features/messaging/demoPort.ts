// EMULAÇÃO do Canal para a demonstração sem servidor. Mesmas regras do banco que a tela explica: número precisa de
// código entregue pelo próprio canal; a cliente escreve e abre a janela de 24 h; fora dela só modelo aprovado com
// opt-in; enviado ≠ entregue ≠ lido ≠ falhou ≠ desconhecido; nada é reenviado sozinho; SAIR/PARAR bloqueia; humano
// assume quando o dono pede. Nada sai do navegador: o "provedor" é o telefone fictício do simulador.
import {
  type ChannelContact,
  type ChannelMessage,
  type ChannelMessageStatus,
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  RETRYABLE,
} from "@contracts";
import { FIXED_NOW, FX } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { ChannelStatus, Conversation, Inbox, MessagingPort, SimPhone } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);

/** Clientes de exemplo que o canal reconhece pelo telefone (mesmos ids do CRM de exemplo). */
export const DEMO_CUSTOMERS = [
  { id: FX.customers.abInA, name: "Ana Beatriz (exemplo)", phone: "+5511988887777" },
  { id: FX.customers.guestInA, name: "Carlos (exemplo)", phone: "+5511977776666" },
];
export const DEMO_BUSINESS_PHONE = "+5511999990001";

const TEMPLATES: ChannelStatus["templates"] = [
  { code: "verificacao_numero", category: "utility", body: "Seu código para conectar o número à Tinindo é {{1}}. Vale por 10 minutos.", params: 1, approved: true },
  { code: "confirmacao_agendamento", category: "utility", body: "Olá, {{1}}! Seu horário de {{2}} está confirmado para {{3}}. Responda SAIR para não receber mais avisos.", params: 3, approved: true },
  { code: "lembrete_agendamento", category: "utility", body: "Lembrete: {{1}} em {{2}}. Se precisar remarcar, responda esta mensagem.", params: 2, approved: true },
  { code: "link_orcamento", category: "utility", body: "Olá, {{1}}! Seu orçamento está pronto: {{2}}", params: 2, approved: true },
  { code: "oferta_vaga", category: "utility", body: "Olá, {{1}}! Abriu um horário de {{2}} em {{3}}. Veja e aceite aqui: {{4}}", params: 4, approved: true },
];
const WINDOW_MS = 24 * 60 * 60 * 1000;
const OPT_OUT = new Set(["SAIR", "PARAR", "STOP", "CANCELAR"]);

interface Contact extends Omit<ChannelContact, "window_open" | "window_until" | "customer_name"> { last_inbound_at: string | null }
interface Message extends ChannelMessage { provider_message_id: string | null; attempts: number; unknown_once: boolean }
interface Verification { code: string; attempts: number; expires_at: number; dispatched: boolean; used: boolean }
interface State {
  connection: NonNullable<ChannelStatus["connection"]> | null;
  verification: Verification | null;
  contacts: Contact[];
  messages: Message[];
  phone: { to: string; body: string; provider_message_id: string | null; created_at: string }[];
  events: Set<string>;
  idem: Map<string, unknown>;
  seq: number;
  /** Relógio da demonstração: avança 1 s por evento para a ordem ficar visível; a janela de 24 h é medida nele. */
  clock: number;
}
let shared: State | null = null;
function state(): State {
  shared ??= { connection: null, verification: null, contacts: [], messages: [], phone: [], events: new Set(), idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW) };
  return shared;
}
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
/** Só para testes: avança o relógio da demonstração (fecha a janela de 24 h, por exemplo). */
export function advanceDemoClock(ms: number) {
  state().clock += ms;
}
const ts = () => {
  const s = state();
  s.clock += 1000;
  return new Date(s.clock).toISOString();
};
const id = (p: string) => `${p}-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;
const once = async <T>(key: string, run: () => T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, clone(v));
  return clone(v);
};

const windowOpen = (k: Contact) => k.last_inbound_at !== null && Date.parse(k.last_inbound_at) > state().clock - WINDOW_MS;
function contactView(k: Contact): ChannelContact {
  const { last_inbound_at, ...rest } = k;
  return clone({ ...rest, customer_name: DEMO_CUSTOMERS.find((c) => c.id === k.customer_id)?.name ?? null,
    window_open: windowOpen(k), window_until: last_inbound_at ? new Date(Date.parse(last_inbound_at) + WINDOW_MS).toISOString() : null });
}
function messageView(m: Message): ChannelMessage {
  const { provider_message_id: _p, attempts: _a, unknown_once: _u, ...rest } = m;
  return clone(rest);
}
const active = () => state().connection?.status === "active" ? state().connection! : fail("POLICY_REJECTED", "connection");
const findContact = (contactId: string) => state().contacts.find((k) => k.id === contactId) ?? fail("NOT_FOUND", "contact_id");
const render = (code: string, params: string[]) => {
  const t = TEMPLATES.find((x) => x.code === code) ?? fail("NOT_FOUND", "template_code");
  if (params.length !== t.params) fail("VALIDATION_ERROR", "template_params");
  return params.reduce((out, p, i) => out.replaceAll(`{{${i + 1}}}`, p.slice(0, 300)), t.body);
};

function status(): ChannelStatus {
  const s = state();
  return clone({ connection: s.connection, queued: s.messages.filter((m) => m.status === "queued" || m.status === "sending").length,
    unknown: s.messages.filter((m) => m.status === "delivery_unknown").length, templates: TEMPLATES });
}
function upsertContact(phone: string, profileName?: string): Contact {
  const s = state();
  let k = s.contacts.find((x) => x.phone_e164 === phone);
  const now = ts();
  if (!k) {
    k = { id: id("c0000000"), phone_e164: phone, customer_id: DEMO_CUSTOMERS.find((c) => c.phone === phone)?.id ?? null, profile_name: profileName ?? null,
      handling: "assistant", opted_out: false, opt_in_source: "inbound", last_inbound_at: now, last_message_at: now, unread_count: 0, version: 1 };
    s.contacts.unshift(k);
  }
  k.last_inbound_at = now;
  k.last_message_at = now;
  k.profile_name = profileName ?? k.profile_name;
  k.opt_in_source ??= "inbound";
  k.unread_count += 1;
  k.version += 1;
  return k;
}

export function createDemoPort(): MessagingPort {
  return {
    kind: "demo",
    async status() {
      return status();
    },
    connect(provider, phone, key) {
      return once(key, () => {
        const s = state();
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) fail("VALIDATION_ERROR", "phone_e164");
        if (provider === "whatsapp_cloud") fail("PROVIDER_UNAVAILABLE");
        if (s.connection && s.connection.status !== "disconnected") fail("POLICY_REJECTED", "connection");
        s.connection = { id: id("a0000000"), provider, phone_e164: phone, status: "pending_verification", verified_at: null, version: 1, simulated: true };
        s.verification = { code: String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"), attempts: 0, expires_at: s.clock + 10 * 60_000, dispatched: false, used: false };
        return clone(s.connection);
      });
    },
    verify(code, key) {
      return once(key, () => {
        const s = state();
        if (s.connection?.status !== "pending_verification") fail("POLICY_REJECTED", "connection");
        const v = s.verification;
        if (!v || v.used || v.attempts >= 5 || v.expires_at <= s.clock) fail("POLICY_REJECTED", "expired");
        if (code.trim() !== v.code) {
          v.attempts += 1;
          fail("POLICY_REJECTED", "code");
        }
        v.used = true;
        s.connection = { ...s.connection, status: "active", verified_at: ts(), version: s.connection.version + 1 };
        return clone(s.connection);
      });
    },
    disconnect(key) {
      return once(key, () => {
        const s = state();
        if (!s.connection || s.connection.status === "disconnected") fail("NOT_FOUND");
        s.connection = { ...s.connection, status: "disconnected", verified_at: null, version: s.connection.version + 1 };
        for (const m of s.messages) {
          if (m.status === "queued" || m.status === "sending") Object.assign(m, { status: "failed", failure_reason: "disconnected", failed_at: ts() });
        }
        return clone(s.connection);
      });
    },
    async inbox(): Promise<Inbox> {
      const s = state();
      return { contacts: [...s.contacts].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")).map((k) => {
        const last = [...s.messages].reverse().find((m) => m.contact_id === k.id);
        return { ...contactView(k), last_message: last ? { direction: last.direction, body: last.body, status: last.status } : null };
      }) };
    },
    async conversation(contactId): Promise<Conversation> {
      const k = findContact(contactId);
      k.unread_count = 0;
      return { contact: contactView(k), messages: state().messages.filter((m) => m.contact_id === k.id).map(messageView) };
    },
    send(input, key) {
      return once(key, () => {
        const s = state();
        active();
        const k = findContact(input.contact_id);
        if (k.opted_out) fail("POLICY_REJECTED", "opted_out");
        let body: string;
        if (input.kind === "text") {
          if (!windowOpen(k)) fail("POLICY_REJECTED", "window");
          body = input.text.trim();
        } else {
          if (!TEMPLATES.some((t) => t.code === input.template_code && t.approved)) fail("POLICY_REJECTED", "template_code");
          if (!windowOpen(k) && k.opt_in_source === null) fail("POLICY_REJECTED", "opt_in");
          body = render(input.template_code, input.template_params);
        }
        const m: Message = { id: id("d0000000"), contact_id: k.id, direction: "outbound", kind: input.kind, body,
          template_code: input.kind === "template" ? input.template_code : null, status: "queued", failure_reason: null, created_at: ts(),
          sent_at: null, delivered_at: null, read_at: null, failed_at: null, provider_message_id: null, attempts: 0, unknown_once: false };
        s.messages.push(m);
        k.last_message_at = m.created_at;
        return messageView(m);
      });
    },
    handoff(contactId, handling, key) {
      return once(key, () => {
        const k = findContact(contactId);
        k.handling = handling;
        k.version += 1;
        return contactView(k);
      });
    },
    consent(contactId, optedIn, key) {
      return once(key, () => {
        const k = findContact(contactId);
        k.opted_out = !optedIn;
        if (optedIn) k.opt_in_source ??= "owner_declared";
        k.version += 1;
        return contactView(k);
      });
    },
    link(contactId, customerId, key) {
      return once(key, () => {
        const k = findContact(contactId);
        if (customerId !== null && !DEMO_CUSTOMERS.some((c) => c.id === customerId)) fail("NOT_FOUND", "customer_id");
        k.customer_id = customerId;
        k.version += 1;
        return contactView(k);
      });
    },
    async simPhone(phone): Promise<SimPhone> {
      const s = state();
      if (!s.connection || s.connection.status === "disconnected") fail("POLICY_REJECTED", "provider");
      return clone({ phone_e164: phone, messages: s.phone.filter((p) => p.to === phone).slice(-50).map(({ body, provider_message_id, created_at }) => ({ body, provider_message_id, created_at })) });
    },
    async simInbound(input, key) {
      // Sem cache de idempotência: como no servidor, a chave vira o id do evento e repetir é "duplicado".
      {
        const s = state();
        if (s.connection?.provider !== "simulated") fail("POLICY_REJECTED", "provider");
        const eventId = `sim:${key}`;
        if (s.events.has(eventId)) return { applied: 0, duplicates: 1 };
        s.events.add(eventId);
        if (s.connection.status !== "active") return { applied: 0, duplicates: 0 };
        if (input.kind === "inbound") {
          const k = upsertContact(input.phone_e164, input.profile_name);
          if (OPT_OUT.has(input.text.trim().toUpperCase())) k.opted_out = true;
          s.messages.push({ id: id("d0000000"), contact_id: k.id, direction: "inbound", kind: "text", body: input.text.trim(), template_code: null,
            status: "received", failure_reason: null, created_at: ts(), sent_at: null, delivered_at: null, read_at: null, failed_at: null,
            provider_message_id: null, attempts: 0, unknown_once: false });
          return { applied: 1, duplicates: 0 };
        }
        const m = s.messages.find((x) => x.provider_message_id === input.provider_message_id && x.direction === "outbound");
        if (!m) return { applied: 0, duplicates: 0 };
        const from: Record<string, ChannelMessageStatus[]> = { delivered: ["sent", "delivery_unknown"], read: ["sent", "delivered", "delivery_unknown"], failed: ["sent", "delivery_unknown", "sending"] };
        if (!from[input.status]!.includes(m.status)) return { applied: 0, duplicates: 0 };
        const now = ts();
        if (input.status === "delivered") Object.assign(m, { status: "delivered", delivered_at: now });
        else if (input.status === "read") Object.assign(m, { status: "read", delivered_at: m.delivered_at ?? now, read_at: now });
        else Object.assign(m, { status: "failed", failed_at: now, failure_reason: "provider" });
        return { applied: 1, duplicates: 0 };
      }
    },
    async dispatch() {
      const s = state();
      const r = { sent: 0, failed: 0, unknown: 0, reconciled: 0 };
      const c = s.connection;
      if (!c || c.status === "disconnected") return r;
      if (c.status === "pending_verification" && s.verification && !s.verification.dispatched) {
        s.verification.dispatched = true;
        s.phone.push({ to: c.phone_e164, body: render("verificacao_numero", [s.verification.code]), provider_message_id: `sim-${++s.seq}`, created_at: ts() });
        r.sent += 1;
      }
      for (const m of s.messages) {
        if (m.status === "delivery_unknown") {
          // Consulta de status (nunca reenvio): o simulado responde "enviada".
          Object.assign(m, { status: "sent", sent_at: m.sent_at ?? ts() });
          r.reconciled += 1;
          continue;
        }
        if (m.status !== "queued") continue;
        const to = s.contacts.find((k) => k.id === m.contact_id)!.phone_e164;
        m.attempts += 1;
        if (to.endsWith("0000")) {
          Object.assign(m, { status: "failed", failure_reason: "invalid_number", failed_at: ts() });
          r.failed += 1;
        } else if (to.endsWith("9999") && !m.unknown_once) {
          m.unknown_once = true;
          m.status = "delivery_unknown";
          r.unknown += 1;
        } else {
          m.provider_message_id = `sim-${++s.seq}`;
          Object.assign(m, { status: "sent", sent_at: ts() });
          s.phone.push({ to, body: m.body, provider_message_id: m.provider_message_id, created_at: m.sent_at! });
          r.sent += 1;
        }
      }
      return r;
    },
  };
}

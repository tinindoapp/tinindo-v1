// EMULAÇÃO da Privacidade para a demonstração sem servidor, sempre rotulada na tela. Mesmas regras do banco: só o
// dono pede; exportação com prazo de 24 h e link de 15 min; eliminação do negócio com carência de 7 dias,
// cancelável, uma agendada por vez; cliente final anonimizado na hora. O "arquivo" é um blob na aba; nada sai dela.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { CustomerOption, PrivacyErasure, PrivacyExport, PrivacyExportOutput, PrivacyPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], null, RETRYABLE.has(code), field);
}
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const NOW = Date.parse(FIXED_NOW);
const DAY = 86_400_000;

const CUSTOMERS: CustomerOption[] = [
  { id: "30000000-0000-4000-8000-0000000000a1", name: "Cliente Exemplo Ana" },
  { id: "30000000-0000-4000-8000-0000000000a2", name: "Cliente Exemplo Bruno" },
  { id: "30000000-0000-4000-8000-0000000000a3", name: "Maria Exemplo Silva" },
];

interface State {
  exports: PrivacyExport[];
  erasures: PrivacyErasure[];
  removed: Set<string>;
  idem: Map<string, unknown>;
  seq: number;
}
let shared: State | null = null;
const state = (): State => (shared ??= { exports: [], erasures: [], removed: new Set(), idem: new Map(), seq: 0 });
/** Só para testes. */
export function resetPrivacyDemo() {
  shared = null;
}
const id = (prefix: string) => `${prefix}-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;
const once = <T>(key: string, run: () => T): T => {
  const s = state();
  if (!s.idem.has(key)) s.idem.set(key, run());
  return structuredClone(s.idem.get(key) as T);
};

function download(exp: PrivacyExport): PrivacyExportOutput {
  const body = JSON.stringify({ format: "tinindo.export.v1", demo: true, scope: exp.scope, business: tenantA.name }, null, 2);
  const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([body], { type: "application/json" })) : "https://demo.tinindo.invalid/exportacao.json";
  return { export: structuredClone(exp), download: { url, expires_at: iso(NOW + 15 * 60_000) } };
}

export function createDemoPort(): PrivacyPort {
  return {
    kind: "demo",
    async exports() {
      return structuredClone(state().exports);
    },
    async exportData(input, key) {
      return once(key, () => {
        const s = state();
        if (s.exports.filter((e) => Date.parse(e.created_at) > NOW - DAY).length >= 5) fail("QUOTA_EXCEEDED", "exports");
        const customer = input.customer_id ?? null;
        if ((input.scope === "customer") !== (customer !== null)) fail("VALIDATION_ERROR", "customer_id");
        const exp: PrivacyExport = {
          id: id("57e00000"), scope: input.scope, customer_id: customer, status: "ready", bytes: 2048,
          created_at: iso(NOW), ready_at: iso(NOW), expires_at: iso(NOW + DAY),
        };
        s.exports.unshift(exp);
        return download(exp);
      });
    },
    async exportLink(exportId) {
      const exp = state().exports.find((e) => e.id === exportId) ?? fail("NOT_FOUND");
      if (exp.status !== "ready") fail("POLICY_REJECTED", "status");
      return download(exp);
    },
    async erasures() {
      return structuredClone(state().erasures);
    },
    async erase(input, key) {
      return once(key, () => {
        const s = state();
        if (input.confirm !== "ELIMINAR") fail("VALIDATION_ERROR", "confirm");
        const base = { id: id("57f00000"), requested_at: iso(NOW), cancelled_at: null };
        let er: PrivacyErasure;
        if (input.scope === "business") {
          if (s.erasures.some((e) => e.scope === "business" && e.status === "scheduled")) fail("POLICY_REJECTED", "scheduled");
          er = { ...base, scope: "business", customer_id: null, status: "scheduled", execute_after: iso(NOW + 7 * DAY), done_at: null, summary: null };
        } else {
          const customer = input.customer_id ?? fail("VALIDATION_ERROR", "customer_id");
          s.removed.add(customer);
          er = { ...base, scope: "customer", customer_id: customer, status: "done", execute_after: iso(NOW), done_at: iso(NOW),
            summary: { customers: 1, channel_messages: 0, public_booking_requests: 0 } };
        }
        s.erasures.unshift(er);
        return er;
      });
    },
    async cancelErasure(erasureId, key) {
      return once(key, () => {
        const er = state().erasures.find((e) => e.id === erasureId) ?? fail("NOT_FOUND");
        if (er.status !== "scheduled") fail("POLICY_REJECTED", "status");
        er.status = "cancelled";
        er.cancelled_at = iso(NOW);
        return structuredClone(er);
      });
    },
    async customers(q) {
      const needle = q.trim().toLowerCase();
      return CUSTOMERS.filter((c) => !state().removed.has(c.id))
        .filter((c) => !needle || c.name.toLowerCase().includes(needle));
    },
  };
}

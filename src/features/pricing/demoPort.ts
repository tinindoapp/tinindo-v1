// EMULAÇÃO de Preços (P05) para a demonstração sem servidor: mesmo cálculo do banco (domínio TS),
// proposta inativa com prévia, aprovação presa ao hash/versão por 15 min e uso único, uma regra ativa
// por serviço. Nada sai do navegador; a tela diz que são dados de exemplo.
import {
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  PricingApproveRuleInput,
  PricingDeactivateRuleInput,
  PricingProposeRuleInput,
  PricingPublishRuleInput,
  type PricingRule,
  type PricingRuleProposal,
  RETRYABLE,
} from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import type { z } from "zod";
import { ApiError } from "../../lib/api/client.ts";
import { computePrice } from "../../../supabase/functions/_shared/domain/pricing/price.ts";
import type { PricingPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) fail("VALIDATION_ERROR", r.error.issues[0]?.path.join("."));
  return r.data;
}
async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createDemoPort(): PricingPort {
  const now = new Date(FIXED_NOW);
  const services = fixtureServices.filter((s) => s.tenant_id === FX.tenants.A);
  let seq = 0;
  const id = (p: string) => `${p}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  // Regra de exemplo já publicada (a mesma que explica o R$ 51,00 da agenda de demonstração).
  const rules: PricingRule[] = [{
    rule_id: "68000000-0000-4000-8000-000000000003", service_id: FX.services.corteA, rule_version: 3,
    windows: [{ weekday: 2, local_start: "13:00", local_end: "17:00" }], discount_bps: 1500, max_discount_bps: 1500,
    target_margin_bps: 0, valid: { starts_at: "2026-10-01T03:00:00Z", ends_at: "2027-01-01T03:00:00Z" }, active: true,
    published_at: "2026-10-01T12:00:00Z", version: 1,
  }];
  const proposals: PricingRuleProposal[] = [];
  const approvals = new Map<string, { proposal_id: string; hash: string; version: number; expires: number; used: boolean }>();
  const idem = new Map<string, unknown>();
  const once = async <T>(k: string, run: () => Promise<T> | T): Promise<T> => {
    if (idem.has(k)) return structuredClone(idem.get(k)) as T;
    const v = await run();
    idem.set(k, structuredClone(v));
    return v;
  };

  return {
    kind: "demo",
    now: () => new Date(now),
    timezone: async () => tenantA.timezone,
    services: async () => structuredClone(services),
    list: async () => structuredClone({
      rules: [...rules].sort((a, b) => Number(b.active) - Number(a.active) || b.published_at.localeCompare(a.published_at)),
      proposals: proposals.filter((p) => p.status === "proposed"),
    }),
    propose: (raw, key) => once(`propose:${key}`, async () => {
      const i = parse(PricingProposeRuleInput, raw);
      const svc = services.find((s) => s.id === i.service_id && s.active) ?? fail("NOT_FOUND", "service_id");
      const r = computePrice({ base_cents: svc.base_price_cents, manual_floor_cents: svc.min_price_cents,
        estimated_cost_cents: svc.estimated_cost_cents, fee_bps: svc.fee_bps, target_margin_bps: i.target_margin_bps,
        discount_bps: i.discount_bps, max_discount_bps: i.max_discount_bps });
      if (!r.ok) fail("POLICY_REJECTED", r.error === "MARGIN_DENOMINATOR" ? "target_margin_bps" : "floor");
      const windows = [...i.windows].sort((a, b) => a.weekday - b.weekday || a.local_start.localeCompare(b.local_start));
      const payload = { service_id: i.service_id, windows, discount_bps: i.discount_bps, max_discount_bps: i.max_discount_bps,
        target_margin_bps: i.target_margin_bps, valid: i.valid, base: svc.base_price_cents };
      const p: PricingRuleProposal = {
        proposal_id: id("69000000"), service_id: i.service_id, discount_bps: i.discount_bps, max_discount_bps: i.max_discount_bps,
        target_margin_bps: i.target_margin_bps, windows, valid: i.valid, status: "proposed", version: 1,
        payload_hash: await sha256(JSON.stringify(payload)),
        expires_at: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
        preview: { example_base_cents: svc.base_price_cents, example_final_cents: r.final_cents, floor_cents: r.floor_cents,
          floor_is_manual_only: r.floor_is_manual_only, economic_floor_cents: r.economic_floor_cents,
          effective_discount_bps: r.effective_discount_bps, reason: r.reason },
      };
      proposals.push(p);
      return structuredClone(p);
    }),
    approve: (raw, key) => once(`approve:${key}`, () => {
      const i = parse(PricingApproveRuleInput, raw);
      const p = proposals.find((x) => x.proposal_id === i.proposal_id) ?? fail("NOT_FOUND");
      if (p.version !== i.expected_version) fail("STALE_VERSION");
      if (p.status !== "proposed" || p.payload_hash !== i.payload_hash) fail("POLICY_REJECTED", "payload_hash");
      const approval_id = id("6a000000");
      const expires = now.getTime() + 15 * 60_000;
      approvals.set(approval_id, { proposal_id: p.proposal_id, hash: p.payload_hash!, version: p.version, expires, used: false });
      return { approval_id, proposal_id: p.proposal_id, approver_user_id: FX.users.ownerA, approved_at: now.toISOString(),
        expires_at: new Date(expires).toISOString() };
    }),
    publish: (raw, key) => once(`publish:${key}`, () => {
      const i = parse(PricingPublishRuleInput, raw);
      const p = proposals.find((x) => x.proposal_id === i.proposal_id) ?? fail("NOT_FOUND");
      if (p.version !== i.expected_version) fail("STALE_VERSION");
      const a = approvals.get(i.approval_id);
      if (!a || a.used || a.proposal_id !== p.proposal_id || a.hash !== p.payload_hash || a.expires <= now.getTime()) {
        fail("POLICY_REJECTED", "approval_id");
      }
      a.used = true;
      p.status = "published";
      p.version += 1;
      for (const r of rules) if (r.service_id === p.service_id && r.active) { r.active = false; r.version += 1; }
      const rule: PricingRule = {
        rule_id: id("68000000"), service_id: p.service_id,
        rule_version: Math.max(0, ...rules.filter((r) => r.service_id === p.service_id).map((r) => r.rule_version)) + 1,
        windows: p.windows!, discount_bps: p.discount_bps, max_discount_bps: p.max_discount_bps!, target_margin_bps: p.target_margin_bps!,
        valid: p.valid!, active: true, published_at: now.toISOString(), version: 1,
      };
      rules.push(rule);
      return structuredClone(rule);
    }),
    deactivate: (raw, key) => once(`deactivate:${key}`, () => {
      const i = parse(PricingDeactivateRuleInput, raw);
      const r = rules.find((x) => x.rule_id === i.rule_id) ?? fail("NOT_FOUND");
      if (r.version !== i.expected_version) fail("STALE_VERSION");
      if (!r.active) fail("POLICY_REJECTED", "active");
      r.active = false;
      r.version += 1;
      return structuredClone(r);
    }),
  };
}

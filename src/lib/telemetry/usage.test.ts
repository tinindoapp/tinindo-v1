import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "../api/client.ts";
import type { ApiCall } from "../api/session-client.ts";
import {
  commandName,
  createUsageRecorder,
  instrument,
  outcomeOf,
  resetUsageForTests,
  SCREEN_SEGMENTS,
  screenName,
  usageCall,
  type UsageEvent,
  USAGE_RECORD_PATH,
} from "./usage.ts";

const TENANT = "10000000-0000-4000-8000-00000000000a";
afterEach(() => resetUsageForTests());

function capture() {
  const batches: { batch_id: string; events: UsageEvent[] }[] = [];
  const recorder = createUsageRecorder({
    send: async (b) => { batches.push(b); return { enabled: true }; },
    schedule: () => null,
    newId: () => `lote-${batches.length + 1}`,
  });
  return { recorder, batches };
}

describe("uso · nomes", () => {
  it("tela: só /app, sem id nem query; página pública e slug com nome ficam de fora", () => {
    expect(screenName("/app/clientes/30000000-0000-4000-8000-0000000000a1?q=Maria")).toBe("/app/clientes/:id");
    expect(screenName("/app/agenda/atendimento/60000000-0000-4000-8000-000000000001")).toBe("/app/agenda/atendimento/:id");
    expect(screenName("/p/maria-da-silva")).toBeNull();
    expect(screenName("/reserva/joao")).toBeNull();
  });
  it("comando: função/operação; com id, query ou texto vira null", () => {
    expect(commandName("/scheduling/booking.create")).toBe("scheduling/booking.create");
    expect(commandName("/crm/customers?search=Maria")).toBeNull();
    expect(commandName("/crm/customer.upsert/30000000-0000-4000-8000-0000000000a1")).toBeNull();
  });
  it("resultado pelo status; a mensagem do erro nunca sai", () => {
    expect(outcomeOf(new ApiError("POLICY_REJECTED", "Maria já tem horário às 10h", 422, null, false))).toEqual({ outcome: "refused", code: "POLICY_REJECTED" });
    expect(outcomeOf(new ApiError("INTERNAL_ERROR", "falhou", 500, null, true))).toEqual({ outcome: "error", code: "INTERNAL_ERROR" });
    expect(outcomeOf(new TypeError("Failed to fetch"))).toEqual({ outcome: "error", code: "NETWORK" });
  });
});

describe("uso · vocabulário das telas", () => {
  it("todo trecho fixo das rotas dos módulos está no vocabulário (rota nova entra aqui)", () => {
    // Os testes rodam na raiz do repositório.
    const files = ["src/app/router.tsx", "src/app/public-app.tsx"];
    for (const m of readdirSync("src/features")) {
      for (const f of ["module.tsx", "public-routes.tsx"]) {
        try { readFileSync(`src/features/${m}/${f}`); files.push(`src/features/${m}/${f}`); } catch { /* sem o arquivo */ }
      }
    }
    const segments = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/path: "([^"]+)"/g)].flatMap((m) => m[1]!.split("/")))
      .filter((s) => s && !s.startsWith(":") && s !== "*");
    expect(segments.length).toBeGreaterThan(40);
    expect(segments.filter((s) => !SCREEN_SEGMENTS.has(s))).toEqual([]);
  });
});

describe("uso · lote", () => {
  it("junta e envia em lote; mesma tela seguida conta uma vez", async () => {
    const { recorder, batches } = capture();
    recorder.screen("/app/agenda");
    recorder.screen("/app/agenda");
    recorder.screen("/app/caixa");
    recorder.command("/finance/payment.record", { outcome: "ok", code: null });
    await recorder.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.events.map((e) => [e.kind, e.name, e.outcome])).toEqual([
      ["screen", "/app/agenda", null], ["screen", "/app/caixa", null], ["command", "finance/payment.record", "ok"],
    ]);
  });
  it("negócio desligou: para de juntar", async () => {
    const send = vi.fn(async () => ({ enabled: false }));
    const recorder = createUsageRecorder({ send, schedule: () => null });
    recorder.screen("/app/agenda");
    await recorder.flush();
    recorder.screen("/app/caixa");
    expect(recorder.enabled).toBe(false);
    expect(recorder.pending).toBe(0);
  });
  it("envio que falha não vira erro e não trava a tela", async () => {
    const recorder = createUsageRecorder({ send: async () => { throw new Error("rede"); }, schedule: () => null });
    recorder.screen("/app/agenda");
    await expect(recorder.flush()).resolves.toBeUndefined();
  });
});

describe("uso · ponto único de chamada", () => {
  const Out = z.object({ ok: z.boolean() });
  it("comando (com chave) é medido; leitura e o próprio envio não", async () => {
    const { recorder, batches } = capture();
    const base = vi.fn(async (path: string) => {
      if (path.includes("cancel")) throw new ApiError("POLICY_REJECTED", "não dá", 422, null, false);
      return { data: { ok: true }, requestId: null };
    }) as unknown as ApiCall;
    const call = instrument(base, recorder);
    await call("/scheduling/booking.create", Out, { method: "POST", tenantId: TENANT, idempotencyKey: "k", body: { customer_name: "Maria" } });
    await call("/scheduling/booking.list", Out, { method: "POST", tenantId: TENANT, body: {} });
    await call(USAGE_RECORD_PATH, Out, { method: "POST", tenantId: TENANT, idempotencyKey: "k2", body: {} });
    await expect(call("/scheduling/booking.cancel", Out, { method: "POST", tenantId: TENANT, idempotencyKey: "k3", body: { reason: "Maria pediu" } }))
      .rejects.toBeInstanceOf(ApiError);
    await recorder.flush();
    expect(batches[0]!.events.map((e) => [e.name, e.outcome, e.code])).toEqual([
      ["scheduling/booking.create", "ok", null],
      ["scheduling/booking.cancel", "refused", "POLICY_REJECTED"],
    ]);
  });
  it("um cliente medido por sessão, qualquer que seja o negócio (regra do P53); comando vai ao negócio da chamada", async () => {
    const sent: Record<string, UsageEvent[]> = {};
    resetUsageForTests((_call, tenantId) => createUsageRecorder({
      send: async (b) => { (sent[tenantId] ??= []).push(...b.events); return { enabled: true }; }, schedule: () => null,
    }));
    const base = vi.fn(async () => ({ data: { ok: true }, requestId: null })) as unknown as ApiCall;
    const none = usageCall(base, null);
    const a = usageCall(base, TENANT);
    const b = usageCall(base, "10000000-0000-4000-8000-00000000000b");
    expect(a).toBe(none);
    expect(b).toBe(a);
    await a("/crm/customer.upsert", z.object({ ok: z.boolean() }), { method: "POST", tenantId: TENANT, idempotencyKey: "k", body: {} });
    // Voltar para A e sair dele de novo envia o que A juntou.
    usageCall(base, TENANT);
    usageCall(base, "10000000-0000-4000-8000-00000000000b");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent[TENANT]?.some((e) => e.name === "crm/customer.upsert")).toBe(true);
  });
});

// Teste de mutação: dado pessoal plantado em todo lugar que o app passa ao gravador. Nenhum aparece no lote.
describe("uso · nenhum evento carrega dado pessoal", () => {
  const PII = [
    "Maria da Silva", "maria.silva@exemplo.com", "+5511999990000", "(11) 99999-0000", "123.456.789-09",
    "Rua das Flores, 123", "R$ 150,00", "15000", "corte com barba e sobrancelha", "30000000-0000-4000-8000-0000000000a1",
  ];
  const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9@.+-]+/g, "-");

  it.each(PII)("%s não sai em tela, comando, corpo, erro ou query", async (pii) => {
    const { recorder, batches } = capture();
    const base = (async (path: string) => {
      if (path.endsWith("fail")) throw new ApiError("VALIDATION_ERROR", `Campo inválido: ${pii}`, 400, null, false, pii, { value: pii });
      return { data: { ok: true }, requestId: null };
    }) as unknown as ApiCall;
    const call = instrument(base, recorder);
    const Out = z.object({ ok: z.boolean() });
    recorder.screen(`/app/clientes/${slug(pii)}`);
    recorder.screen(`/app/clientes?busca=${encodeURIComponent(pii)}`);
    recorder.screen(`/p/${slug(pii)}`);
    recorder.screen(`/app/${encodeURIComponent(pii)}/editar`);
    await call(`/crm/customer.upsert`, Out, { method: "POST", tenantId: TENANT, idempotencyKey: pii, body: { name: pii, phone: pii, note: pii } });
    await call(`/crm/customer.upsert?nome=${encodeURIComponent(pii)}`, Out, { method: "POST", tenantId: TENANT, idempotencyKey: "k", body: { name: pii } });
    await call(`/crm/${slug(pii)}.fail`, Out, { method: "POST", tenantId: TENANT, idempotencyKey: "k", body: {} }).catch(() => undefined);
    await call(`/crm/customer.fail`, Out, { method: "POST", tenantId: TENANT, idempotencyKey: "k", body: { name: pii } }).catch(() => undefined);
    await recorder.flush();
    const sent = JSON.stringify(batches);
    const variants = [pii, encodeURIComponent(pii), slug(pii), pii.toLowerCase(), pii.replace(/\D/g, "")].filter((v) => v.length >= 3);
    for (const v of variants) expect(sent, v).not.toContain(v);
    // O que sobra é só vocabulário fechado.
    for (const e of batches.flatMap((b) => b.events)) {
      expect(e.name).toMatch(/^(\/app(\/[a-z0-9:._-]{1,40})*|[a-z][a-z0-9-]*\/[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/);
      expect(e.code === null || /^[A-Z][A-Z0-9_]+$/.test(e.code)).toBe(true);
      expect(Object.keys(e).sort()).toEqual(["at", "code", "kind", "name", "outcome"]);
    }
  });
});

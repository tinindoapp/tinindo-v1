import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createJobsHandler, JOBS_SECRET_HEADER } from "../jobs/handler.ts";
import { createWaitlistHandler, type WaitlistDeps } from "./handler.ts";

const TOKEN = "a".repeat(43);
const setup = (rpc: WaitlistDeps["rpc"]) => {
  const log = vi.fn();
  return { handler: createWaitlistHandler({ rpc, allowedOrigins: [], log }), log };
};
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/waitlist/${op}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("Edge Function waitlist · link da oferta", () => {
  it("ver a oferta é anônimo, não exige chave e não manda JWT", async () => {
    const view = { business_name: "Barbearia", service_name: "Corte", slot: { starts_at: "2026-10-27T13:00:00Z", ends_at: "2026-10-27T13:30:00Z" },
      timezone: "America/Sao_Paulo", price_cents: 6000, status: "offered", expires_at: "2026-10-20T12:15:00Z" };
    const rpc = vi.fn(async () => ({ data: view, error: null }));
    const res = await setup(rpc).handler(post("waitlist.offer_view", { token: TOKEN }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(null, "waitlist_offer_view", { p_token: TOKEN });
  });

  it("aceitar exige Idempotency-Key; token malformado = inexistente (404), sem consultar", async () => {
    const rpc = vi.fn();
    expect((await setup(rpc).handler(post("waitlist.accept_offer", { token: TOKEN }))).status).toBe(400);
    const bad = await setup(rpc).handler(post("waitlist.accept_offer", { token: "curto" }, { "Idempotency-Key": "chave-aceite-00000001" }));
    expect(ErrorEnvelope.parse(await bad.json()).error.code).toBe("NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("oferta vencida volta como 422 e o log não leva o token", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT422", message: "POLICY_REJECTED", hint: "expires_at" } }));
    const { handler, log } = setup(rpc);
    const res = await handler(post("waitlist.accept_offer", { token: TOKEN }, { "Idempotency-Key": "chave-aceite-00000002" }));
    expect(res.status).toBe(422);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("rotas do dono passam pelo handler com tenant e JWT", async () => {
    const rpc = vi.fn(async () => ({ data: { entries: [], candidates: [], offers: [] }, error: null }));
    const res = await setup(rpc).handler(new Request("http://edge/functions/v1/waitlist/waitlist.list", {
      method: "POST", headers: { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A }, body: "{}",
    }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "waitlist_list", { p_tenant_id: FX.tenants.A });
  });
});

describe("Edge Function jobs", () => {
  const secret = "s".repeat(40);
  it("sem o segredo não roda nada", async () => {
    const runJobs = vi.fn();
    const handler = createJobsHandler({ secret, runJobs });
    const res = await handler(new Request("http://edge/functions/v1/jobs", { method: "POST", headers: { [JOBS_SECRET_HEADER]: "x".repeat(40) } }));
    expect(res.status).toBe(401);
    expect(runJobs).not.toHaveBeenCalled();
  });

  it("com o segredo roda uma rodada e devolve o resumo", async () => {
    const runJobs = vi.fn(async () => ({ data: { done: 2, retried: 0, dead: 0 }, error: null }));
    const res = await createJobsHandler({ secret, runJobs })(new Request("http://edge/functions/v1/jobs", {
      method: "POST", headers: { [JOBS_SECRET_HEADER]: secret },
    }));
    expect(res.status).toBe(200);
    expect(runJobs).toHaveBeenCalledWith(100);
  });

  it("segredo curto é recusado na inicialização", () => {
    expect(() => createJobsHandler({ secret: "curto", runJobs: vi.fn() })).toThrow();
  });
});

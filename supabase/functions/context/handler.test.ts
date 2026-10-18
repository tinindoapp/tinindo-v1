import { describe, expect, it, vi } from "vitest";
import { ContextResponse, ErrorEnvelope, successEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createContextHandler, type ContextDeps } from "./handler.ts";

const ORIGIN = "http://localhost:5173";
const row = {
  actor_user_id: FX.users.ownerA,
  tenant_id: FX.tenants.A,
  role: "owner",
  tenant_name: "Barbearia Exemplo A",
  timezone: "America/Sao_Paulo",
  currency: "BRL",
};

function setup(resolve: ContextDeps["resolveContext"]) {
  const log = vi.fn();
  const handler = createContextHandler({
    resolveContext: resolve,
    allowedOrigins: [ORIGIN],
    clock: { now: () => new Date("2026-10-20T12:00:00Z") },
    log,
  });
  return { handler, log };
}

const req = (headers: Record<string, string> = {}, method = "GET") =>
  new Request("http://edge/functions/v1/context", { method, headers: { Origin: ORIGIN, ...headers } });

describe("Edge Function context", () => {
  it("sem token → 401 AUTH_REQUIRED, sem consultar o banco", async () => {
    const resolve = vi.fn();
    const res = await setup(resolve).handler(req({ "X-Tinindo-Tenant": FX.tenants.A }));
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("AUTH_REQUIRED");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("tenant ausente ou inválido → 400 com campo", async () => {
    const res = await setup(vi.fn()).handler(req({ Authorization: "Bearer t", "X-Tinindo-Tenant": "' or 1=1" }));
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.parse(await res.json()).error.field).toBe("tenant_id");
  });

  it("sem membership → 403 neutro (não revela existência do tenant)", async () => {
    const res = await setup(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } })).handler(
      req({ Authorization: "Bearer t", "X-Tinindo-Tenant": FX.tenants.B }),
    );
    expect(res.status).toBe(403);
    const body = ErrorEnvelope.parse(await res.json());
    expect(body.error.message).not.toContain(FX.tenants.B);
  });

  it("sucesso → 200 no envelope v1 e repassa só o token do usuário", async () => {
    const resolve = vi.fn(async () => ({ data: [row], error: null }));
    const res = await setup(resolve).handler(
      req({ Authorization: "Bearer user-jwt", "X-Tinindo-Tenant": FX.tenants.A }),
    );
    expect(res.status).toBe(200);
    const body = successEnvelope(ContextResponse).parse(await res.json());
    expect(body.data.role).toBe("owner");
    expect(body.meta.as_of).toBe("2026-10-20T12:00:00.000Z");
    expect(resolve).toHaveBeenCalledWith("user-jwt", FX.tenants.A);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("propaga X-Request-Id válido e ignora valor arbitrário", async () => {
    const ok = vi.fn(async () => ({ data: [row], error: null }));
    const rid = "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10";
    const res1 = await setup(ok).handler(req({ Authorization: "Bearer t", "X-Tinindo-Tenant": FX.tenants.A, "X-Request-Id": rid }));
    expect(res1.headers.get("X-Request-Id")).toBe(rid);
    const res2 = await setup(ok).handler(req({ Authorization: "Bearer t", "X-Tinindo-Tenant": FX.tenants.A, "X-Request-Id": "<script>" }));
    expect(res2.headers.get("X-Request-Id")).not.toBe("<script>");
  });

  it("falha de rede ao banco → 503 retryable", async () => {
    const res = await setup(async () => {
      throw new Error("ECONNRESET");
    }).handler(req({ Authorization: "Bearer t", "X-Tinindo-Tenant": FX.tenants.A }));
    expect(res.status).toBe(503);
    expect(ErrorEnvelope.parse(await res.json()).error.retryable).toBe(true);
  });

  it("resposta do banco fora do contrato → 500, sem vazar a linha", async () => {
    const res = await setup(async () => ({ data: [{ ...row, role: "superadmin" }], error: null })).handler(
      req({ Authorization: "Bearer t", "X-Tinindo-Tenant": FX.tenants.A }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("superadmin");
  });

  it("CORS só para origem permitida; log sem tenant nem token", async () => {
    const { handler, log } = setup(async () => ({ data: [row], error: null }));
    const pre = await handler(new Request("http://edge/x", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
    await handler(req({ Authorization: "Bearer segredo", "X-Tinindo-Tenant": FX.tenants.A }));
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("segredo");
    expect(logged).not.toContain(FX.tenants.A);
  });
});

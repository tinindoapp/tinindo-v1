import { describe, expect, it, vi } from "vitest";
import { BusinessCreateOutput, ErrorEnvelope, successEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { canonicalJson, createIdentityHandler, type IdentityDeps, MAX_BODY_BYTES, requestHash } from "./handler.ts";
import { CustomerLinkIssueOutput, CustomerLinkRedeemOutput, OnboardingSaveOutput } from "./schemas.ts";

const ORIGIN = "http://localhost:5173";
const IDEM = "5f0c1d7e-7c1a-4f3e-9a55-0d2f1c9b8e11";
const CODE = "Q2hhdmUtZGUtdGVzdGUtc2ludGV0aWNhLTAwMDAwMDA";
const TENANT_NEW = "7d3b8f30-9f5e-4c51-8a0e-2a1c3b4d5e6f";

const created = {
  status_code: 201,
  body: {
    tenant: {
      id: TENANT_NEW, name: "Salão Exemplo C", profession: "hairdresser", timezone: "America/Sao_Paulo",
      currency: "BRL", status: "active", version: 1,
    },
    resource_id: "8e4c9a41-0b6f-4d62-9b1f-3b2d4c5e6f70",
  },
};

function setup(rpc: IdentityDeps["rpc"]) {
  const log = vi.fn();
  const handler = createIdentityHandler({
    rpc,
    allowedOrigins: [ORIGIN],
    clock: { now: () => new Date("2026-10-20T12:00:00Z") },
    log,
  });
  return { handler, log };
}

const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/identity/${op}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN, Authorization: "Bearer user-jwt", "Idempotency-Key": IDEM, "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const business = {
  name: "Salão Exemplo C",
  profession: "hairdresser",
  accepted_policy_versions: ["termos-piloto-v0", "privacidade-piloto-v0"],
};

async function errorOf(res: Response) {
  return ErrorEnvelope.parse(await res.json()).error;
}

describe("Edge Function identity · borda HTTP", () => {
  it("operação desconhecida → 404 sem chamar o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("tenant.drop", {}));
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("GET num comando → 400", async () => {
    const res = await setup(vi.fn()).handler(
      new Request("http://edge/identity/business.create", { headers: { Authorization: "Bearer t" } }),
    );
    expect(res.status).toBe(400);
  });

  it("preflight CORS → 204 com origem permitida", async () => {
    const res = await setup(vi.fn()).handler(
      new Request("http://edge/identity/business.create", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("idempotency-key");
  });

  it("sem token → 401, sem consultar o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("business.create", business, { Authorization: "" }));
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("AUTH_REQUIRED");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem Idempotency-Key → 400 no campo idempotency_key", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("business.create", business, { "Idempotency-Key": "" }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).field).toBe("idempotency_key");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("comando do negócio sem tenant selecionado → 400 tenant_id", async () => {
    const res = await setup(vi.fn()).handler(post("onboarding.save", { expected_version: 1 }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).field).toBe("tenant_id");
  });

  it("JSON inválido, corpo grande e campo fora do contrato → 400", async () => {
    const { handler } = setup(vi.fn());
    expect((await handler(post("business.create", "{nome"))).status).toBe(400);
    expect((await handler(post("business.create", "x".repeat(MAX_BODY_BYTES + 1)))).status).toBe(400);
    const res = await handler(post("business.create", { ...business, profession: "dentist" }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).field).toBe("profession");
  });

  it("onboarding: concluir sem objetivo é rejeitado antes do banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(
      post("onboarding.save", { expected_version: 1, mark_complete: true }, { "X-Tinindo-Tenant": FX.tenants.A }),
    );
    expect(res.status).toBe(400);
    expect((await errorOf(res)).field).toBe("mark_complete");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Edge Function identity · business.create", () => {
  it("201 no envelope v1; repassa só o JWT do usuário, a chave e o hash", async () => {
    const rpc = vi.fn(async () => ({ data: created, error: null }));
    const res = await setup(rpc).handler(post("business.create", business));
    expect(res.status).toBe(201);
    const body = successEnvelope(BusinessCreateOutput).parse(await res.json());
    expect(body.data.tenant.id).toBe(TENANT_NEW);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    expect(rpc).toHaveBeenCalledTimes(1);
    const [token, fn, args] = rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(token).toBe("user-jwt");
    expect(fn).toBe("business_create");
    expect(args).toMatchObject({
      p_name: "Salão Exemplo C",
      p_profession: "hairdresser",
      p_timezone: "America/Sao_Paulo", // default do contrato
      p_idem_key: IDEM,
    });
    expect(args.p_request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args).not.toHaveProperty("p_tenant_id");
  });

  it("ignora X-Tinindo-Tenant: criar negócio não depende de seleção", async () => {
    const rpc = vi.fn(async () => ({ data: created, error: null }));
    await setup(rpc).handler(post("business.create", business, { "X-Tinindo-Tenant": FX.tenants.B }));
    const args = (rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect(JSON.stringify(args)).not.toContain(FX.tenants.B);
  });

  it("mesmo payload com chaves em outra ordem → mesmo hash; payload diferente → outro hash", async () => {
    const a = await requestHash({ name: "X", profession: "barber", timezone: "America/Sao_Paulo", accepted_policy_versions: ["v1"] });
    const b = await requestHash({ accepted_policy_versions: ["v1"], timezone: "America/Sao_Paulo", profession: "barber", name: "X" });
    const c = await requestHash({ accepted_policy_versions: ["v1"], timezone: "America/Sao_Paulo", profession: "barber", name: "Y" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe('{"a":[2,{"d":3}],"b":1}');
  });

  it("espaços nas pontas não mudam o hash (normalização antes do hash)", async () => {
    const rpc = vi.fn(async () => ({ data: created, error: null }));
    const { handler } = setup(rpc);
    await handler(post("business.create", business));
    await handler(post("business.create", { ...business, name: "  Salão Exemplo C " }));
    const hashes = rpc.mock.calls.map((c) => (c as unknown as [string, string, Record<string, unknown>])[2].p_request_hash);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it.each([
    [{ code: "PT409", message: "IDEMPOTENCY_MISMATCH" }, 409, "IDEMPOTENCY_MISMATCH", false],
    [{ code: "PT429", message: "QUOTA_EXCEEDED" }, 429, "QUOTA_EXCEEDED", true],
    [{ code: "PT403", message: "FORBIDDEN" }, 403, "FORBIDDEN", false],
    [{ code: "PT401", message: "AUTH_REQUIRED" }, 401, "AUTH_REQUIRED", false],
    [{ code: "PT400", message: "VALIDATION_ERROR", hint: "timezone" }, 400, "VALIDATION_ERROR", false],
  ])("erro do banco %o → %i %s", async (dbError, status, code, retryable) => {
    const res = await setup(async () => ({ data: null, error: dbError })).handler(post("business.create", business));
    expect(res.status).toBe(status);
    const err = await errorOf(res);
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
  });

  it("campo vindo do hint do banco é repassado", async () => {
    const res = await setup(async () => ({
      data: null, error: { code: "PT400", message: "VALIDATION_ERROR", hint: "timezone" },
    })).handler(post("business.create", business));
    expect((await errorOf(res)).field).toBe("timezone");
  });

  it("banco fora do ar → 503 retryable", async () => {
    const res = await setup(async () => {
      throw new Error("ECONNRESET");
    }).handler(post("business.create", business));
    expect(res.status).toBe(503);
    expect((await errorOf(res)).retryable).toBe(true);
  });

  it("resposta do banco fora do contrato → 500, sem vazar o corpo", async () => {
    const res = await setup(async () => ({
      data: { status_code: 201, body: { tenant: { id: "x" }, secret: "nao" } }, error: null,
    })).handler(post("business.create", business));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("nao");
  });
});

describe("Edge Function identity · onboarding e vínculo", () => {
  it("onboarding.save repassa o tenant selecionado e expected_version", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        status_code: 200,
        body: {
          onboarding: {
            tenant_id: FX.tenants.A, goal: "fill_schedule", cancellation_notice_hours: 2,
            late_cancellation_fee_bps: null, completed_at: "2026-10-20T12:00:00.000Z", version: 2,
          },
        },
      },
      error: null,
    }));
    const res = await setup(rpc).handler(
      post("onboarding.save", { expected_version: 1, goal: "fill_schedule", cancellation_notice_hours: 2, mark_complete: true },
        { "X-Tinindo-Tenant": FX.tenants.A }),
    );
    expect(res.status).toBe(200);
    expect(successEnvelope(OnboardingSaveOutput).parse(await res.json()).data.onboarding.version).toBe(2);
    const [, fn, args] = rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(fn).toBe("onboarding_save");
    expect(args).toMatchObject({
      p_tenant_id: FX.tenants.A, p_expected_version: 1, p_goal: "fill_schedule",
      p_cancellation_notice_hours: 2, p_late_cancellation_fee_bps: null, p_mark_complete: true,
    });
  });

  it("STALE_VERSION do banco → 409", async () => {
    const res = await setup(async () => ({ data: null, error: { code: "PT409", message: "STALE_VERSION" } })).handler(
      post("onboarding.save", { expected_version: 1 }, { "X-Tinindo-Tenant": FX.tenants.A }),
    );
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("STALE_VERSION");
  });

  it("customer_link.issue devolve o código uma vez; repetição sem código é válida", async () => {
    const first = { invite_id: "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", customer_id: FX.customers.abInA, expires_at: "2026-10-23T12:00:00.000Z" };
    const { handler } = setup(
      vi.fn()
        .mockResolvedValueOnce({ data: { status_code: 201, body: { ...first, code: CODE } }, error: null })
        .mockResolvedValueOnce({ data: { status_code: 201, body: { ...first, code: null } }, error: null }),
    );
    const headers = { "X-Tinindo-Tenant": FX.tenants.A };
    const a = successEnvelope(CustomerLinkIssueOutput).parse(await (await handler(post("customer_link.issue", { customer_id: FX.customers.abInA }, headers))).json());
    const b = successEnvelope(CustomerLinkIssueOutput).parse(await (await handler(post("customer_link.issue", { customer_id: FX.customers.abInA }, headers))).json());
    expect(a.data.code).toBe(CODE);
    expect(b.data.code).toBeNull();
  });

  it("customer_link.redeem: código vai só para a RPC; log não tem código, token nem tenant", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        status_code: 201,
        body: { link_id: "0b1c2d3e-4f50-4a61-8b72-c3d4e5f60718", tenant_id: FX.tenants.A, tenant_name: "Barbearia Exemplo A", verified_at: "2026-10-20T12:00:00.000Z" },
      },
      error: null,
    }));
    const { handler, log } = setup(rpc);
    const res = await handler(post("customer_link.redeem", { code: ` ${CODE} ` }));
    expect(res.status).toBe(201);
    successEnvelope(CustomerLinkRedeemOutput).parse(await res.json());
    const [, fn, args] = rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(fn).toBe("customer_link_redeem");
    expect(args.p_code).toBe(CODE);
    expect(args).not.toHaveProperty("p_tenant_id");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("customer_link.redeem");
    for (const secret of [CODE, "user-jwt", FX.tenants.A]) expect(logged).not.toContain(secret);
  });

  it("código malformado → 400 sem consultar o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("customer_link.redeem", { code: "abc" }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).field).toBe("code");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("código inválido no banco → 404 neutro", async () => {
    const res = await setup(async () => ({ data: null, error: { code: "PT404", message: "NOT_FOUND" } })).handler(
      post("customer_link.redeem", { code: CODE }),
    );
    expect(res.status).toBe(404);
    expect((await errorOf(res)).message).toBe("Não encontrado.");
  });
});

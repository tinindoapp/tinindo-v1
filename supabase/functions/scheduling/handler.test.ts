import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope, successEnvelope, BookingOutput, BookingListOutput } from "../_shared/contracts/index.ts";
import { bookingsA, FX } from "../_shared/contracts/fixtures.ts";
import { canonicalJson, encodeCursor } from "../_shared/http/command.ts";
import { createSchedulingHandler, type SchedulingDeps } from "./handler.ts";

const ORIGIN = "http://localhost:5173";
const IDEM = "idem-teste-agenda-0001";
const booking = bookingsA[0]!;

function setup(rpc: SchedulingDeps["rpc"]) {
  const log = vi.fn();
  const handler = createSchedulingHandler({
    rpc,
    allowedOrigins: [ORIGIN],
    clock: { now: () => new Date("2026-10-20T12:00:00Z") },
    log,
  });
  return { handler, log };
}
const post = (op: string, body: unknown, extra: Record<string, string> = { "Idempotency-Key": IDEM }) =>
  new Request(`http://edge/functions/v1/scheduling/${op}`, {
    method: "POST",
    headers: { Origin: ORIGIN, Authorization: "Bearer user-jwt", "X-Tinindo-Tenant": FX.tenants.A, ...extra },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const okRpc = (data: unknown) => vi.fn(async () => ({ data, error: null }));
const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

const createInput = {
  customer_id: FX.customers.abInA,
  service_id: FX.services.corteA,
  resource_id: FX.resources.A,
  slot: { starts_at: "2026-10-27T13:00:00Z", ends_at: "2026-10-27T13:30:00Z" },
  quote_id: null,
  mode: "confirm",
};

describe("Edge Function scheduling · roteamento", () => {
  it("rota desconhecida → 404 sem consultar o banco", async () => {
    const rpc = vi.fn();
    expect((await setup(rpc).handler(post("booking.delete_all", {}))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propriedades herdadas do objeto não viram rota", async () => {
    expect((await setup(vi.fn()).handler(post("constructor", {}))).status).toBe(404);
  });

  it("GET → 400; sem token → 401; sem tenant → 400", async () => {
    const { handler } = setup(vi.fn());
    const get = new Request("http://edge/functions/v1/scheduling/booking.list", { headers: { Authorization: "Bearer x" } });
    expect((await handler(get)).status).toBe(400);
    const noAuth = new Request("http://edge/functions/v1/scheduling/booking.list", { method: "POST", body: "{}" });
    expect((await handler(noAuth)).status).toBe(401);
    const noTenant = new Request("http://edge/functions/v1/scheduling/booking.list", {
      method: "POST", headers: { Authorization: "Bearer x" }, body: "{}",
    });
    expect((await error(await handler(noTenant))).field).toBe("tenant_id");
  });
});

describe("comandos", () => {
  it("booking.create exige Idempotency-Key", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("booking.create", createInput, {}));
    expect(res.status).toBe(400);
    expect((await error(res)).field).toBe("idempotency_key");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("booking.create chama a RPC com o JWT, a chave e o hash canônico; 201 no envelope", async () => {
    const rpc = okRpc({ status_code: 201, body: { booking } });
    const res = await setup(rpc).handler(post("booking.create", createInput));
    expect(res.status).toBe(201);
    expect(successEnvelope(BookingOutput).parse(await res.json()).data.booking.id).toBe(booking.id);
    const [token, fn, args] = rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(token).toBe("user-jwt");
    expect(fn).toBe("scheduling_booking_create");
    expect(args).toMatchObject({
      p_tenant_id: FX.tenants.A, p_resource_id: FX.resources.A, p_service_id: FX.services.corteA,
      p_customer_id: FX.customers.abInA, p_guest_ref: null, p_starts_at: createInput.slot.starts_at,
      p_ends_at: createInput.slot.ends_at, p_quote_id: null, p_mode: "confirm", p_idem_key: IDEM,
    });
    expect(args.p_request_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mesmo conteúdo em outra ordem de chaves gera o mesmo hash", async () => {
    const a = okRpc({ status_code: 201, body: { booking } });
    const b = okRpc({ status_code: 201, body: { booking } });
    await setup(a).handler(post("booking.create", createInput));
    const reordered = Object.fromEntries(Object.entries(createInput).reverse());
    await setup(b).handler(post("booking.create", reordered));
    const hash = (m: typeof a) => (m.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2].p_request_hash;
    expect(hash(a)).toBe(hash(b));
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it.each([
    ["SLOT_CONFLICT", { code: "PT409", message: "SLOT_CONFLICT" }, 409],
    ["STALE_VERSION", { code: "PT409", message: "STALE_VERSION" }, 409],
    ["IDEMPOTENCY_MISMATCH", { code: "PT409", message: "IDEMPOTENCY_MISMATCH" }, 409],
    ["POLICY_REJECTED", { code: "PT422", message: "POLICY_REJECTED", hint: "hold_expires_at" }, 422],
    ["exclusion_violation cru", { code: "23P01", message: "conflicting key value" }, 409],
    ["FORBIDDEN", { code: "PT403", message: "FORBIDDEN" }, 403],
  ])("erro do banco %s → HTTP %s no envelope v1", async (_name, dbError, status) => {
    const rpc = vi.fn(async () => ({ data: null, error: dbError }));
    const res = await setup(rpc).handler(post("booking.create", createInput));
    expect(res.status).toBe(status);
    expect((await error(res)).retryable).toBe(false);
  });

  it("entrada inválida não chega ao banco (sem motivo no cancelamento)", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("booking.cancel", { booking_id: booking.id, expected_version: 1, reason: " " }));
    expect(res.status).toBe(400);
    expect((await error(res)).field).toBe("reason");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("série fora de 2–12 semanas é recusada antes do banco", async () => {
    const rpc = vi.fn();
    const { quote_id: _q, mode: _m, ...base } = createInput;
    const res = await setup(rpc).handler(post("booking.create_series", { ...base, weeks: 13, all_or_nothing: true }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("resposta do banco fora do contrato vira 500, sem vazar o corpo", async () => {
    const rpc = okRpc({ status_code: 200, body: { booking: { ...booking, status: "inventado" } } });
    const res = await setup(rpc).handler(post("booking.complete", { booking_id: booking.id, expected_version: 1 }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("inventado");
  });

  it("falha de transporte → 503 retryable (repetir com a mesma chave é seguro)", async () => {
    const rpc = vi.fn(async () => { throw new Error("rede"); });
    const res = await setup(rpc).handler(post("booking.create", createInput));
    expect(res.status).toBe(503);
    expect((await error(res)).retryable).toBe(true);
  });
});

describe("consultas", () => {
  it("booking.list não exige chave, traduz cursor e devolve next_cursor opaco", async () => {
    const rpc = okRpc({ items: [booking], next: { key: "2026-10-20T13:00:00Z", id: booking.id } });
    const cursor = encodeCursor({ key: "2026-10-20T12:00:00Z", id: FX.customers.abInA });
    const window = { starts_at: "2026-10-20T03:00:00Z", ends_at: "2026-10-21T03:00:00Z" };
    const res = await setup(rpc).handler(post("booking.list", { window, cursor, limit: 1 }, {}));
    expect(res.status).toBe(200);
    const data = successEnvelope(BookingListOutput).parse(await res.json()).data;
    expect(data.bookings).toHaveLength(1);
    expect(data.next_cursor).toBe(encodeCursor({ key: "2026-10-20T13:00:00Z", id: booking.id }));
    const args = (rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect(args).toMatchObject({ p_after_starts: "2026-10-20T12:00:00Z", p_after_id: FX.customers.abInA, p_limit: 1 });
    expect(args).not.toHaveProperty("p_idem_key");
  });

  it("cursor adulterado → 400 sem consultar o banco", async () => {
    const rpc = vi.fn();
    const window = { starts_at: "2026-10-20T03:00:00Z", ends_at: "2026-10-21T03:00:00Z" };
    const res = await setup(rpc).handler(post("booking.list", { window, cursor: "nao-e-cursor" }, {}));
    expect((await error(res)).field).toBe("cursor");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("schedule.settings aceita corpo vazio", async () => {
    const rpc = okRpc({ resource_id: FX.resources.A, resource_version: 2, timezone: "America/Sao_Paulo", rules: [] });
    const res = await setup(rpc).handler(post("schedule.settings", "", {}));
    expect(res.status).toBe(200);
  });

  it("log técnico não leva tenant, token nem corpo", async () => {
    const { handler, log } = setup(okRpc({ status_code: 201, body: { booking } }));
    await handler(post("booking.create", createInput));
    const entry = JSON.stringify(log.mock.calls[0]);
    expect(entry).not.toContain(FX.tenants.A);
    expect(entry).not.toContain("user-jwt");
    expect(entry).not.toContain(FX.customers.abInA);
  });
});

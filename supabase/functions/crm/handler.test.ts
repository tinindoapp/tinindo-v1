import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope, successEnvelope } from "../_shared/contracts/index.ts";
import { FX, services } from "../_shared/contracts/fixtures.ts";
import { CrmCustomerUpsertOutput, CustomerGetOutput, CustomerListOutput, ImportOutput } from "./contract.ts";
import { canonicalJson, type CrmDeps, createCrmHandler, decodeCursor, encodeCursor } from "./handler.ts";

const ORIGIN = "http://localhost:5173";
const IDEM = "idem-teste-handler-0001";
const customer = {
  id: FX.customers.guestInA,
  tenant_id: FX.tenants.A,
  name: "Visitante sem login (exemplo)",
  phone: "+5511987654321",
  email: null,
  declared_source: "walk_in",
  archived_at: null,
  version: 1,
};

function setup(rpc: CrmDeps["rpc"]) {
  const log = vi.fn();
  const handler = createCrmHandler({
    rpc,
    allowedOrigins: [ORIGIN],
    clock: { now: () => new Date("2026-10-20T12:00:00Z") },
    log,
  });
  return { handler, log };
}

const headers = (extra: Record<string, string> = {}) => ({
  Origin: ORIGIN,
  Authorization: "Bearer user-jwt",
  "X-Tinindo-Tenant": FX.tenants.A,
  ...extra,
});
const post = (route: string, body: unknown, extra: Record<string, string> = { "Idempotency-Key": IDEM }) =>
  new Request(`http://edge/functions/v1/crm/${route}`, {
    method: "POST",
    headers: headers(extra),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (route: string, extra: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/crm/${route}`, { headers: headers(extra) });

const okRpc = (data: unknown) => vi.fn(async () => ({ data, error: null }));
const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

describe("Edge Function crm · roteamento e autenticação", () => {
  it("rota desconhecida → 404 sem consultar o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(get("customers.dump"));
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("método errado → 400", async () => {
    const res = await setup(vi.fn()).handler(get("customer.upsert"));
    expect(res.status).toBe(400);
  });

  it("OPTIONS → 204 com CORS só para origem permitida", async () => {
    const res = await setup(vi.fn()).handler(
      new Request("http://edge/functions/v1/crm/customers", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("idempotency-key");
  });

  it("sem token → 401 AUTH_REQUIRED, sem consultar o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(
      new Request("http://edge/functions/v1/crm/customers", { headers: { "X-Tinindo-Tenant": FX.tenants.A } }),
    );
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tenant inválido → 400 com campo tenant_id", async () => {
    const res = await setup(vi.fn()).handler(get("customers", { "X-Tinindo-Tenant": "' or 1=1" }));
    expect(res.status).toBe(400);
    expect((await error(res)).field).toBe("tenant_id");
  });
});

describe("Edge Function crm · comandos", () => {
  it("comando sem Idempotency-Key → 400, sem consultar o banco", async () => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(post("customer.upsert", { name: "Ana" }, {}));
    expect(res.status).toBe(400);
    expect((await error(res)).field).toBe("idempotency_key");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const res = await setup(vi.fn()).handler(post("customer.upsert", "{nome:"));
    expect(res.status).toBe(400);
  });

  it.each([
    [0, "duration_min"],
    [4, "duration_min"],
    [1441, "duration_min"],
    [30.5, "duration_min"],
  ])("serviço com duração %s → 400 no campo %s, sem consultar o banco", async (duration, field) => {
    const rpc = vi.fn();
    const res = await setup(rpc).handler(
      post("service.save", { name: "Corte", duration_min: duration, base_price_cents: 6000, min_price_cents: 4500 }),
    );
    expect(res.status).toBe(400);
    expect((await error(res)).field).toBe(field);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("piso acima do preço base → 400 em min_price_cents", async () => {
    const res = await setup(vi.fn()).handler(
      post("service.save", { name: "Corte", duration_min: 30, base_price_cents: 1000, min_price_cents: 2000 }),
    );
    expect((await error(res)).field).toBe("min_price_cents");
  });

  it("edição sem expected_version → 400", async () => {
    const res = await setup(vi.fn()).handler(post("customer.upsert", { customer_id: customer.id, name: "Ana" }));
    expect((await error(res)).field).toBe("expected_version");
  });

  it("criar cliente → 201 no envelope v1, com tenant, chave e hash repassados ao banco", async () => {
    const rpc = okRpc({ status_code: 201, body: { customer, possible_duplicates: [] } });
    const res = await setup(rpc).handler(
      post("customer.upsert", { name: customer.name, phone: customer.phone, declared_source: "walk_in" }),
    );
    expect(res.status).toBe(201);
    const body = successEnvelope(CrmCustomerUpsertOutput).parse(await res.json());
    expect(body.data.customer.id).toBe(customer.id);
    const [token, fn, args] = rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(token).toBe("user-jwt");
    expect(fn).toBe("crm_customer_upsert");
    expect(args).toMatchObject({
      p_tenant_id: FX.tenants.A,
      p_customer_id: null,
      p_expected_version: null,
      p_email: null,
      p_declared_source: "walk_in",
      p_idem_key: IDEM,
    });
    expect(args.p_request_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash da requisição ignora ordem das chaves e muda com o conteúdo", async () => {
    const rpc = okRpc({ status_code: 201, body: { customer, possible_duplicates: [] } });
    const { handler } = setup(rpc);
    await handler(post("customer.upsert", { name: "Ana", phone: "+5511987654321" }));
    await handler(post("customer.upsert", { phone: "+5511987654321", name: "Ana" }));
    await handler(post("customer.upsert", { name: "Ana B", phone: "+5511987654321" }));
    const hashes = rpc.mock.calls.map((c) => (c as unknown as [string, string, { p_request_hash: string }])[2].p_request_hash);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it.each([
    ["PT403", "FORBIDDEN", 403],
    ["PT404", "NOT_FOUND", 404],
    ["PT409", "STALE_VERSION", 409],
    ["PT409", "IDEMPOTENCY_MISMATCH", 409],
  ])("erro do banco %s/%s → %s neutro", async (code, message, status) => {
    const res = await setup(async () => ({ data: null, error: { code, message } })).handler(
      post("customer.archive", { customer_id: FX.customers.abInB, expected_version: 1, archived: true }),
    );
    expect(res.status).toBe(status);
    const err = await error(res);
    expect(err.code).toBe(message);
    expect(err.message).not.toContain(FX.customers.abInB);
  });

  it("validação do banco devolve o campo indicado no hint", async () => {
    const res = await setup(async () => ({
      data: null,
      error: { code: "PT400", message: "VALIDATION_ERROR", hint: "name" },
    })).handler(post("service.save", { name: "Corte", duration_min: 30, base_price_cents: 6000, min_price_cents: 4500 }));
    expect(res.status).toBe(400);
    expect((await error(res)).field).toBe("name");
  });

  it("serviço salvo passa os campos com defaults do contrato", async () => {
    const rpc = okRpc({ status_code: 201, body: { service: services[0] } });
    const res = await setup(rpc).handler(
      post("service.save", { name: "Corte", duration_min: 30, base_price_cents: 6000, min_price_cents: 4500 }),
    );
    expect(res.status).toBe(201);
    const args = (rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2];
    expect(args).toMatchObject({ p_buffer_before_min: 0, p_buffer_after_min: 0, p_active: true, p_fee_bps: null });
  });

  it("resposta fora do contrato → 500, sem repassar o que veio do banco", async () => {
    const res = await setup(okRpc({ status_code: 201, body: { customer: { ...customer, phone: "123" } } })).handler(
      post("customer.upsert", { name: "Ana" }),
    );
    expect(res.status).toBe(500);
  });

  it("falha de rede → 503 retryable", async () => {
    const res = await setup(async () => {
      throw new Error("ECONNRESET");
    }).handler(post("customer.upsert", { name: "Ana" }));
    expect(res.status).toBe(503);
    expect((await error(res)).retryable).toBe(true);
  });

  it("log técnico não contém dados do cliente", async () => {
    const { handler, log } = setup(okRpc({ status_code: 201, body: { customer, possible_duplicates: [] } }));
    await handler(post("customer.upsert", { name: "Ana Secreta", phone: "+5511987654321" }));
    const entry = JSON.stringify(log.mock.calls[0]?.[0]);
    expect(entry).not.toMatch(/Ana|5511|user-jwt|10000000/);
    expect(entry).toContain("customer.upsert");
  });
});

describe("Edge Function crm · listagem e importação", () => {
  it("customer.get lê um cliente por id (GET), repassando tenant e id ao banco", async () => {
    const rpc = okRpc({ customer });
    const res = await setup(rpc).handler(get(`customer.get?customer_id=${customer.id}`));
    expect(res.status).toBe(200);
    expect(successEnvelope(CustomerGetOutput).parse(await res.json()).data.customer.id).toBe(customer.id);
    expect(rpc).toHaveBeenCalledWith("user-jwt", "crm_customer_get", { p_tenant_id: FX.tenants.A, p_customer_id: customer.id });
  });

  it("customer.get sem id válido → 400 sem consultar o banco; POST → 400", async () => {
    const rpc = okRpc({ customer });
    const { handler } = setup(rpc);
    expect((await handler(get("customer.get?customer_id=abc"))).status).toBe(400);
    expect((await handler(post("customer.get", { customer_id: customer.id }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("customer.get de outro negócio → 404 NOT_FOUND", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT404", message: "NOT_FOUND" } }));
    const res = await setup(rpc).handler(get(`customer.get?customer_id=${customer.id}`));
    expect(res.status).toBe(404);
    expect((await error(res)).code).toBe("NOT_FOUND");
  });

  it("lista com cursor opaco que volta íntegro", async () => {
    const rpc = okRpc({ items: [customer], next: { key: "visitante sem login (exemplo)", id: customer.id } });
    const res = await setup(rpc).handler(get("customers?q=vis&limit=1"));
    expect(res.status).toBe(200);
    const body = successEnvelope(CustomerListOutput).parse(await res.json());
    expect(body.data.next_cursor).toBeTruthy();
    expect(decodeCursor(body.data.next_cursor!)).toEqual({ key: "visitante sem login (exemplo)", id: customer.id });
    expect((rpc.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2]).toMatchObject({
      p_query: "vis",
      p_include_archived: false,
      p_limit: 1,
      p_after_key: null,
    });
  });

  it("cursor com acentos sobrevive ida e volta", () => {
    const c = { key: "joão ção", id: customer.id };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it.each(["customers?cursor=nao-e-cursor", "customers?limit=101", "customers?limit=0", "services?include_inactive=sim"])(
    "%s → 400",
    async (route) => {
      const rpc = vi.fn();
      const res = await setup(rpc).handler(get(route));
      expect(res.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("importação devolve criadas, puladas e rejeitadas por linha", async () => {
    const report = {
      created: [{ line: 2, customer_id: customer.id, possible_duplicates: [] }],
      skipped: [{ line: 3, duplicate_of: [FX.customers.abInA] }],
      rejected: [{ line: 4, field: "phone", reason: "PHONE_INVALID" }],
    };
    const rpc = okRpc({ status_code: 200, body: report });
    const res = await setup(rpc).handler(
      post("customer.import", {
        rows: [
          { line: 2, name: "Bruno", phone: "+5511911110000", email: null },
          { line: 3, name: "Cliente AB", phone: null, email: "cliente.ab@exemplo.test" },
          { line: 4, name: "Ruim", phone: "1199", email: null },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(successEnvelope(ImportOutput).parse(await res.json()).data).toEqual(report);
    const rows = (rpc.mock.calls[0] as unknown as [string, string, { p_rows: { on_duplicate: string }[] }])[2].p_rows;
    expect(rows.every((r) => r.on_duplicate === "skip")).toBe(true);
  });

  it("importação acima de 500 linhas → 400 sem consultar o banco", async () => {
    const rpc = vi.fn();
    const rows = Array.from({ length: 501 }, (_, i) => ({ line: i + 2, name: `C${i}`, phone: null, email: null }));
    const res = await setup(rpc).handler(post("customer.import", { rows }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preview não exige Idempotency-Key (só leitura)", async () => {
    const rpc = okRpc({ rows: [{ line: 2, matches: [] }] });
    const res = await setup(rpc).handler(
      post("customer.import_preview", { rows: [{ line: 2, name: "Bruno", phone: null, email: null }] }, {}),
    );
    expect(res.status).toBe(200);
    expect((rpc.mock.calls[0] as unknown as [string, string])[1]).toBe("crm_customer_import_preview");
  });
});

describe("canonicalJson", () => {
  it("ordena chaves em qualquer nível e omite undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: null }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":null,"z":1}]},"b":1}',
    );
  });
});

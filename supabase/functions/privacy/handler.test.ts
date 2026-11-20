import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { PrivacyExportOutput } from "./contract.ts";
import { createPrivacyHandler, LINK_SECONDS, PRIVACY_ROUTES, type PrivacyDeps } from "./handler.ts";
import { clientIp, originKey } from "./origin.ts";

const T = FX.tenants.A;
const EXPORT_ID = "57000000-0000-4000-8000-0000000000e1";
const PATH = `${T}/${EXPORT_ID}.json`;
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": T };
const key = { ...owner, "Idempotency-Key": "chave-privacidade-0001" };
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/privacy/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const exp = (status: string) => ({
  id: EXPORT_ID, scope: "business", customer_id: null, status, bytes: status === "generating" ? null : 1234,
  created_at: "2026-11-20T12:00:00Z", ready_at: status === "generating" ? null : "2026-11-20T12:00:05Z",
  expires_at: status === "generating" ? null : "2026-11-21T12:00:05Z",
});
const clock = { now: () => new Date("2026-11-20T12:00:10Z") };

function world(over: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const rpc = vi.fn(async (_t: string, fn: string, args: Record<string, unknown>) => {
    calls.push([fn, args]);
    const f = over[fn] ?? ({
      privacy_export_start: () => ({ data: { status_code: 201, body: { export: exp("generating"), storage_path: PATH } }, error: null }),
      privacy_export_data: () => ({ data: { format: "tinindo.export.v1", data: { customers: [{ name: "Cliente" }] } }, error: null }),
      privacy_export_finish: () => ({ data: { export: exp("ready"), storage_path: PATH }, error: null }),
      privacy_export_get: () => ({ data: { export: exp(calls.some((c) => c[0] === "privacy_export_finish") || !calls.some((c) => c[0] === "privacy_export_start") ? "ready" : "generating"), storage_path: PATH }, error: null }),
    } as Record<string, () => { data: unknown; error: unknown }>)[fn];
    return (f ? f(args) : { data: null, error: null }) as never;
  });
  const storage = { upload: vi.fn(async () => {}), signedUrl: vi.fn(async (_t: string, p: string, s: number) => `https://storage.example/${p}?ttl=${s}`) };
  const log = vi.fn();
  const handler = createPrivacyHandler({ rpc, storage, allowedOrigins: [], clock, log } as PrivacyDeps);
  return { handler, rpc, storage, calls, log };
}

describe("Edge Function privacy · exportar", () => {
  it("dono exporta: pedido → conteúdo → arquivo com o JWT dele → pronto → link de 15 min", async () => {
    const w = world();
    const res = await w.handler(post("privacy.export", { scope: "business" }, key));
    expect(res.status).toBe(201);
    const out = PrivacyExportOutput.parse(((await res.json()) as { data: unknown }).data);
    expect(out.export.status).toBe("ready");
    expect(out.download.url).toBe(`https://storage.example/${PATH}?ttl=${LINK_SECONDS}`);
    expect(out.download.expires_at).toBe("2026-11-20T12:15:10Z");
    expect(w.calls.map((c) => c[0])).toEqual(["privacy_export_start", "privacy_export_get", "privacy_export_data", "privacy_export_finish"]);
    expect(w.calls[0]![1]).toMatchObject({ p_tenant_id: T, p_scope: "business", p_customer_id: null, p_idem_key: "chave-privacidade-0001" });
    expect(w.calls[0]![1].p_request_hash).toMatch(/^[0-9a-f]{64}$/);
    const [token, path, body] = w.storage.upload.mock.calls[0] as unknown as [string, string, Uint8Array];
    expect([token, path]).toEqual(["jwt", PATH]);
    expect(JSON.parse(new TextDecoder().decode(body))).toMatchObject({ format: "tinindo.export.v1" });
    expect(w.calls[3]![1]).toMatchObject({ p_bytes: body.byteLength });
    // Log técnico sem negócio, token nem conteúdo.
    const logged = JSON.stringify(w.log.mock.calls);
    expect(logged).not.toContain(T);
    expect(logged).not.toContain("Cliente");
    expect(logged).not.toContain("jwt");
  });

  it("repetir com a mesma chave não gera outro arquivo: devolve o pronto com um link novo", async () => {
    // A resposta guardada da chave é a do primeiro pedido (gerando); o estado atual (pronto) vem de privacy_export_get.
    const w = world({ privacy_export_get: () => ({ data: { export: exp("ready"), storage_path: PATH }, error: null }) });
    const res = await w.handler(post("privacy.export", { scope: "business" }, key));
    expect(res.status).toBe(201);
    expect(w.calls.map((c) => c[0])).toEqual(["privacy_export_start", "privacy_export_get"]);
    expect(w.storage.upload).not.toHaveBeenCalled();
  });

  it("exige chave, escopo coerente e dono; falha no Storage não marca pronto", async () => {
    const w = world();
    const noKey = await w.handler(post("privacy.export", { scope: "business" }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    const bad = await w.handler(post("privacy.export", { scope: "customer" }, key));
    expect(ErrorEnvelope.parse(await bad.json()).error).toMatchObject({ code: "VALIDATION_ERROR", field: "customer_id" });
    expect((await w.handler(post("privacy.export", { scope: "business" }, { "X-Tinindo-Tenant": T }))).status).toBe(401);
    expect(w.rpc).not.toHaveBeenCalled();
    const staff = world({ privacy_export_start: () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } }) });
    expect((await staff.handler(post("privacy.export", { scope: "business" }, key))).status).toBe(403);
    const broken = world();
    broken.storage.upload.mockRejectedValueOnce(new Error("rede"));
    expect((await broken.handler(post("privacy.export", { scope: "business" }, key))).status).toBe(503);
    expect(broken.calls.map((c) => c[0])).not.toContain("privacy_export_finish");
  });

  it("link novo só para exportação pronta e no prazo", async () => {
    const w = world();
    const res = await w.handler(post("privacy.export_link", { export_id: EXPORT_ID }, owner));
    expect(res.status).toBe(200);
    expect(w.calls).toEqual([["privacy_export_get", { p_tenant_id: T, p_export_id: EXPORT_ID }]]);
    const expired = world({ privacy_export_get: () => ({ data: { export: exp("expired"), storage_path: PATH }, error: null }) });
    const r2 = await expired.handler(post("privacy.export_link", { export_id: EXPORT_ID }, owner));
    expect(ErrorEnvelope.parse(await r2.json()).error).toMatchObject({ code: "POLICY_REJECTED", field: "status" });
    expect(expired.storage.signedUrl).not.toHaveBeenCalled();
  });
});

describe("Edge Function privacy · eliminar e listar", () => {
  it("eliminar exige a palavra ELIMINAR e chave; argumentos chegam à RPC", async () => {
    const erasure = { id: EXPORT_ID, scope: "business", customer_id: null, status: "scheduled", requested_at: "2026-11-20T12:00:00Z",
      execute_after: "2026-11-27T12:00:00Z", cancelled_at: null, done_at: null, summary: null };
    const w = world({ privacy_erasure_request: () => ({ data: { status_code: 201, body: { erasure } }, error: null }) });
    expect((await w.handler(post("privacy.erase", { scope: "business" }, key))).status).toBe(400);
    expect((await w.handler(post("privacy.erase", { scope: "business", confirm: "sim" }, key))).status).toBe(400);
    expect(w.rpc).not.toHaveBeenCalled();
    const res = await w.handler(post("privacy.erase", { scope: "business", confirm: "ELIMINAR" }, key));
    expect(res.status).toBe(201);
    expect(w.rpc).toHaveBeenCalledWith("jwt", "privacy_erasure_request", expect.objectContaining({
      p_tenant_id: T, p_scope: "business", p_customer_id: null, p_idem_key: "chave-privacidade-0001",
    }));
  });

  it("rotas de uma RPC: listas são consultas, eliminar e cancelar são comandos", () => {
    expect(Object.fromEntries(Object.entries(PRIVACY_ROUTES).map(([k, r]) => [k, [r.rpc, r.command]]))).toEqual({
      "privacy.exports": ["privacy_exports_list", false],
      "privacy.erasures": ["privacy_erasures_list", false],
      "privacy.erase": ["privacy_erasure_request", true],
      "privacy.erase_cancel": ["privacy_erasure_cancel", true],
    });
  });
});

describe("chave da origem (limite de abuso da reserva pública)", () => {
  const req = (h: Record<string, string>) => new Request("http://edge/x", { headers: h });
  it("lê o IP da borda, nunca texto livre; sem IP, sem chave", async () => {
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "2001:DB8::1, 10.0.0.1" }))).toBe("2001:db8::1");
    expect(clientIp(req({ "x-forwarded-for": "<script>" }))).toBeNull();
    expect(await originKey(req({}), "p")).toBeNull();
  });
  it("hash muda com o dia e com a pimenta; o banco nunca vê o IP", async () => {
    const r = req({ "cf-connecting-ip": "203.0.113.7" });
    const d1 = await originKey(r, "p", new Date("2026-11-20T10:00:00Z"));
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
    expect(d1).not.toContain("203");
    expect(await originKey(r, "p", new Date("2026-11-20T23:00:00Z"))).toBe(d1);
    expect(await originKey(r, "p", new Date("2026-11-21T00:00:01Z"))).not.toBe(d1);
    expect(await originKey(r, "q", new Date("2026-11-20T10:00:00Z"))).not.toBe(d1);
  });
});

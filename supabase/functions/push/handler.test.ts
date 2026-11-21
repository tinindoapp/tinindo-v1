// @vitest-environment node
// Edge Function `push` (P34): config sem chave; assinar só com VAPID e endereço de serviço de push conhecido; a entrega
// exige o segredo dos jobs, envia cada aviso uma vez e anota o resultado; endereço fora da lista nunca é chamado.
import { describe, expect, it, vi } from "vitest";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createPushHandler, JOBS_SECRET_HEADER, type PushDeps } from "./handler.ts";
import { b64urlEncode, type VapidKeys } from "./webpush.ts";

const SECRET = "s".repeat(40);
const EP = "https://fcm.googleapis.com/fcm/send/aparelho-1";
const KEYS = { p256dh: `B${"A".repeat(86)}`, auth: "C".repeat(22) };

async function vapid(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  return { publicKey: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))), privateKey: (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!, subject: "mailto:a@tinindo.test" };
}
async function device() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return { p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}

function setup(v: VapidKeys | null, claimed: unknown[] = []) {
  const rpc = vi.fn<PushDeps["rpc"]>(async (_t, fn) => ({ data: fn === "push_unsubscribe" ? { removed: true } : { id: FX.tenants.B, device_label: null, created_at: "2026-11-21T12:00:00Z", last_sent_at: null, prefs: { booking_new: true, booking_cancelled: true, reminder_30: true, daily_summary: false } }, error: null }));
  const serviceRpc = vi.fn<PushDeps["serviceRpc"]>(async (fn) => ({ data: fn === "push_claim" ? claimed : null, error: null }));
  const fetch = vi.fn(async () => new Response(null, { status: 201 }));
  const handler = createPushHandler({ rpc, serviceRpc, allowedOrigins: [], vapid: v, jobsSecret: SECRET, fetch: fetch as typeof globalThis.fetch, log: vi.fn() });
  return { rpc, serviceRpc, fetch, handler };
}
const post = (op: string, body: unknown, headers: Record<string, string> = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A }) =>
  new Request(`http://edge/functions/v1/push/${op}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("rotas do aparelho", () => {
  it("config: sem VAPID, available false e sem chave; com VAPID, a chave pública", async () => {
    const off = await (await setup(null).handler(post("push.config", {}))).json();
    expect(off.data).toEqual({ available: false, public_key: null });
    const v = await vapid();
    const on = await (await setup(v).handler(post("push.config", {}))).json();
    expect(on.data).toEqual({ available: true, public_key: v.publicKey });
  });

  it("assinar sem VAPID: 503 com explicação, sem chamar o banco", async () => {
    const s = setup(null);
    const res = await s.handler(post("push.subscribe", { endpoint: EP, keys: KEYS }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toMatch(/não estão ligados/);
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("assinar: endereço de serviço de push conhecido, chaves no formato; vai para push_subscribe com o negócio", async () => {
    const s = setup(await vapid());
    const res = await s.handler(post("push.subscribe", { endpoint: EP, keys: KEYS, device_label: "Celular", prefs: { daily_summary: true } }));
    expect(res.status).toBe(200);
    expect(s.rpc).toHaveBeenCalledWith("jwt", "push_subscribe", {
      p_tenant_id: FX.tenants.A, p_endpoint: EP, p_p256dh: KEYS.p256dh, p_auth: KEYS.auth, p_label: "Celular", p_prefs: { daily_summary: true },
    });
    for (const bad of ["https://intranet.local/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://evil.com/fcm.googleapis.com"]) {
      expect((await s.handler(post("push.subscribe", { endpoint: bad, keys: KEYS }))).status, bad).toBe(400);
    }
    expect((await s.handler(post("push.subscribe", { endpoint: EP, keys: { ...KEYS, auth: "x" } }))).status).toBe(400);
    expect((await s.handler(post("push.prefs", { endpoint: EP, prefs: { booking_new: false, extra: 1 } }))).status).toBe(400);
  });

  it("sem login: 401; sem negócio: 400", async () => {
    const s = setup(await vapid());
    expect((await s.handler(post("push.device", { endpoint: EP }, {}))).status).toBe(401);
    expect((await s.handler(post("push.device", { endpoint: EP }, { Authorization: "Bearer jwt" }))).status).toBe(400);
  });
});

describe("entrega (push.dispatch)", () => {
  it("sem o segredo dos jobs: 401, e nada sai da fila", async () => {
    const s = setup(await vapid());
    expect((await s.handler(post("push.dispatch", {}, {}))).status).toBe(401);
    expect((await s.handler(post("push.dispatch", {}, { [JOBS_SECRET_HEADER]: "errado" }))).status).toBe(401);
    expect(s.serviceRpc).not.toHaveBeenCalled();
  });

  it("envia cada aviso pego uma vez, anota o resultado; endereço fora da lista sai sem ser chamado", async () => {
    const d = await device();
    const base = { kind: "booking_new", title: "Reserva nova pelo link", body: "Corte · Ana · qui 06/03, 14:00", url: "/app", attempts: 1, ...d };
    const s = setup(await vapid(), [
      { ...base, id: "d0000000-0000-4000-8000-000000000001", endpoint: EP },
      { ...base, id: "d0000000-0000-4000-8000-000000000002", endpoint: "https://169.254.169.254/latest" },
    ]);
    const res = await s.handler(post("push.dispatch", {}, { [JOBS_SECRET_HEADER]: SECRET }));
    expect((await res.json()).data).toEqual({ sent: 1, gone: 1, failed: 0, disabled: false });
    expect(s.fetch).toHaveBeenCalledOnce();
    expect((s.fetch.mock.calls[0] as unknown as [string])[0]).toBe(EP);
    expect(s.serviceRpc.mock.calls.map((c) => [c[0], c[1].p_result])).toEqual([
      ["push_claim", undefined], ["push_report", "sent"], ["push_report", "gone"],
    ]);
  });

  it("sem VAPID: não pega a fila", async () => {
    const s = setup(null);
    const res = await s.handler(post("push.dispatch", {}, { [JOBS_SECRET_HEADER]: SECRET }));
    expect((await res.json()).data).toMatchObject({ disabled: true });
    expect(s.serviceRpc).not.toHaveBeenCalled();
  });
});

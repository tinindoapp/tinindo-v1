// @vitest-environment node
// Sem internet (P34, item 2): leituras da Hoje e da Agenda com a última resposta deste aparelho; o cache nunca serve
// resposta de outro negócio, de outra pessoa ou de outro pedido; comando sem rede falha na hora e nunca fica em fila.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOffline, handleApi, isOfflineRead, OFFLINE_AT_HEADER, OFFLINE_CACHE, OFFLINE_MAX_AGE_MS, type OfflineDeps, subOfBearer } from "./sw-offline.ts";

// Cache Storage em memória (o Node não tem). Chave = URL.
class MemCache {
  map = new Map<string, Response>();
  async match(k: string | Request) { const r = this.map.get(typeof k === "string" ? k : k.url); return r ? r.clone() : undefined; }
  async put(k: string | Request, r: Response) { this.map.set(typeof k === "string" ? k : k.url, r.clone()); }
  async delete(k: string | Request) { return this.map.delete(typeof k === "string" ? k : k.url); }
  async keys() { return [...this.map.keys()].map((u) => new Request(u)); }
}
class MemCaches {
  stores = new Map<string, MemCache>();
  async open(n: string) { if (!this.stores.has(n)) this.stores.set(n, new MemCache()); return this.stores.get(n)!; }
  async delete(n: string) { return this.stores.delete(n); }
  async keys() { return [...this.stores.keys()]; }
}

const API = "https://proj.supabase.co/functions/v1";
const T_A = "10000000-0000-4000-8000-00000000000a";
const T_B = "10000000-0000-4000-8000-00000000000b";
const jwt = (sub: string) => `Bearer x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
const RID = "aaaaaaaa-0000-4000-8000-000000000001";

function req(path: string, opts: { method?: string; tenant?: string; sub?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "X-Request-Id": RID };
  if (opts.sub !== null) headers.Authorization = jwt(opts.sub ?? "dono-1");
  if (opts.tenant !== undefined || opts.tenant === undefined) headers["X-Tinindo-Tenant"] = opts.tenant ?? T_A;
  return new Request(`${API}${path}`, { method: opts.method ?? "POST", headers, body: opts.method === "GET" ? undefined : JSON.stringify(opts.body ?? {}) });
}

let online = true;
let clock = Date.UTC(2026, 10, 21, 17, 5);
let caches: MemCaches;
let notes: unknown[];
let served: string[];
function deps(): OfflineDeps {
  return {
    fetch: (async (r: Request) => {
      if (!online) throw new TypeError("Failed to fetch");
      const tenant = r.headers.get("X-Tinindo-Tenant");
      served.push(`${r.method} ${new URL(r.url).pathname} ${tenant}`);
      return new Response(JSON.stringify({ data: { tenant, path: new URL(r.url).pathname, body: r.method === "GET" ? null : await r.text() } }), {
        status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }) as typeof fetch,
    caches: caches as unknown as CacheStorage,
    origin: "https://app.tinindo.test",
    now: () => clock,
    notify: (m) => void notes.push(m),
  };
}
const json = async (r: Response) => (await r.json()) as { data?: { tenant: string; path: string; body: string | null }; error?: { code: string; message: string } };

beforeEach(() => {
  online = true;
  clock = Date.UTC(2026, 10, 21, 17, 5);
  caches = new MemCaches();
  notes = [];
  served = [];
});

describe("o que pode abrir sem internet", () => {
  it("só as leituras da Hoje e da Agenda; comandos nunca", () => {
    expect(isOfflineRead("POST", `${API}/scheduling/booking.list`)).toBe(true);
    expect(isOfflineRead("GET", `${API}/context`)).toBe(true);
    expect(isOfflineRead("GET", `${API}/crm/customers?limit=100`)).toBe(true);
    expect(isOfflineRead("POST", `${API}/finance/finance.summary`)).toBe(true);
    for (const cmd of ["/scheduling/booking.create", "/scheduling/booking.cancel", "/finance/finance.record_payment", "/crm/customers"]) {
      expect(isOfflineRead("POST", `${API}${cmd}`), cmd).toBe(false);
    }
    expect(isOfflineRead("GET", "https://proj.supabase.co/auth/v1/user")).toBe(false);
  });

  it("lê o `sub` do login; sem login ou token estranho, null", () => {
    expect(subOfBearer(jwt("dono-1"))).toBe("dono-1");
    expect(subOfBearer(null)).toBeNull();
    expect(subOfBearer("Bearer nada")).toBeNull();
    expect(subOfBearer("Bearer a.bm90LWpzb24.c")).toBeNull();
  });
});

describe("leitura sem internet", () => {
  it("com rede: resposta da rede e cópia guardada; sem rede: a cópia, com a hora em que foi guardada", async () => {
    const first = await handleApi(req("/scheduling/booking.list", { body: { window: "hoje" } }), deps());
    expect((await json(first)).data!.tenant).toBe(T_A);
    expect(notes).toEqual([{ type: "tinindo:online-data" }]);
    online = false;
    clock += 3_600_000;
    const off = await handleApi(req("/scheduling/booking.list", { body: { window: "hoje" } }), deps());
    expect(off.status).toBe(200);
    expect(off.headers.get(OFFLINE_AT_HEADER)).toBe("2026-11-21T17:05:00.000Z");
    expect((await json(off)).data).toMatchObject({ tenant: T_A, path: "/functions/v1/scheduling/booking.list" });
    expect(notes.at(-1)).toEqual({ type: "tinindo:offline-data", savedAt: "2026-11-21T17:05:00.000Z" });
  });

  it("NUNCA serve resposta de outro negócio, de outra pessoa ou de outra janela da agenda", async () => {
    await handleApi(req("/scheduling/booking.list", { tenant: T_A, body: { window: "hoje" } }), deps());
    online = false;
    for (const other of [
      req("/scheduling/booking.list", { tenant: T_B, body: { window: "hoje" } }),
      req("/scheduling/booking.list", { tenant: T_A, sub: "outra-pessoa", body: { window: "hoje" } }),
      req("/scheduling/booking.list", { tenant: T_A, body: { window: "amanha" } }),
      req("/scheduling/booking.list", { tenant: T_A, sub: null, body: { window: "hoje" } }),
    ]) {
      const r = await handleApi(other, deps());
      expect(r.status).toBe(503);
      expect((await json(r)).error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    }
  });

  it("outra pessoa entrou neste aparelho: o que era da anterior sai na primeira resposta dela", async () => {
    await handleApi(req("/scheduling/booking.list", { sub: "dono-1" }), deps());
    await handleApi(req("/scheduling/booking.list", { sub: "dono-2" }), deps());
    expect((await caches.open(OFFLINE_CACHE)).map.size).toBe(1);
    online = false;
    expect((await handleApi(req("/scheduling/booking.list", { sub: "dono-1" }), deps())).status).toBe(503);
    expect((await handleApi(req("/scheduling/booking.list", { sub: "dono-2" }), deps())).status).toBe(200);
  });

  it("sem login, nada é guardado", async () => {
    await handleApi(req("/scheduling/booking.list", { sub: null }), deps());
    expect((await caches.open(OFFLINE_CACHE)).map.size).toBe(0);
  });

  it("mais de 24 h: não mostra e apaga; sair da conta apaga tudo", async () => {
    await handleApi(req("/context", { method: "GET" }), deps());
    online = false;
    clock += OFFLINE_MAX_AGE_MS + 1;
    expect((await handleApi(req("/context", { method: "GET" }), deps())).status).toBe(503);
    expect((await caches.open(OFFLINE_CACHE)).map.size).toBe(0);
    online = true;
    await handleApi(req("/context", { method: "GET" }), deps());
    await clearOffline(caches as unknown as CacheStorage);
    expect(await caches.keys()).not.toContain(OFFLINE_CACHE);
  });

  it("erro do servidor (4xx/5xx) não substitui a última resposta boa", async () => {
    await handleApi(req("/scheduling/booking.list"), deps());
    const bad = deps();
    bad.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    expect((await handleApi(req("/scheduling/booking.list"), bad)).status).toBe(500);
    online = false;
    expect((await handleApi(req("/scheduling/booking.list"), deps())).status).toBe(200);
  });
});

describe("gravação sem internet", () => {
  it("comando sem rede: erro na hora com 'nada foi salvo'; nada guardado nem em fila; com rede de novo, nada é reenviado", async () => {
    online = false;
    const r = await handleApi(req("/scheduling/booking.create", { body: { service_id: "x" } }), deps());
    expect(r.status).toBe(503);
    expect((await json(r)).error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: expect.stringContaining("nada foi salvo") });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await caches.keys()).toEqual([]);
    online = true;
    await handleApi(req("/scheduling/booking.list"), deps());
    expect(served).toEqual([`POST /functions/v1/scheduling/booking.list ${T_A}`]);
  });

  it("comando com rede: vai como veio, e a resposta não é guardada", async () => {
    const spy = vi.fn(deps().fetch);
    const d = { ...deps(), fetch: spy as typeof fetch };
    const r = await handleApi(req("/scheduling/booking.create", { body: { service_id: "x" } }), d);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    expect((await caches.open(OFFLINE_CACHE)).map.size).toBe(0);
  });
});

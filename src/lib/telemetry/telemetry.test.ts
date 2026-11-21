import { afterEach, describe, expect, it } from "vitest";
import { setClockForTest } from "../time.ts";
import { cleanRoute, createAppTelemetry, createTelemetry, errorName, type FrontError, functionOf, restSender } from "./index.ts";

const RID = "11111111-1111-4111-8111-111111111111";
const SHA = "afb8caf0123456789abcdef0123456789abcdef0";

function setup(route = "/app/clientes/7f1c2a9e-1b2c-4d3e-8f00-0123456789ab") {
  const rows: FrontError[] = [];
  const t = createTelemetry({ send: async (r) => void rows.push(r), sha: SHA.toUpperCase(), route: () => route });
  return { rows, t };
}

let restore: (() => void) | null = null;
const at = (iso: string) => { restore?.(); restore = setClockForTest(() => new Date(iso)); };
afterEach(() => { restore?.(); restore = null; });

describe("telemetria do front (P58)", () => {
  it("rota sem dado: id, número longo, e-mail e query saem", () => {
    expect(cleanRoute("/app/clientes/7f1c2a9e-1b2c-4d3e-8f00-0123456789ab?aba=x#y")).toBe("/app/clientes/:id");
    expect(cleanRoute("/app/x/11987654321")).toBe("/app/x/:id");
    expect(cleanRoute("/convite/fulana@exemplo.com")).toBe("/convite/:id");
    expect(cleanRoute("/pagar/" + "a".repeat(41))).toBe("/pagar/:id");
    expect(cleanRoute("/P/Barbearia Nova")).toBe("/p/barbearianova");
    expect(cleanRoute("")).toBeNull();
  });

  it("erro de tela leva só o nome do tipo, nunca a mensagem", () => {
    const { rows, t } = setup();
    t.captureRender(new TypeError("cliente Fulana (11) 98765-4321 sem telefone"));
    expect(rows).toEqual([{ kind: "render", fn: null, route: "/app/clientes/:id", status: null, code: "TypeError", build_sha: SHA, request_id: null }]);
    expect(JSON.stringify(rows)).not.toMatch(/Fulana|9876/);
    expect(errorName({ name: "nome com espaço" })).toBe("Error");
    expect(errorName("texto")).toBe("Error");
  });

  it("chamada 5xx e falha de rede viram linha; 4xx não; a resposta não muda", async () => {
    const { rows, t } = setup("/app/caixa");
    const statuses = [200, 409, 503];
    const fake = (async (url: string) => {
      if (url.includes("rede")) throw new TypeError("Failed to fetch");
      const s = statuses.shift()!;
      return Response.json(s >= 500 ? { error: { code: "PROVIDER_UNAVAILABLE", message: "x" } } : { data: {} }, { status: s });
    }) as unknown as typeof fetch;
    const f = t.wrapFetch(fake);
    const init = { headers: { "X-Request-Id": RID } };
    expect((await f("https://ref.supabase.co/functions/v1/finance/finance.ledger", init)).status).toBe(200);
    expect((await f("https://ref.supabase.co/functions/v1/finance/finance.ledger", init)).status).toBe(409);
    const r = await f("https://ref.supabase.co/functions/v1/finance/finance.ledger", init);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: { code: "PROVIDER_UNAVAILABLE" } });
    await expect(f("https://ref.supabase.co/functions/v1/scheduling/rede", init)).rejects.toThrow("Failed to fetch");
    expect(rows).toEqual([
      { kind: "call", fn: "finance", route: "/app/caixa", status: 503, code: "PROVIDER_UNAVAILABLE", build_sha: SHA, request_id: RID },
      { kind: "call", fn: "scheduling", route: "/app/caixa", status: 0, code: "NETWORK", build_sha: SHA, request_id: RID },
    ]);
  });

  it("repetição na mesma janela e acima do teto não sai", () => {
    at("2026-11-21T10:00:00Z");
    const rows: FrontError[] = [];
    const t = createTelemetry({ send: async (r) => void rows.push(r), route: () => "/app", maxPerPage: 3 });
    t.captureRender(new TypeError());
    t.captureRender(new TypeError());
    expect(rows).toHaveLength(1);
    at("2026-11-21T10:01:01Z");
    t.captureRender(new TypeError());
    t.captureRender(new RangeError());
    t.captureRender(new SyntaxError());
    expect(rows.map((r) => r.code)).toEqual(["TypeError", "TypeError", "RangeError"]);
  });

  it("erro solto e promessa rejeitada; desinstalar para de ouvir", () => {
    const { rows, t } = setup("/app");
    const target = new EventTarget() as unknown as Window;
    const off = t.install(target);
    target.dispatchEvent(Object.assign(new Event("error"), { error: new ReferenceError("x") }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("y") }));
    off();
    target.dispatchEvent(Object.assign(new Event("error"), { error: new RangeError("z") }));
    expect(rows.map((r) => `${r.kind}:${r.code}`)).toEqual(["unhandled:ReferenceError", "unhandled:Error"]);
  });

  it("envio que falha não vira erro na tela", async () => {
    const t = createTelemetry({ send: async () => { throw new Error("off"); }, route: () => "/app" });
    expect(() => t.captureRender(new Error())).not.toThrow();
  });

  it("restSender chama ops_error_record com a chave pública", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = restSender({ url: "https://ref.supabase.co/", publishableKey: "sb_publishable_x", fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch });
    await send({ kind: "render", fn: null, route: "/app", status: null, code: "TypeError", build_sha: null, request_id: null });
    expect(calls[0]?.url).toBe("https://ref.supabase.co/rest/v1/rpc/ops_error_record");
    expect(calls[0]?.init.keepalive).toBe(true);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ p_source: "front", p_kind: "render", p_fn: null, p_route: "/app", p_status: null, p_code: "TypeError", p_build_sha: null, p_request_id: null });
  });

  it("demonstração (sem Supabase): nada sai e o fetch passa direto", () => {
    const t = createAppTelemetry({ supabase: null, sha: SHA });
    expect(t.wrapFetch(fetch)).toBe(fetch);
    expect(() => t.captureRender(new Error())).not.toThrow();
    expect(functionOf("https://x/functions/v1/crm/customer.get")).toBe("crm");
    expect(functionOf("https://x/rest/v1/rpc/ops_error_record")).toBeNull();
  });
});

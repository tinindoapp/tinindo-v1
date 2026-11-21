import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILD_HEADER, buildSha, withBuild } from "./build.ts";
import { type CapturedError, fnAndRoute, rpcRecorder } from "./capture.ts";

const SHA = "afb8caf0123456789abcdef0123456789abcdef0";

describe("X-Tinindo-Build (recado #135)", () => {
  it("toda resposta leva o SHA: OPTIONS, erro e resposta com cabeçalhos imutáveis", async () => {
    const handler = withBuild((req) => {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "https://homolog.tinindoapp.com.br" } });
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }, SHA);
    const pre = await handler(new Request("http://edge/functions/v1/scheduling/health", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get(BUILD_HEADER)).toBe(SHA);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("https://homolog.tinindoapp.com.br");
    const err = await handler(new Request("http://edge/functions/v1/scheduling/x", { method: "POST" }));
    expect(err.status).toBe(404);
    expect(err.headers.get(BUILD_HEADER)).toBe(SHA);
    expect(await err.json()).toEqual({ error: { code: "NOT_FOUND" } });
    const immutable = await withBuild(() => Response.redirect("https://exemplo.test/", 302), SHA)(new Request("http://edge/"));
    expect(immutable.headers.get(BUILD_HEADER)).toBe(SHA);
  });

  it("sem BUILD_SHA válido a resposta sai como veio", async () => {
    for (const raw of [undefined, "", "main", "abc", "afb8caf\r\nX-Evil: 1", "g".repeat(40)]) expect(buildSha(raw)).toBeNull();
    expect(buildSha(" AFB8CAF ")).toBe("afb8caf");
    const res = await withBuild(() => new Response("ok"), null)(new Request("http://edge/"));
    expect(res.headers.has(BUILD_HEADER)).toBe(false);
  });

  it("as 29 funções passam pelo withBuild", () => {
    const root = resolve(process.cwd(), "supabase/functions");
    const fns = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "_shared").map((d) => d.name);
    expect(fns.length).toBeGreaterThanOrEqual(29);
    for (const fn of fns) {
      const src = readFileSync(resolve(root, fn, "index.ts"), "utf8");
      expect(src, fn).toMatch(/Deno\.serve\(withBuild\(/);
    }
  });
});

describe("captura de erro (P58)", () => {
  const RID = "11111111-1111-4111-8111-111111111111";
  const rows: CapturedError[] = [];
  const record = async (row: CapturedError) => void rows.push(row);

  it("5xx vira linha com função, rota, código, SHA e request_id; 4xx e 2xx não", async () => {
    rows.length = 0;
    const handler = withBuild((req) => {
      const status = Number(new URL(req.url).searchParams.get("s"));
      return Response.json({ error: { code: status >= 500 ? "PROVIDER_UNAVAILABLE" : "NOT_FOUND", message: "Cliente Fulana" } },
        { status, headers: { "X-Request-Id": RID } });
    }, SHA, record);
    for (const s of [200, 404, 409, 503]) await handler(new Request(`http://edge/functions/v1/finance/finance.ledger?s=${s}`, { method: "POST" }));
    expect(rows).toEqual([{ kind: "http_5xx", fn: "finance", route: "finance.ledger", status: 503, code: "PROVIDER_UNAVAILABLE", build_sha: SHA, request_id: RID }]);
    expect(JSON.stringify(rows)).not.toContain("Fulana");
  });

  it("exceção vira 500 no envelope v1, com o mesmo request_id na resposta e na linha", async () => {
    rows.length = 0;
    const res = await withBuild(() => { throw new Error("tenant 123 falhou"); }, SHA, record)(
      new Request("http://edge/scheduling/booking.create", { method: "POST", headers: { "X-Request-Id": RID } }));
    expect(res.status).toBe(500);
    expect(res.headers.get(BUILD_HEADER)).toBe(SHA);
    const body = (await res.json()) as { error: { code: string }; request_id: string };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.request_id).toBe(RID);
    expect(rows).toEqual([{ kind: "exception", fn: "scheduling", route: "booking.create", status: 500, code: "INTERNAL_ERROR", build_sha: SHA, request_id: RID }]);
  });

  it("gravador que falha não muda a resposta", async () => {
    const res = await withBuild(() => new Response("x", { status: 502 }), null, async () => { throw new Error("rede"); })(new Request("http://edge/jobs"));
    expect(res.status).toBe(502);
  });

  it("caminho estranho não vira função nem rota", () => {
    expect(fnAndRoute("http://edge/functions/v1/Finance/x y")).toEqual({ fn: null, route: null });
    expect(fnAndRoute("http://edge/jobs")).toEqual({ fn: "jobs", route: null });
    expect(fnAndRoute("nada")).toEqual({ fn: null, route: null });
  });

  it("rpcRecorder chama ops_error_record com a chave pública e não lança", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const rec = rpcRecorder({ url: "https://ref.supabase.co/", key: "sb_publishable_x", fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch });
    await rec({ kind: "http_5xx", fn: "finance", route: null, status: 500, code: null, build_sha: null, request_id: null });
    expect(calls[0]?.url).toBe("https://ref.supabase.co/rest/v1/rpc/ops_error_record");
    expect((calls[0]?.init.headers as Record<string, string>).apikey).toBe("sb_publishable_x");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ p_source: "function", p_kind: "http_5xx", p_fn: "finance" });
    await expect(rpcRecorder({ url: "https://x", key: "eyJ", fetch: (async () => { throw new Error("off"); }) as unknown as typeof fetch })(calls.length ? { kind: "exception", fn: null, route: null, status: 500, code: null, build_sha: null, request_id: null } : ({} as CapturedError))).resolves.toBeUndefined();
  });
});

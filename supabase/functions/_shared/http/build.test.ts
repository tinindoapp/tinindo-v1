import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILD_HEADER, buildSha, withBuild } from "./build.ts";

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

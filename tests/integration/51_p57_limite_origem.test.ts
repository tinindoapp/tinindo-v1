// P57 (D30 a, recado #137): limite por origem na reserva pública, pelo handler `network/public.book` com o banco real.
// O handler manda ao banco só o sha256 da origem (IP + dia + pimenta); 10 tentativas em 10 min passam pela trava, a 11ª
// volta 429 com field `origin`, antes de qualquer reserva. Sem IP conhecido o limite não se aplica.
// O endereço é um slug que não existe: cada tentativa passa pela trava e cai em NOT_FOUND, sem segurar horário.
import { afterAll, describe, expect, it } from "vitest";
import { call, FX, newKey, pool, sql } from "./harness.ts";

afterAll(() => pool.end());

const body = (n: number) => ({
  slug: "origem-inexistente-p57",
  service_id: FX.services.corteA,
  starts_at: "2030-01-07T12:00:00.000Z",
  contact: { name: `Teste ${n}`, phone_e164: `+55119888800${String(n).padStart(2, "0")}` },
});

describe("P57 · limite por origem na reserva pública", () => {
  it("a 11ª tentativa da mesma origem em 10 min volta 429 (origin); outra origem segue", async () => {
    const ip = "203.0.113.57";
    for (let i = 1; i <= 10; i++) {
      const r = await call("network", "public.book", { as: null, key: newKey(), body: body(i), headers: { "cf-connecting-ip": ip } });
      expect(r.error?.code, `tentativa ${i}`).toBe("NOT_FOUND");
    }
    const blocked = await call("network", "public.book", { as: null, key: newKey(), body: body(11), headers: { "cf-connecting-ip": ip } });
    expect(blocked.status).toBe(429);
    expect(blocked.error).toMatchObject({ code: "QUOTA_EXCEEDED", field: "origin" });
    const other = await call("network", "public.book", { as: null, key: newKey(), body: body(12), headers: { "cf-connecting-ip": "203.0.113.58" } });
    expect(other.error?.code).toBe("NOT_FOUND");
    // O banco guarda só o hash (64 hex), nunca o IP.
    const rows = await sql<{ origin_hash: string }>("select origin_hash from public.public_origin_hits");
    expect(rows.length).toBeGreaterThanOrEqual(11);
    for (const r of rows) expect(r.origin_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
  });

  it("sem IP conhecido o limite não se aplica", async () => {
    const before = await sql<{ n: number }>("select count(*)::int as n from public.public_origin_hits");
    const r = await call("network", "public.book", { as: null, key: newKey(), body: body(13) });
    expect(r.error?.code).toBe("NOT_FOUND");
    const after = await sql<{ n: number }>("select count(*)::int as n from public.public_origin_hits");
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

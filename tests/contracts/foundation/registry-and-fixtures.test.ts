// Registro de operações bate com o doc03; fixtures são válidas e espelham o seed do banco.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Booking, EventType, OPERATION_NAMES, OPERATIONS, ProviderService, Tenant } from "@contracts";
import { bookingsA, FX, packageB, services, tenantA, tenantB } from "@contracts/fixtures.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("registro de operações", () => {
  it("contém exatamente as operações v1 listadas em docs/03_CONTRATOS.md", () => {
    const doc = read("docs/03_CONTRATOS.md");
    const section = doc.slice(doc.indexOf("## Operações v1"), doc.indexOf("## Exemplo de cotação"));
    const documented = [...section.matchAll(/^\| `([a-z_]+\.[a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(20);
    expect([...OPERATION_NAMES].sort()).toEqual([...documented].sort());
  });

  it("todo comando é idempotente e toda consulta não é", () => {
    for (const name of OPERATION_NAMES) {
      const op = OPERATIONS[name];
      expect(op.idempotent, name).toBe(op.kind === "command");
    }
  });

  it("chave de idempotência nunca vai no corpo", () => {
    for (const name of OPERATION_NAMES) {
      const shape = (OPERATIONS[name].input as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      expect(Object.keys(shape), name).not.toContain("idempotency_key");
    }
  });

  it("tipos de evento batem com docs/01_ARQUITETURA.md", () => {
    const doc = read("docs/01_ARQUITETURA.md");
    const documented = [...doc.matchAll(/`([a-z_]+(?:\.[a-z_]+)+\.v\d+)`/g)].map((m) => m[1]);
    expect([...EventType.options].sort()).toEqual([...new Set(documented)].sort());
  });
});

describe("fixtures comuns", () => {
  it("validam nos contratos", () => {
    expect(() => Tenant.parse(tenantA)).not.toThrow();
    expect(() => Tenant.parse(tenantB)).not.toThrow();
    services.forEach((s) => expect(() => ProviderService.parse(s)).not.toThrow());
    bookingsA.forEach((b) => expect(() => Booking.parse(b)).not.toThrow());
  });

  it("IDs são únicos", () => {
    const ids = [
      ...Object.values(FX.users),
      ...Object.values(FX.tenants),
      ...Object.values(FX.resources),
      ...Object.values(FX.customers),
      ...Object.values(FX.services),
      ...Object.values(FX.packages),
      ...bookingsA.map((b) => b.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serviços e reservas não cruzam tenants", () => {
    for (const b of bookingsA) {
      expect(b.tenant_id).toBe(FX.tenants.A);
      expect(services.find((s) => s.id === b.service_id)?.tenant_id).toBe(FX.tenants.A);
    }
    expect(packageB.tenant_id).toBe(FX.tenants.B);
    expect(services.find((s) => s.id === packageB.service_id)?.tenant_id).toBe(FX.tenants.B);
  });

  it("agenda de A não tem sobreposição contando buffers", () => {
    const blocking = bookingsA
      .filter((b) => b.status === "confirmed" || b.status === "held")
      .map((b) => {
        const s = services.find((x) => x.id === b.service_id)!;
        return {
          start: Date.parse(b.starts_at) - s.buffer_before_min * 60_000,
          end: Date.parse(b.ends_at) + s.buffer_after_min * 60_000,
        };
      })
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < blocking.length; i++) {
      expect(blocking[i]!.start).toBeGreaterThanOrEqual(blocking[i - 1]!.end);
    }
  });

  it("pacote: crédito restante coerente", () => {
    expect(packageB.remaining_credits).toBeLessThanOrEqual(packageB.purchased_credits);
  });

  it("seed.sql espelha usuários, tenants, recursos, clientes e serviços das fixtures", () => {
    const seed = read("supabase/seed.sql");
    for (const id of [...Object.values(FX.users), ...Object.values(FX.tenants), ...Object.values(FX.resources)]) {
      expect(seed, id).toContain(id);
    }
    expect(seed).toContain(tenantA.name);
    expect(seed).toContain(tenantB.name);
    const seedUuids = new Set(seed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g));
    seedUuids.delete("00000000-0000-0000-0000-000000000000");
    const known = new Set<string>([
      ...Object.values(FX.users),
      ...Object.values(FX.tenants),
      ...Object.values(FX.resources),
      ...Object.values(FX.customers),
      ...Object.values(FX.services),
    ]);
    expect([...seedUuids].filter((u) => !known.has(u))).toEqual([]);
  });

  it("seed só usa e-mails de domínio reservado para teste", () => {
    const emails = read("supabase/seed.sql").match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    emails.forEach((e) => expect(e).toMatch(/@exemplo\.test$/));
  });
});

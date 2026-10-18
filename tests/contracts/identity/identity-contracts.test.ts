// P01 · Contratos do módulo identity: registro v1, schemas locais, assinaturas das RPCs das migrations
// e coerência entre os enums/limites do TypeScript e os CHECKs do SQL.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BusinessCreateInput, OPERATIONS, Profession } from "@contracts";
import { FX } from "@contracts/fixtures.ts";
import { rpcArgs } from "../../../supabase/functions/identity/handler.ts";
import {
  CustomerLinkIssueOutput,
  CustomerLinkRedeemInput,
  IDENTITY_OPERATION_NAMES,
  IDENTITY_OPERATIONS,
  MyCustomerLink,
  Onboarding,
  OnboardingGoal,
  OnboardingSaveInput,
} from "../../../supabase/functions/identity/schemas.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const migrationsDir = "supabase/migrations";
const sql = readdirSync(new URL(`../../../${migrationsDir}`, import.meta.url))
  .filter((f) => /^\d{14}_p01_.*\.sql$/.test(f))
  .map((f) => read(`${migrationsDir}/${f}`))
  .join("\n");

/** Nomes dos parâmetros de `create function public.<nome>(...)` nas migrations do P01. */
function sqlParams(fn: string): string[] {
  const match = new RegExp(`create function public\\.${fn}\\(([^)]*)\\)`, "m").exec(sql);
  if (!match?.[1]) throw new Error(`função ${fn} não encontrada nas migrations do P01`);
  return match[1]
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

const sampleInput = {
  "business.create": BusinessCreateInput.parse({
    name: "Barbearia Exemplo", profession: "barber", accepted_policy_versions: ["termos-piloto-v0"],
  }),
  "onboarding.save": OnboardingSaveInput.parse({ expected_version: 1 }),
  "customer_link.issue": { customer_id: FX.customers.abInA },
  "customer_link.redeem": { code: "a".repeat(43) },
  "customer_link.revoke": { link_id: FX.customers.abInA, expected_version: 1 },
} as const;

describe("identity · registro", () => {
  it("business.create é do P01, comando idempotente, e a função usa o contrato v1", () => {
    const spec = OPERATIONS["business.create"];
    expect(spec).toMatchObject({ module: "identity", owner: "P01", kind: "command", idempotent: true });
    expect(IDENTITY_OPERATIONS["business.create"].input).toBe(spec.input);
    expect(IDENTITY_OPERATIONS["business.create"].output).toBe(spec.output);
  });

  it("toda operação do módulo está no registro v1 como identity/P01, com os mesmos schemas", () => {
    for (const name of IDENTITY_OPERATION_NAMES) {
      const spec = OPERATIONS[name];
      expect(spec, name).toMatchObject({ module: "identity", owner: "P01", kind: "command", idempotent: true });
      expect(IDENTITY_OPERATIONS[name].input, name).toBe(spec.input);
      expect(IDENTITY_OPERATIONS[name].output, name).toBe(spec.output);
    }
  });

  it("chave de idempotência nunca vai no corpo", () => {
    for (const name of IDENTITY_OPERATION_NAMES) {
      const shape = (IDENTITY_OPERATIONS[name].input as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      expect(Object.keys(shape), name).not.toContain("idempotency_key");
    }
  });

  it("nome da operação cabe no CHECK de idempotency_records.operation", () => {
    for (const name of IDENTITY_OPERATION_NAMES) expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});

describe("identity · RPC da migration ↔ handler", () => {
  it.each(IDENTITY_OPERATION_NAMES)("%s chama a RPC com exatamente os parâmetros do SQL", (name) => {
    const spec = IDENTITY_OPERATIONS[name];
    const built = rpcArgs(name, sampleInput[name], FX.tenants.A);
    const expected = sqlParams(spec.rpc);
    expect([...Object.keys(built), "p_idem_key", "p_request_hash"].sort()).toEqual([...expected].sort());
  });

  it("toda RPC da migration revoga anon/public e concede só a authenticated", () => {
    for (const name of [...IDENTITY_OPERATION_NAMES.map((n) => IDENTITY_OPERATIONS[n].rpc), "my_customer_links"]) {
      expect(sql, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\)\\s+from public, anon;`));
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s+to authenticated;`));
      expect(sql, name).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s+to [^;]*anon`));
    }
  });

  it("toda RPC é SECURITY DEFINER com search_path vazio", () => {
    const defs = [...sql.matchAll(/create function public\.(\w+)\([\s\S]*?\$\$/g)];
    expect(defs.length).toBeGreaterThanOrEqual(6);
    for (const [def, name] of defs) expect(def, name).toMatch(/security definer set search_path = ''/);
  });
});

describe("identity · enums e limites batem com o SQL", () => {
  const checkList = (column: string) => {
    const m = new RegExp(`${column} text[^,]*?check \\(${column} in \\(([^)]*)\\)`, "s").exec(
      sql + read("supabase/migrations/20261017120000_foundation.sql"),
    );
    return [...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  };

  it("objetivos do onboarding", () => {
    expect(checkList("goal")).toEqual([...OnboardingGoal.options].sort());
  });

  it("profissões do contrato e do banco", () => {
    expect(checkList("profession")).toEqual([...Profession.options].sort());
  });

  it("antecedência 0–168h e multa 1–10000 bps", () => {
    expect(sql).toMatch(/check \(cancellation_notice_hours between 0 and 168\)/);
    expect(sql).toMatch(/check \(late_cancellation_fee_bps between 1 and 10000\)/);
    expect(OnboardingSaveInput.safeParse({ expected_version: 1, cancellation_notice_hours: 169 }).success).toBe(false);
    expect(OnboardingSaveInput.safeParse({ expected_version: 1, late_cancellation_fee_bps: 0 }).success).toBe(false);
    expect(OnboardingSaveInput.safeParse({ expected_version: 1, late_cancellation_fee_bps: 10_000 }).success).toBe(true);
  });
});

describe("identity · schemas", () => {
  it("onboarding vazio (linha recém-criada) é válido", () => {
    expect(
      Onboarding.parse({
        tenant_id: FX.tenants.A, goal: null, cancellation_notice_hours: null, late_cancellation_fee_bps: null,
        completed_at: null, version: 1,
      }).goal,
    ).toBeNull();
  });

  it("formato de data do SQL (to_char … Z) e do PostgREST (+00:00) passam no contrato", () => {
    const base = { link_id: FX.customers.abInA, tenant_id: FX.tenants.A, tenant_name: "Barbearia Exemplo A", version: 1 };
    expect(MyCustomerLink.safeParse({ ...base, verified_at: "2026-10-20T12:00:00.123456+00:00" }).success).toBe(true);
    expect(MyCustomerLink.safeParse({ ...base, verified_at: "2026-10-20T12:00:00.123Z" }).success).toBe(true);
    expect(MyCustomerLink.safeParse({ ...base, verified_at: "2026-10-20 12:00:00" }).success).toBe(false);
  });

  it("código de vínculo: 43 caracteres base64url, espaços nas pontas removidos", () => {
    expect(CustomerLinkRedeemInput.parse({ code: ` ${"A".repeat(43)}\n` }).code).toBe("A".repeat(43));
    expect(CustomerLinkRedeemInput.safeParse({ code: "A".repeat(42) }).success).toBe(false);
    expect(CustomerLinkRedeemInput.safeParse({ code: `${"A".repeat(42)}+` }).success).toBe(false);
  });

  it("emissão não exige o código na repetição", () => {
    const base = { invite_id: FX.customers.abInA, customer_id: FX.customers.abInA, expires_at: "2026-10-23T12:00:00.000Z" };
    expect(CustomerLinkIssueOutput.safeParse({ ...base, code: null }).success).toBe(true);
  });

  it("onboarding e vínculo não têm campos de saúde nem texto livre", () => {
    const keys = Object.keys((Onboarding as unknown as { shape: Record<string, unknown> }).shape);
    expect(keys.join(" ")).not.toMatch(/health|saude|injur|lesao|diagnos|note|obs/i);
  });
});

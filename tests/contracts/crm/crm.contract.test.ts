// Contrato do módulo CRM (P02): cenários de sucesso, entrada inválida, conflito/versão e
// coerência entre os schemas zod, o registro v1 e a proposta SQL (db/proposals/P02).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CustomerUpsertOutput, OPERATIONS, ProviderService, ServiceSaveInput } from "@contracts";
import { FX, services } from "@contracts/fixtures.ts";
import {
  CRM_ROUTES,
  CrmCustomer,
  CrmCustomerUpsertInput,
  CrmCustomerUpsertOutput,
  CustomerListQuery,
  DeclaredSource,
  IMPORT_MAX_ROWS,
  ImportInput,
  ImportOutput,
  RejectReason,
} from "../../../supabase/functions/crm/contract.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const sql = read("db/proposals/P02/001_crm.sql");
const seed = read("db/proposals/P02/seed.sql");

const dbCustomer = {
  id: FX.customers.guestInA,
  tenant_id: FX.tenants.A,
  name: "Visitante sem login (exemplo)",
  phone: null,
  email: null,
  declared_source: "walk_in",
  // Formato exato de app.crm_customer_json (to_char ... "Z").
  archived_at: "2026-10-20T12:00:00Z",
  version: 3,
};

describe("customer.upsert (extensão com origem declarada)", () => {
  it("criação mínima: origem, telefone e e-mail viram null por padrão", () => {
    expect(CrmCustomerUpsertInput.parse({ name: " Ana " })).toEqual({
      name: "Ana",
      phone: null,
      email: null,
      declared_source: null,
    });
  });

  it("edição exige customer_id e expected_version juntos (proteção de concorrência)", () => {
    expect(CrmCustomerUpsertInput.safeParse({ customer_id: dbCustomer.id, name: "Ana" }).success).toBe(false);
    expect(CrmCustomerUpsertInput.safeParse({ expected_version: 2, name: "Ana" }).success).toBe(false);
    expect(CrmCustomerUpsertInput.safeParse({ customer_id: dbCustomer.id, expected_version: 2, name: "Ana" }).success).toBe(true);
  });

  it.each([
    [{ name: "" }, "name"],
    [{ name: "Ana", phone: "11987654321" }, "phone"],
    [{ name: "Ana", email: "ana@" }, "email"],
    [{ name: "Ana", declared_source: "anuncio_pago" }, "declared_source"],
  ])("entrada inválida %j → erro em %s", (input, field) => {
    const r = CrmCustomerUpsertInput.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([field]);
  });

  it("saída do banco é compatível com o contrato v1 (campo extra é aditivo)", () => {
    const out = { customer: dbCustomer, possible_duplicates: [FX.customers.abInA] };
    expect(CrmCustomerUpsertOutput.parse(out).customer.declared_source).toBe("walk_in");
    // Consumidor que só conhece o v1 continua lendo a mesma resposta.
    expect(CustomerUpsertOutput.parse(out).customer.id).toBe(dbCustomer.id);
  });

  it("entrada do módulo é aceita pelo schema v1 registrado (compatível com o registro)", () => {
    const input = CrmCustomerUpsertInput.parse({ name: "Ana", declared_source: "referral" });
    expect(OPERATIONS["customer.upsert"].input.safeParse(input).success).toBe(true);
  });

  it("possíveis duplicados limitados a 10 (nunca lista ilimitada)", () => {
    const many = Array.from({ length: 11 }, () => FX.customers.abInA);
    expect(CrmCustomerUpsertOutput.safeParse({ customer: dbCustomer, possible_duplicates: many }).success).toBe(false);
  });
});

describe("service.save", () => {
  it.each([0, 4, 1441, 29.5, -30])("duração %s negada", (duration_min) => {
    const r = ServiceSaveInput.safeParse({ name: "Corte", duration_min, base_price_cents: 6000, min_price_cents: 4500 });
    expect(r.success).toBe(false);
  });

  it("preço em float negado; piso acima do base negado", () => {
    expect(ServiceSaveInput.safeParse({ name: "C", duration_min: 30, base_price_cents: 60.5, min_price_cents: 0 }).success).toBe(false);
    expect(ServiceSaveInput.safeParse({ name: "C", duration_min: 30, base_price_cents: 100, min_price_cents: 101 }).success).toBe(false);
  });

  it("fixtures de serviço são válidas", () => {
    for (const s of services) expect(ProviderService.parse(s)).toEqual(s);
  });
});

describe("listagem", () => {
  it("limite padrão 50, máximo 100, sem lista ilimitada", () => {
    expect(CustomerListQuery.parse({}).limit).toBe(50);
    expect(CustomerListQuery.safeParse({ limit: "100" }).success).toBe(true);
    expect(CustomerListQuery.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("arquivados ficam fora por padrão", () => {
    expect(CustomerListQuery.parse({}).include_archived).toBe(false);
    expect(CustomerListQuery.parse({ include_archived: "true" }).include_archived).toBe(true);
  });

  it("cliente arquivado no formato do banco é válido", () => {
    expect(CrmCustomer.parse(dbCustomer).archived_at).toBe("2026-10-20T12:00:00Z");
  });
});

describe("importação", () => {
  it(`no máximo ${IMPORT_MAX_ROWS} linhas; decisão padrão é pular possível duplicado`, () => {
    const row = { line: 2, name: "Bruno", phone: null, email: null };
    expect(ImportInput.parse({ rows: [row] }).rows[0]?.on_duplicate).toBe("skip");
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({ ...row, line: i + 2 }));
    expect(ImportInput.safeParse({ rows }).success).toBe(false);
    expect(ImportInput.safeParse({ rows: [] }).success).toBe(false);
  });

  it("linha com formato ruim não derruba o lote no contrato (o banco rejeita por linha)", () => {
    expect(ImportInput.safeParse({ rows: [{ line: 3, name: "", phone: "1199", email: "x" }] }).success).toBe(true);
  });

  it("pulada sempre aponta o cadastro que motivou o pulo", () => {
    expect(ImportOutput.safeParse({ created: [], rejected: [], skipped: [{ line: 3, duplicate_of: [] }] }).success).toBe(false);
  });
});

describe("coerência com a proposta SQL", () => {
  const listIn = (block: string) => [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

  it("origens declaradas iguais no zod e nos dois checks do banco", () => {
    const blocks = [...sql.matchAll(/declared_source[^(]*in\s*\(([^)]+)\)/g)].map((m) => listIn(m[1]!));
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const invalidFn = sql.slice(sql.indexOf("create function app.crm_customer_invalid"));
    const fnList = /p_source not in\s*\(([^)]+)\)/.exec(invalidFn)?.[1];
    for (const b of [...blocks, listIn(fnList!)]) expect(b).toEqual([...DeclaredSource.options].sort());
  });

  it("motivos de rejeição do banco existem no contrato", () => {
    const reasons = new Set([...sql.matchAll(/'([A-Z_]+_(?:REQUIRED|LONG|INVALID|FILE))'/g)].map((m) => m[1]));
    expect([...reasons].sort()).toEqual([...RejectReason.options].sort());
  });

  it("limites de duração e lote iguais no zod e no banco", () => {
    expect(sql).toContain("duration_min integer not null check (duration_min between 5 and 1440)");
    expect(sql).toContain(`not between 1 and ${IMPORT_MAX_ROWS}`);
  });

  it("toda rota da função tem RPC autorizada por app.is_member e sem grant para anon", () => {
    const rpcs = [...sql.matchAll(/create function public\.(crm_[a-z_]+)\(/g)].map((m) => m[1]!);
    expect(rpcs.length).toBe(Object.keys(CRM_ROUTES).length);
    for (const fn of rpcs) {
      const body = sql.slice(sql.indexOf(`create function public.${fn}(`)).split(/\nend \$\$;/)[0]!;
      expect(body, fn).toMatch(/if not app\.is_member\(p_tenant_id/);
      expect(body, fn).toContain("security definer set search_path = ''");
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
    }
  });

  it("seed proposto usa os IDs das fixtures e os valores dos serviços", () => {
    for (const id of [...Object.values(FX.customers), ...Object.values(FX.services)]) expect(seed).toContain(id);
    for (const s of services) {
      expect(seed).toContain(`'${s.id}', '${s.tenant_id}', '${s.name}', ${s.duration_min}, ${s.buffer_before_min}, ${s.buffer_after_min}`);
    }
  });
});

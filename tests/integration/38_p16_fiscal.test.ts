// P16 pelos handlers com o banco real: elegibilidade explicada → perfil MEI → representação pelos termos vistos →
// credencial pelo provedor → emissão em homologação (não é pagamento) → incerto resolvido pela consulta → cancelamento
// → pasta do mês. SEC: outro dono.
import { afterAll, describe, expect, it } from "vitest";
import { FiscalDocumentOutput, FiscalFolderOutput, FiscalOverview } from "@contracts";
import { fails, FISCAL, ok, pool, runFiscalSync, sql, T, U } from "./harness.ts";
import type { FiscalProviderPort } from "../../supabase/functions/_shared/domain/fiscal/providers.ts";

const owner = { as: U.ownerA, tenant: T.A };
const REC = "60000000-0000-4000-8000-0000000000f1";
const REC2 = "60000000-0000-4000-8000-0000000000f2";
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
afterAll(() => pool.end());

describe("P16 · fiscal seletivo pelos handlers", () => {
  let o: FiscalOverview;
  let docId = "";

  it("1 · elegibilidade explicada; perfil MEI; representação pelos termos; credencial informada pelo provedor", async () => {
    await sql(`insert into public.receivables (id, tenant_id, customer_id, description, amount_cents) values
      ($1, $3, '30000000-0000-4000-8000-0000000000a1', 'Corte (fiscal)', 6000), ($2, $3, '30000000-0000-4000-8000-0000000000a1', 'Barba (fiscal)', 4000)`, [REC, REC2, T.A]);
    o = await ok(FiscalOverview, "fiscal", "fiscal.get", { ...owner, body: {} });
    expect(o.eligibility).toMatchObject({ eligible: false, environment: "homologacao" });
    expect(o.eligibility.reasons).toEqual(expect.arrayContaining(["profile_missing", "representation_missing", "credential_invalid"]));
    await fails("fiscal", "fiscal.credential_check", { ...owner, body: {} }, "POLICY_REJECTED", "profile");
    o = await ok(FiscalOverview, "fiscal", "fiscal.profile_save", { ...owner, key: true, body: { expected_version: 0, legal_name: "Barbearia Exemplo A ME",
      cnpj: "11.222.333/0001-81", regime: "mei", municipality_ibge: "3550308", service_code: "06.01" } });
    expect(o.profile).toMatchObject({ cnpj: "11222333000181", regime: "mei", production_enabled: false });
    await fails("fiscal", "fiscal.representation", { ...owner, key: true, body: { action: "grant", terms_hash: "b".repeat(64) } }, "STALE_VERSION", "terms_hash");
    o = await ok(FiscalOverview, "fiscal", "fiscal.representation", { ...owner, key: true, body: { action: "grant", terms_hash: o.terms.hash } });
    expect(o.representation).toMatchObject({ active: true, current_terms: true });
    o = await ok(FiscalOverview, "fiscal", "fiscal.credential_check", { ...owner, body: {} });
    expect(o.credential).toMatchObject({ status: "valid", environment: "homologacao" });
    expect(o.eligibility).toEqual({ eligible: true, reasons: [], environment: "homologacao" });
  });

  it("2 · emitir em homologação: autorizada pelo provedor; o recebível continua em aberto; uma nota viva por recebível", async () => {
    const d = await ok(FiscalDocumentOutput, "fiscal", "fiscal.emit", { ...owner, key: true, body: { receivable_id: REC, taker_name: "Cliente AB (exemplo)",
      taker_document: "123.456.789-09", description: "Corte de cabelo", amount_cents: 6000, competence_date: today() } });
    docId = d.document.id;
    expect(d.document).toMatchObject({ status: "authorized", environment: "homologacao", taker_document_masked: "•••••••••09" });
    expect(d.document.number).toMatch(/^H\d{6}$/);
    const rec = await sql<{ status: string; paid_cents: number }>("select status, paid_cents from public.receivables where id = $1", [REC]);
    expect(rec[0]).toEqual({ status: "open", paid_cents: 0 });
    await fails("fiscal", "fiscal.emit", { ...owner, key: true, body: { receivable_id: REC, taker_name: "x", description: "Corte de novo", amount_cents: 6000, competence_date: today() } },
      "POLICY_REJECTED", "receivable_has_document");
    o = await ok(FiscalOverview, "fiscal", "fiscal.get", { ...owner, body: {} });
    expect(o.homologated).toBe(true);
    expect(o.receivables.map((r) => r.id)).not.toContain(REC);
  });

  it("3 · resposta incerta do provedor fica unknown; a consulta pela referência resolve sem reenviar", async () => {
    const real = FISCAL.homologacao;
    let emits = 0;
    const flaky: FiscalProviderPort = { ...real, emit: async (req) => { emits += 1; await real.emit(req); throw new Error("timeout"); } };
    FISCAL.homologacao = flaky;
    try {
      const d = await ok(FiscalDocumentOutput, "fiscal", "fiscal.emit", { ...owner, key: true, body: { receivable_id: REC2, taker_name: "Cliente AB (exemplo)",
        description: "Barba", amount_cents: 4000, competence_date: today() } });
      expect(d.document.status).toBe("unknown");
      await sql("update public.fiscal_documents set unknown_since = now() - interval '5 minutes' where id = $1", [d.document.id]);
      expect(await runFiscalSync()).toEqual({ checked: 1, resolved: 1, still_pending: 0 });
      const after = await ok(FiscalOverview, "fiscal", "fiscal.get", { ...owner, body: {} });
      expect(after.documents.find((x) => x.id === d.document.id)?.status).toBe("authorized");
      expect(emits).toBe(1);
    } finally {
      FISCAL.homologacao = real;
    }
  });

  it("4 · cancelar com motivo; pasta do mês com totais (cancelada não soma)", async () => {
    o = await ok(FiscalOverview, "fiscal", "fiscal.get", { ...owner, body: {} });
    const doc = o.documents.find((x) => x.id === docId)!;
    await fails("fiscal", "fiscal.cancel", { ...owner, key: true, body: { document_id: docId, expected_version: doc.version + 9, reason: "Valor lançado errado no atendimento" } }, "STALE_VERSION");
    const c = await ok(FiscalDocumentOutput, "fiscal", "fiscal.cancel", { ...owner, key: true, body: { document_id: docId, expected_version: doc.version, reason: "Valor lançado errado no atendimento" } });
    expect(c.document.status).toBe("cancelled");
    const f = await ok(FiscalFolderOutput, "fiscal", "fiscal.folder", { ...owner, body: { month: today().slice(0, 7) } });
    expect(f.totals).toMatchObject({ authorized_count: 1, authorized_cents: 4000, cancelled_count: 1 });
    expect(JSON.stringify(f)).not.toContain("12345678909");
    const ev = await sql<{ n: number }>("select count(*)::int as n from public.outbox_events where event_type = 'fiscal.document.authorized.v1' and tenant_id = $1", [T.A]);
    expect(ev[0]!.n).toBe(2);
  });

  it("SEC · outro dono não lê nem emite; produção não se liga pelo app", async () => {
    await fails("fiscal", "fiscal.get", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("fiscal", "fiscal.emit", { as: U.ownerB, tenant: T.A, key: true, body: { taker_name: "x", description: "Invasão", amount_cents: 100, competence_date: today() } }, "FORBIDDEN");
    const p = await sql<{ production_enabled: boolean }>("select production_enabled from public.fiscal_profiles where tenant_id = $1", [T.A]);
    expect(p[0]!.production_enabled).toBe(false);
  });
});

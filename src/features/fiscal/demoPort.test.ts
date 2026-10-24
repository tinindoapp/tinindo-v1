// A emulação segue as regras do banco (pgTAP 21, integração 38): elegibilidade com motivos, representação pelos termos,
// nota viva única por recebível, cancelamento com motivo, pasta do mês sem somar cancelada, documento mascarado.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { folderCsv } from "./labels.ts";

const k = () => crypto.randomUUID();
const REC = "70000000-0000-4000-8000-0000000000d1";
beforeEach(() => resetDemoState());

describe("demonstração de Notas fiscais", () => {
  it("só emite quando elegível; cada passo tira um motivo", async () => {
    const p = createDemoPort();
    let o = await p.overview();
    expect(o.eligibility.reasons).toEqual(["profile_missing", "representation_missing", "credential_invalid"]);
    await expect(p.emit({ taker_name: "x", description: "Corte", amount_cents: 100, competence_date: "2026-10-20" }, k())).rejects.toMatchObject({ field: "eligibility" });
    await expect(p.saveProfile({ expected_version: 0, legal_name: "Barbearia", cnpj: "11222333000180", regime: "mei", municipality_ibge: "3550308", service_code: "06.01" }, k())).rejects.toMatchObject({ field: "cnpj" });
    o = await p.saveProfile({ expected_version: 0, legal_name: "Barbearia", cnpj: "11.222.333/0001-81", regime: "mei", municipality_ibge: "3550308", service_code: "06.01" }, k());
    await expect(p.grant("a".repeat(64), k())).rejects.toMatchObject({ code: "STALE_VERSION", field: "terms_hash" });
    await p.grant(o.terms.hash, k());
    o = await p.checkCredential();
    expect(o.eligibility).toEqual({ eligible: true, reasons: [], environment: "homologacao" });
  });

  it("emite em homologação, uma nota viva por recebível; cancela com motivo; pasta não soma cancelada e não expõe documento", async () => {
    const p = createDemoPort();
    let o = await p.saveProfile({ expected_version: 0, legal_name: "Barbearia", cnpj: "11222333000181", regime: "mei", municipality_ibge: "3550308", service_code: "06.01" }, k());
    await p.grant(o.terms.hash, k());
    await p.checkCredential();
    const d = await p.emit({ receivable_id: REC, taker_name: "Ana", taker_document: "123.456.789-09", description: "Corte", amount_cents: 6000, competence_date: "2026-10-20" }, k());
    expect(d).toMatchObject({ status: "authorized", environment: "homologacao", taker_document_masked: "•••••••••09" });
    await expect(p.emit({ receivable_id: REC, taker_name: "Ana", description: "Corte", amount_cents: 6000, competence_date: "2026-10-20" }, k())).rejects.toMatchObject({ field: "receivable_has_document" });
    await expect(p.cancel({ document_id: d.id, expected_version: d.version, reason: "curto" }, k())).rejects.toMatchObject({ field: "reason" });
    await p.cancel({ document_id: d.id, expected_version: d.version, reason: "Valor lançado errado no atendimento" }, k());
    o = await p.overview();
    expect(o.receivables.map((r) => r.id)).toContain(REC);
    await p.emit({ receivable_id: REC, taker_name: "Ana", description: "Corte", amount_cents: 6000, competence_date: "2026-10-20" }, k());
    const f = await p.folder("2026-10");
    expect(f.totals).toMatchObject({ authorized_count: 1, authorized_cents: 6000, cancelled_count: 1 });
    const csv = folderCsv(f);
    expect(csv.split("\n")[0]).toContain("numero;competencia");
    expect(csv).not.toContain("12345678909");
    expect(csv).toContain("60,00");
  });
});

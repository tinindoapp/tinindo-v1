import { describe, expect, it, vi } from "vitest";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createSimulatedFiscalProvider, type FiscalProviderPort } from "../_shared/domain/fiscal/providers.ts";
import { createFiscalHandler, type FiscalDeps, SYNC_SECRET_HEADER } from "./handler.ts";

const SECRET = "segredo-do-sync-fiscal-".repeat(2);
const doc = { id: FX.tenants.B, environment: "homologacao", status: "submitting", receivable_id: null, customer_id: null, taker_name: "Cliente", taker_document_masked: "•••••••••09",
  service_code: "06.01", description: "Corte", amount_cents: 6000, competence_date: "2026-10-24", protocol: null, number: null, verification_code: null, pdf_url: null, xml_url: null,
  reject_reason: null, cancel_reason: null, authorized_at: null, cancelled_at: null, created_at: "2026-10-24T12:00:00Z", version: 1 };
const request = { provider_ref: `nfse:${FX.tenants.B}`, environment: "homologacao", cnpj: "11222333000181", municipality_ibge: "3550308", service_code: "06.01",
  taker_name: "Cliente", taker_document: "12345678909", description: "Corte", amount_cents: 6000, competence_date: "2026-10-24" };
const authorized = { ...doc, status: "authorized", number: "H000001", protocol: "SIM-H000001", authorized_at: "2026-10-24T12:00:01Z", version: 2 };

const setup = (over: Partial<FiscalDeps> = {}) => {
  const deps: FiscalDeps = {
    allowedOrigins: [], syncSecret: SECRET,
    providers: { homologacao: createSimulatedFiscalProvider(), producao: { configured: false } as unknown as FiscalProviderPort },
    rpc: vi.fn(async () => ({ data: { status_code: 201, body: { document: doc, request } }, error: null })),
    serviceRpc: vi.fn(async () => ({ data: { document: authorized }, error: null })),
    ...over,
  };
  return { deps, handler: createFiscalHandler(deps) };
};
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/fiscal/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const key = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A, "Idempotency-Key": "chave-fiscal-000000001" };
const emitBody = { taker_name: "Cliente", taker_document: "123.456.789-09", description: "Corte", amount_cents: 6000, competence_date: "2026-10-24" };

describe("Edge Function fiscal", () => {
  it("emitir: banco grava, provedor do ambiente emite, backend grava o resultado; o documento completo não volta ao app", async () => {
    const { handler, deps } = setup();
    const res = await handler(post("fiscal.emit", emitBody, key));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.document.status).toBe("authorized");
    expect(JSON.stringify(json)).not.toContain("12345678909");
    expect(deps.rpc).toHaveBeenCalledWith("jwt", "fiscal_emit", expect.objectContaining({ p_taker_document: "12345678909", p_amount_cents: 6000 }));
    expect(deps.serviceRpc).toHaveBeenCalledWith("fiscal_emit_result", expect.objectContaining({ p_document_id: doc.id, p_outcome: "authorized", p_number: "H000001" }));
  });

  it("replay (mesma chave, sem pedido): nada é reenviado ao provedor", async () => {
    const emit = vi.fn();
    const { handler, deps } = setup({
      rpc: vi.fn(async () => ({ data: { status_code: 201, body: { document: authorized } }, error: null })),
      providers: { homologacao: { configured: true, environments: ["homologacao"], emit } as unknown as FiscalProviderPort, producao: { configured: false } as unknown as FiscalProviderPort },
    });
    expect((await handler(post("fiscal.emit", emitBody, key))).status).toBe(201);
    expect(emit).not.toHaveBeenCalled();
    expect(deps.serviceRpc).not.toHaveBeenCalled();
  });

  it("falha de rede no provedor vira unknown (pode ter emitido); produção sem provedor é rejeitada sem envio", async () => {
    const boom = { configured: true, environments: ["homologacao"], emit: vi.fn(async () => { throw new Error("timeout"); }) } as unknown as FiscalProviderPort;
    const a = setup({ providers: { homologacao: boom, producao: { configured: false } as unknown as FiscalProviderPort } });
    await a.handler(post("fiscal.emit", emitBody, key));
    expect(a.deps.serviceRpc).toHaveBeenCalledWith("fiscal_emit_result", expect.objectContaining({ p_outcome: "unknown" }));
    const b = setup({ rpc: vi.fn(async () => ({ data: { status_code: 201, body: { document: { ...doc, environment: "producao" }, request: { ...request, environment: "producao" } } }, error: null })) });
    await b.handler(post("fiscal.emit", emitBody, key));
    expect(b.deps.serviceRpc).toHaveBeenCalledWith("fiscal_emit_result", expect.objectContaining({ p_outcome: "rejected", p_reason: expect.stringContaining("não configurado") }));
  });

  it("validação antes do banco: documento do tomador com tamanho errado, competência inválida, motivo curto no cancelamento", async () => {
    const { handler, deps } = setup();
    expect((await handler(post("fiscal.emit", { ...emitBody, taker_document: "123" }, key))).status).toBe(400);
    expect((await handler(post("fiscal.emit", { ...emitBody, competence_date: "24/10/2026" }, key))).status).toBe(400);
    expect((await handler(post("fiscal.cancel", { document_id: doc.id, expected_version: 2, reason: "curto" }, key))).status).toBe(400);
    expect((await handler(post("fiscal.representation", { action: "grant", terms_hash: "x" }, key))).status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("credencial: dono autoriza, o provedor informa, o backend grava; provedor mudo não altera nada", async () => {
    const overview = { profile: null, terms: { text: "t", hash: "a".repeat(64) }, representation: null, credential: null,
      eligibility: { eligible: false, reasons: ["profile_missing"], environment: "homologacao" }, homologated: false, documents: [], receivables: [] };
    const rpc = vi.fn(async () => ({ data: { environment: "homologacao", cnpj: "11222333000181" }, error: null }));
    const { handler, deps } = setup({ rpc, serviceRpc: vi.fn(async () => ({ data: overview, error: null })) });
    const res = await handler(post("fiscal.credential_check", {}, { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A }));
    expect(res.status).toBe(200);
    expect(deps.serviceRpc).toHaveBeenCalledWith("fiscal_credential_record", expect.objectContaining({ p_tenant_id: FX.tenants.A, p_environment: "homologacao", p_status: "valid" }));
    const mute = { configured: true, environments: ["homologacao"], credential: vi.fn(async () => null) } as unknown as FiscalProviderPort;
    const m = setup({ rpc, providers: { homologacao: mute, producao: mute } });
    expect((await m.handler(post("fiscal.credential_check", {}, { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A }))).status).toBe(503);
    expect(m.deps.serviceRpc).not.toHaveBeenCalled();
  });

  it("sync: exige o segredo; consulta pela referência e grava; sem resposta continua pendente", async () => {
    const provider = createSimulatedFiscalProvider();
    await provider.emit(request as never);
    const serviceRpc = vi.fn(async (fn: string) => (fn === "fiscal_sync_claim"
      ? { data: { items: [{ document_id: doc.id, provider_ref: request.provider_ref, environment: "homologacao" }, { document_id: FX.tenants.A, provider_ref: "nfse:x", environment: "producao" }] }, error: null }
      : { data: { document: authorized }, error: null }));
    const { handler } = setup({ serviceRpc, providers: { homologacao: provider, producao: { configured: false } as unknown as FiscalProviderPort } });
    expect((await handler(new Request("http://edge/functions/v1/fiscal/fiscal.sync", { method: "POST" }))).status).toBe(403);
    const wrong = SECRET.slice(0, -1) + "x";
    expect((await handler(new Request("http://edge/functions/v1/fiscal/fiscal.sync", { method: "POST", headers: { [SYNC_SECRET_HEADER]: wrong } }))).status).toBe(403);
    const res = await handler(new Request("http://edge/functions/v1/fiscal/fiscal.sync", { method: "POST", headers: { [SYNC_SECRET_HEADER]: SECRET } }));
    expect((await res.json()).data).toEqual({ checked: 2, resolved: 1, still_pending: 1 });
    expect(serviceRpc).toHaveBeenCalledWith("fiscal_emit_result", expect.objectContaining({ p_document_id: doc.id, p_outcome: "authorized" }));
  });
});

import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createSetupHandler, type SetupDeps } from "./handler.ts";

const setup = (rpc: SetupDeps["rpc"]) => createSetupHandler({ rpc, allowedOrigins: [] });
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/setup/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const owner = { Authorization: "Bearer jwt", "X-Tinindo-Tenant": FX.tenants.A };
const key = { ...owner, "Idempotency-Key": "chave-configuracao-0001" };

const progress = {
  business_name: "Barbearia Exemplo A", profession: "barber", created_at: "2026-11-03T12:00:00Z",
  steps: ["hours", "service", "cancellation_policy", "profile", "first_customer", "photo_whatsapp", "channel", "first_cash"].map((step, i) => ({
    step, required: i < 4, title: `Passo ${step}`, why: i === 0 ? null : "Por quê", link: "/app/perfil", done: i === 0, done_at: i === 0 ? "2026-11-03T12:30:00Z" : null, dismissed: false,
  })),
  done_count: 1, resolved_count: 1, total: 8, next: "service", ready: false, ready_at: null, ready_in_24h: false,
};

describe("Edge Function setup", () => {
  it("progresso: consulta sem chave, só o negócio selecionado chega à RPC; resposta validada pelo contrato", async () => {
    const rpc = vi.fn(async () => ({ data: progress, error: null }));
    const res = await setup(rpc)(post("setup.progress", {}, owner));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "setup_progress", { p_tenant_id: FX.tenants.A });
    const bad = await setup(vi.fn(async () => ({ data: { ...progress, steps: progress.steps.slice(0, 3) }, error: null })))(post("setup.progress", {}, owner));
    expect(bad.status).toBe(500);
    expect((await setup(vi.fn())(post("setup.progress", {}, { Authorization: "Bearer jwt" }))).status).toBe(400);
  });

  it("dispensar exige chave; passo inválido é recusado antes do banco; obrigatório vira 400 no campo step", async () => {
    const noKey = await setup(vi.fn())(post("setup.dismiss", { step: "channel" }, owner));
    expect(ErrorEnvelope.parse(await noKey.json()).error.field).toBe("idempotency_key");
    const rpc = vi.fn(async () => ({ data: { status_code: 200, body: { step: "channel", dismissed: true, progress } }, error: null }));
    expect((await setup(rpc)(post("setup.dismiss", { step: "inventado" }, key))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    const ok = await setup(rpc)(post("setup.dismiss", { step: "channel" }, key));
    expect(ok.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "setup_dismiss", expect.objectContaining({ p_step: "channel", p_dismissed: true, p_idem_key: "chave-configuracao-0001" }));
    const required = vi.fn(async () => ({ data: null, error: { code: "PT400", message: "VALIDATION_ERROR", hint: "step" } }));
    const res = await setup(required)(post("setup.dismiss", { step: "hours" }, key));
    expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "VALIDATION_ERROR", field: "step" });
  });

  it("serviços: lista vazia, duração ou preço fora dos limites recusados antes do banco; criação devolve 201", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 201, body: { created: [{ id: FX.services.corteA, template_code: "barber_corte", name: "Corte", duration_min: 30, base_price_cents: 5000 }], progress } }, error: null }));
    expect((await setup(rpc)(post("setup.services_apply", { services: [] }, key))).status).toBe(400);
    expect((await setup(rpc)(post("setup.services_apply", { services: [{ name: "Corte", duration_min: 4, base_price_cents: 5000 }] }, key))).status).toBe(400);
    expect((await setup(rpc)(post("setup.services_apply", { services: [{ name: "Corte", duration_min: 30, base_price_cents: -1 }] }, key))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    const res = await setup(rpc)(post("setup.services_apply", { services: [{ template_code: "barber_corte", name: " Corte ", duration_min: 30, base_price_cents: 5000 }] }, key));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("jwt", "setup_services_apply", expect.objectContaining({
      p_services: [{ template_code: "barber_corte", name: "Corte", duration_min: 30, base_price_cents: 5000 }],
    }));
  });

  it("rascunho: nada a aplicar é 400; horário invertido é 400; profissão e expediente chegam à RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { status_code: 200, body: { profession: "barber", hours: [{ weekday: 2, local_start: "09:00", local_end: "19:00" }], created: [], progress } }, error: null }));
    expect((await setup(rpc)(post("setup.draft_apply", {}, key))).status).toBe(400);
    expect((await setup(rpc)(post("setup.draft_apply", { hours: [{ weekday: 2, local_start: "19:00", local_end: "09:00" }] }, key))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    const res = await setup(rpc)(post("setup.draft_apply", { profession: "barber", hours: [{ weekday: 2, local_start: "09:00", local_end: "19:00" }] }, key));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("jwt", "setup_draft_apply", expect.objectContaining({
      p_profession: "barber", p_hours: [{ weekday: 2, local_start: "09:00", local_end: "19:00" }], p_services: [],
    }));
  });

  it("modelos: consulta; outro dono recebe 403 neutro", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PT403", message: "FORBIDDEN" } }));
    const res = await setup(rpc)(post("setup.templates", {}, owner));
    expect(res.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith("jwt", "setup_templates", { p_tenant_id: FX.tenants.A });
  });
});

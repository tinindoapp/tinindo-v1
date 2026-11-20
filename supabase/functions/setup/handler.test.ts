import { describe, expect, it, vi } from "vitest";
import { ErrorEnvelope } from "../_shared/contracts/index.ts";
import { FX } from "../_shared/contracts/fixtures.ts";
import { SetupDescribeOutput } from "../_shared/domain/setup/describe.ts";
import type { Llm } from "../_shared/llm/index.ts";
import { createSetupHandler, SETUP_DESCRIBE, SETUP_ROUTES, type SetupDeps } from "./handler.ts";

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

// P50 · setup.describe (T2 da revisão de 04/11): regras primeiro; o modelo de linguagem só para o que ficou sem ler.
describe("Edge Function setup · setup.describe", () => {
  const templates = { profession: "other", templates: [] };
  /** Banco de mentira: `setup_templates` confere o vínculo; `agent_run_start` é o portão do assistente. */
  const world = (over: Record<string, { data: unknown; error: { code: string; message: string } | null }> = {}) =>
    vi.fn(async (_token: string, fn: string) => over[fn] ?? (fn === "setup_templates"
      ? { data: templates, error: null }
      : { data: { run_id: "50000000-0000-4000-8000-000000000001", role: "owner", tenant_name: "Barbearia Exemplo A", timezone: "America/Sao_Paulo" }, error: null }));
  const llmOf = (answer: unknown): Llm & { extract: ReturnType<typeof vi.fn> } => ({ enabled: true, extract: vi.fn(async () => answer) }) as never;
  const describeWith = (rpc: SetupDeps["rpc"], llm?: Llm, log?: SetupDeps["log"]) => createSetupHandler({ rpc, allowedOrigins: [], llm, log });
  const body = async (res: Response) => SetupDescribeOutput.parse(((await res.json()) as { data: unknown }).data);

  it("não entra na tabela de rotas de uma RPC (o contrato v1 das 5 operações não muda); schemas próprios exportados", () => {
    expect(Object.keys(SETUP_ROUTES)).not.toContain(SETUP_DESCRIBE.name);
    expect(SETUP_DESCRIBE.input.safeParse({ sentence: "curta" }).success).toBe(false);
    expect(SETUP_DESCRIBE.input.safeParse({ sentence: "x".repeat(501) }).success).toBe(false);
  });

  it("LLM_PROVIDER=none (padrão): rascunho pelas regras, sem portão do assistente e sem chave de idempotência", async () => {
    const rpc = world();
    const res = await describeWith(rpc)(post("setup.describe", { sentence: "Sou personal trainer, atendo a domicílio de segunda a sexta das 6 às 12 e das 17 às 21" }, owner));
    expect(res.status).toBe(200);
    const d = await body(res);
    expect(d.assistant).toBe(false);
    expect(d.profession).toBe("personal_trainer");
    expect(d.at_home).toBe(true);
    expect(d.windows).toHaveLength(10);
    expect(d.sources).toMatchObject({ profession: "rules", weekdays: "rules", hours: "rules" });
    // Só a conferência de vínculo foi ao banco; nenhuma franquia debitada.
    expect(rpc.mock.calls.map((c) => c[1])).toEqual(["setup_templates"]);
    expect(rpc).toHaveBeenCalledWith("jwt", "setup_templates", { p_tenant_id: FX.tenants.A });
  });

  it("com LLM_PROVIDER=none, frase que as regras não leem volta com os campos recusados e o motivo, sem erro", async () => {
    const res = await describeWith(world())(post("setup.describe", { sentence: "faço unhas em casa, dois dias por semana" }, key));
    const d = await body(res);
    expect(d.assistant).toBe(false);
    expect(d.unknown).toEqual(["profession", "weekdays", "hours"]);
    expect(d.notes.filter((n) => n.level === "refused").map((n) => n.field)).toEqual(["profession", "weekdays", "hours"]);
  });

  it("provedor ligado e regras suficientes: o modelo NÃO é chamado e nada é debitado", async () => {
    const rpc = world();
    const llm = llmOf({ profession: "hairdresser", team_size: null, hours: [], services: [] });
    const d = await body(await describeWith(rpc, llm)(post("setup.describe", { sentence: "Sou barbeiro, sozinho, de terça a sábado das 9 às 19" }, key)));
    expect(llm.extract).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map((c) => c[1])).toEqual(["setup_templates"]);
    expect(d).toMatchObject({ assistant: false, profession: "barber" });
  });

  it("provedor ligado e campo sem ler: portão agent_run_start, depois o modelo; só o campo que faltava leva o selo", async () => {
    const rpc = world();
    const llm = llmOf({ profession: "barber", team_size: null, hours: [{ weekday: 1, start: "07:00", end: "08:00" }], services: [] });
    const sentence = "faço a barba e o cabelo da rapaziada, de terça a sábado das 9 às 19";
    const d = await body(await describeWith(rpc, llm)(post("setup.describe", { sentence }, key)));
    expect(rpc.mock.calls.map((c) => c[1])).toEqual(["setup_templates", "agent_run_start"]);
    expect(rpc).toHaveBeenCalledWith("jwt", "agent_run_start", { p_tenant_id: FX.tenants.A, p_idem_key: "chave-configuracao-0001" });
    expect(llm.extract).toHaveBeenCalledTimes(1);
    expect(llm.extract.mock.calls[0]![0]).toMatchObject({ task: "setup", input: sentence });
    expect(d.assistant).toBe(true);
    expect(d.profession).toBe("barber");
    expect(d.sources).toMatchObject({ profession: "assistant", weekdays: "rules", hours: "rules" });
    expect(d.windows.map((w) => w.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(d.unknown).toEqual([]);
  });

  it("assistente indisponível não vira erro: sem chave, franquia esgotada, não dono, modelo sem resposta ou banco fora → rascunho das regras", async () => {
    const sentence = { sentence: "faço unhas em casa, dois dias por semana" };
    const expectRules = async (res: Response) => {
      expect(res.status).toBe(200);
      expect(await body(res)).toMatchObject({ assistant: false, unknown: ["profession", "weekdays", "hours"] });
    };
    // Sem Idempotency-Key não há como debitar a franquia uma vez só: o modelo não é chamado.
    const noKeyLlm = llmOf(null);
    const noKeyRpc = world();
    await expectRules(await describeWith(noKeyRpc, noKeyLlm)(post("setup.describe", sentence, owner)));
    expect(noKeyRpc.mock.calls.map((c) => c[1])).toEqual(["setup_templates"]);
    expect(noKeyLlm.extract).not.toHaveBeenCalled();
    const quota = llmOf({ profession: "other", team_size: null, hours: [], services: [] });
    const log = vi.fn();
    await expectRules(await describeWith(world({ agent_run_start: { data: null, error: { code: "PT429", message: "QUOTA_EXCEEDED" } } }), quota, log)(post("setup.describe", sentence, key)));
    expect(quota.extract).not.toHaveBeenCalled();
    // Log técnico sem a frase nem o rascunho.
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ fn: "setup", route: "setup.describe", status: 200, unknown: 3, assistant: false, assistant_skipped: "QUOTA_EXCEEDED" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("unhas");
    const staff = llmOf({ profession: "other", team_size: null, hours: [], services: [] });
    await expectRules(await describeWith(world({ agent_run_start: { data: { run_id: "x", role: "staff" }, error: null } }), staff)(post("setup.describe", sentence, key)));
    expect(staff.extract).not.toHaveBeenCalled();
    await expectRules(await describeWith(world(), llmOf(null))(post("setup.describe", sentence, key)));
    const broken = vi.fn(async (_t: string, fn: string) => { if (fn === "agent_run_start") throw new Error("rede"); return { data: templates, error: null }; });
    await expectRules(await describeWith(broken, llmOf(null))(post("setup.describe", sentence, key)));
  });

  it("acesso: sem token 401; sem negócio 400; quem não é do negócio recebe 403 antes de qualquer leitura da frase ou do modelo", async () => {
    const llm = llmOf(null);
    expect((await describeWith(world(), llm)(post("setup.describe", { sentence: "Sou barbeiro de terça a sábado" }, {}))).status).toBe(401);
    const noTenant = await describeWith(world(), llm)(post("setup.describe", { sentence: "Sou barbeiro de terça a sábado" }, { Authorization: "Bearer jwt" }));
    expect(ErrorEnvelope.parse(await noTenant.json()).error).toMatchObject({ code: "VALIDATION_ERROR", field: "tenant_id" });
    const rpc = world({ setup_templates: { data: null, error: { code: "PT403", message: "FORBIDDEN" } } });
    const res = await describeWith(rpc, llm)(post("setup.describe", { sentence: "faço unhas em casa, dois dias por semana" }, key));
    expect(res.status).toBe(403);
    expect(rpc.mock.calls.map((c) => c[1])).toEqual(["setup_templates"]);
    expect(llm.extract).not.toHaveBeenCalled();
    const down = vi.fn(async () => { throw new Error("rede"); });
    expect((await describeWith(down)(post("setup.describe", { sentence: "Sou barbeiro de terça a sábado" }, owner))).status).toBe(503);
  });

  it("entrada: frase curta, longa ou ausente é 400 no campo sentence; JSON inválido é 400; as outras rotas continuam iguais", async () => {
    const rpc = world();
    for (const bad of [{}, { sentence: "oi" }, { sentence: "x".repeat(501) }]) {
      const res = await describeWith(rpc)(post("setup.describe", bad, owner));
      expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({ code: "VALIDATION_ERROR", field: "sentence" });
    }
    const raw = new Request("http://edge/functions/v1/setup/setup.describe", { method: "POST", headers: owner, body: "{" });
    expect((await describeWith(rpc)(raw)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect((await describeWith(rpc)(new Request("http://edge/functions/v1/setup/setup.describe", { method: "OPTIONS" }))).status).toBe(204);
    expect((await describeWith(rpc)(post("setup.inexistente", {}, owner))).status).toBe(404);
  });
});


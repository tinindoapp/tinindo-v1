// Revisão 06/11 (T8 a T10, T13): o motor explica e ajuda a configurar com leituras próprias, sem resposta errada com
// confiança. "Por que tenho faltas na quarta?" deixou de cair na agenda de quarta.
import { describe, expect, it } from "vitest";
import { runAgent } from "./engine.ts";
import type { AgentContext, AgentData, InsightsRead } from "./types.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const TENANT = "10000000-0000-4000-8000-00000000000a";
const corte = { id: "40000000-0000-4000-8000-0000000000a1", name: "Corte", duration_min: 30, buffer_before_min: 0, buffer_after_min: 10,
  base_price_cents: 6000, min_price_cents: 4500, estimated_cost_cents: 1500, fee_bps: null };
const barba = { ...corte, id: "40000000-0000-4000-8000-0000000000a2", name: "Barba", base_price_cents: 4000, min_price_cents: 0, estimated_cost_cents: null };
const directory = { services: [corte, barba], customers: [], customers_total: 0, pricing_rules: [], cancellation: null,
  waitlist: { active: 3, offered: 1 }, as_of: "2026-10-20T12:00:00Z" };
const noShow = { id: "70000000-0000-4000-8000-000000000001", rule_code: "no_show_concentration", title: "Faltas concentradas na quarta",
  body: "5 de 12 atendimentos de quarta tiveram falta.", evidence: { period_start: "2026-08-21", period_end: "2026-10-20", numerator: 5, denominator: 12 },
  version: 3, route: "/app/relacionamento" };
const idle = { ...noShow, id: "70000000-0000-4000-8000-000000000002", rule_code: "idle_slot", title: "Horário ocioso", body: "Sábado de manhã vazio.", route: "/app/precos" };

function world(over: Partial<AgentData> = {}, insights: InsightsRead | null = { insights: [noShow, idle], rules: [], as_of: "2026-10-20T12:00:00Z" }): AgentData {
  return {
    directory: async () => directory,
    agenda: async () => { throw new Error("agenda não deveria ser lida"); },
    finance: async () => { throw new Error("caixa não deveria ser lido"); },
    insights: insights ? async () => insights : undefined,
    setup: async () => ({ progress: { done_count: 1, steps: [
      { step: "hours", title: "Definir seus horários", required: true, done: true, link: "/app/agenda/horarios" },
      { step: "profile", title: "Publicar seu perfil e mandar o link", required: true, done: false, link: "/app/perfil", why: "O link público é como o cliente reserva com você." },
    ] }, as_of: "2026-10-20T12:00:00Z" }),
    lifecycle: async () => ({ settings: { enabled: true, confirmation: true, reminder_hours: [24], quote_followup_days: 3, receivable_reminder: false, reactivation_days: 60, daily_budget: 50 }, as_of: "2026-10-20T12:00:00Z" }),
    waitlist: async () => ({ by_service: [{ service_id: corte.id, active: 3, offered: 1 }],
      open_offers: [{ service_id: corte.id, starts_at: "2026-10-22T18:00:00Z", expires_at: "2026-10-20T14:00:00Z", status: "offered" }], as_of: "2026-10-20T12:00:00Z" }),
    ...over,
  };
}
const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({ tenant: { id: TENANT, name: "Barbearia Exemplo A", timezone: "America/Sao_Paulo" }, role: "owner", now: NOW, ...over });

describe("por quê? (T9)", () => {
  it("'por que tenho tanta falta na quarta?' explica com a evidência, não a agenda de quarta", async () => {
    const r = await runAgent("por que tenho tanta falta na quarta?", ctx(), world());
    expect(r.intent).toBe("explain_insight");
    expect(r.text).toContain("5 de 12 atendimentos de quarta tiveram falta.");
    expect(r.text).toContain("de 21/08 a 20/10");
    expect(r.text).toContain("/app/relacionamento");
    expect(r.tool_calls.map((c) => c.tool)).toEqual(["insights.read"]);
  });

  it("sem sugestão de faltas: diz o que a conta viu, sem chutar", async () => {
    const quiet = await runAgent("por que tenho faltas?", ctx(), world({}, { insights: [idle], rules: [{ code: "no_show_concentration", title: "Faltas", status: "quiet", reason: null }], as_of: "x" }));
    expect(quiet.text).toMatch(/não estavam concentradas/);
    const insufficient = await runAgent("por que tanta falta?", ctx(), world({}, { insights: [], rules: [{ code: "no_show_concentration", title: "Faltas", status: "insufficient", reason: "preciso de pelo menos 20 atendimentos" }], as_of: "x" }));
    expect(insufficient.text).toMatch(/Ainda não dá para dizer: preciso de pelo menos 20 atendimentos/);
    expect(insufficient.text).toMatch(/não quer dizer/);
  });

  it("'por que essa sugestão?' usa o insight da tela (ui_context) e confere o id", async () => {
    const r = await runAgent("por que essa sugestão?", ctx({ ui: { insight_id: idle.id } }), world());
    expect(r.text).toContain("Horário ocioso");
    const other = await runAgent("por que essa sugestão?", ctx({ ui: { insight_id: "70000000-0000-4000-8000-0000000000ff" } }), world());
    // Id que o negócio não tem: cai na primeira sugestão aberta, nunca em dado de fora.
    expect(other.text).toContain(noShow.title);
  });

  it("equipe não vê sugestões", async () => {
    const r = await runAgent("por que tenho faltas?", ctx({ role: "staff" }), world());
    expect(r.text).toMatch(/Só o dono/);
    expect(r.tool_calls).toHaveLength(0);
  });

  it("'por que o corte custa isso?': preço base, piso e de onde vem, sem média de mercado", async () => {
    const r = await runAgent("por que o corte está esse preço?", ctx(), world());
    expect(r.intent).toBe("why_price");
    expect(r.text).toMatch(/O Corte custa R\$\s60,00/);
    expect(r.text).toMatch(/piso é R\$\s45,00/);
    expect(r.text).toMatch(/não usa média de mercado/);
    const noFloor = await runAgent("por que a barba é esse valor?", ctx(), world());
    expect(noFloor.text).toMatch(/não tem piso definido/);
  });

  it("'por que' sem tema conhecido: diz o que sabe explicar (e o modelo pode ler depois)", async () => {
    const r = await runAgent("por que o céu é azul?", ctx(), world());
    expect(r.intent).toBe("unknown");
    expect(r.text).toMatch(/Sei explicar suas sugestões/);
  });
});

describe("configurar (T9)", () => {
  it("'me ajuda a configurar os lembretes': onde, como está hoje e o Faz comigo", async () => {
    const r = await runAgent("me ajuda a configurar os lembretes", ctx(), world());
    expect(r.intent).toBe("setup_help");
    expect(r.text).toContain("Lembretes e relacionamento (/app/relacionamento)");
    expect(r.text).toContain("Hoje: lembretes 24 h antes, com confirmação ao agendar.");
    expect(r.text).toMatch(/Faz comigo/);
    expect(r.text).toMatch(/Nada é salvo antes/);
  });

  it("'me ajuda a configurar meus horários' (antes: 'Não entendi o pedido')", async () => {
    const r = await runAgent("me ajuda a configurar meus horários", ctx(), world());
    expect(r.intent).toBe("setup_help");
    expect(r.text).toContain("Horários (/app/agenda/horarios)");
  });

  it("sem tema: o próximo passo da configuração guiada", async () => {
    const r = await runAgent("me ajuda a configurar", ctx(), world());
    expect(r.text).toContain("1 de 2 passos feitos");
    expect(r.text).toContain("Publicar seu perfil e mandar o link (/app/perfil)");
  });

  it("remarcar e agendar continuam sendo remarcar e agendar", async () => {
    const r = await runAgent("como você foi configurado?", ctx(), world());
    expect(r.intent).not.toBe("setup_help");
  });

  it("equipe não muda configuração", async () => {
    const r = await runAgent("quero mudar os lembretes", ctx({ role: "staff" }), world());
    expect(r.text).toMatch(/Só o dono/);
  });
});

describe("lista de espera (T8) e recusa fiscal (T13)", () => {
  it("por serviço e ofertas abertas, sem nomes nem recados", async () => {
    const r = await runAgent("como está a lista de espera?", ctx(), world());
    expect(r.text).toContain("3 pessoas para Corte");
    expect(r.text).toMatch(/Ofertas abertas: Corte .* às 15:00/);
    expect(r.text).toMatch(/Recados de clientes não são lidos/);
  });

  it("nota fiscal leva à tela Notas fiscais; o assistente não emite", async () => {
    const r = await runAgent("emite uma nota fiscal pra mim", ctx(), world());
    expect(r.intent).toBe("unavailable_fiscal");
    expect(r.text).toContain("/app/notas");
    expect(r.text).toMatch(/o assistente não emite nota/);
    expect(r.tool_calls).toHaveLength(0);
  });
});

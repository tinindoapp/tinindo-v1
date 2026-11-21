// "Faz comigo" (T4): do que o modelo leu ao rascunho do formulário. Limites do destino, dinheiro só se dito, nada de
// id ou versão, texto com marcador de dado redigido fica de fora, janelas sem sobreposição.
import { describe, expect, it } from "vitest";
import { buildFormDraft, DRAFT_SCHEMAS, FORM_IDS, FORM_SCREEN, moneyInText, parseFormDraft, providerReady } from "./forms.ts";

const nullLifecycle = { enabled: null, confirmation: null, reminder_hours: null, quote_followup_days: null, receivable_reminder: null, reactivation_days: null, daily_budget: null };
const nullService = { name: null, duration_min: null, buffer_before_min: null, buffer_after_min: null, price_reais: null, min_price_reais: null };
const nullPlan = { name: null, service_name: null, sessions_per_cycle: null, cycle_days: null, price_reais: null };

describe("catálogo de formulários", () => {
  it("quatro formulários, cada um com tela e schema", () => {
    expect([...FORM_IDS]).toEqual(["lifecycle.settings", "schedule.rules", "service", "recurrence.plan"]);
    for (const f of FORM_IDS) {
      expect(FORM_SCREEN[f].path).toMatch(/^\/app\//);
      expect(DRAFT_SCHEMAS[f]).toBeDefined();
    }
  });

  it("os schemas que o modelo preenche viram JSON Schema fechado (saída estruturada dos provedores)", () => {
    for (const f of FORM_IDS) expect(providerReady(f)).toBe(true);
  });

  it("nenhum rascunho aceita id, versão ou tenant", () => {
    const extra = { expected_version: 3, service_id: "30000000-0000-4000-8000-0000000000a1", tenant_id: "x", version: 1, plan_id: "y" };
    expect(parseFormDraft("lifecycle.settings", { reminder_hours: [24], ...extra })).toBeNull();
    expect(parseFormDraft("service", { name: "Corte", ...extra })).toBeNull();
    expect(parseFormDraft("recurrence.plan", { name: "Plano", ...extra })).toBeNull();
    expect(parseFormDraft("schedule.rules", { days: [2], rules: [], resource_id: "x" })).toBeNull();
  });
});

describe("régua de lembretes", () => {
  it("'lembrete no dia anterior e duas horas antes, e chama de volta quem sumiu há dois meses'", () => {
    const b = buildFormDraft("lifecycle.settings", { ...nullLifecycle, reminder_hours: [2, 24], reactivation_days: 60 }, "…");
    expect(b.draft).toEqual({ reminder_hours: [24, 2], reactivation_days: 60 });
    expect(b.filled.sort()).toEqual(["reactivation_days", "reminder_hours"]);
  });

  it("valores fora do limite do destino saem com observação, o resto fica", () => {
    const b = buildFormDraft("lifecycle.settings", { ...nullLifecycle, reminder_hours: [72], reactivation_days: 5, confirmation: true }, "…");
    expect(b.draft).toEqual({ confirmation: true });
    expect(b.notes.map((n) => n.field).sort()).toEqual(["reactivation_days", "reminder_hours"]);
  });

  it("mais de 4 lembretes não entra", () => {
    const b = buildFormDraft("lifecycle.settings", { ...nullLifecycle, reminder_hours: [48, 24, 12, 6, 2] }, "…");
    expect(b.draft).toBeNull();
  });

  it("nada entendido: sem rascunho e uma frase para o dono", () => {
    const b = buildFormDraft("lifecycle.settings", nullLifecycle, "…");
    expect(b.draft).toBeNull();
    expect(b.notes).toHaveLength(1);
  });
});

describe("horários", () => {
  it("terça a sábado das 9 às 19 com almoço de 12 às 13: duas janelas por dia", () => {
    const windows = [2, 3, 4, 5, 6].flatMap((d) => [{ weekday: d, start: "09:00", end: "12:00" }, { weekday: d, start: "13:00", end: "19:00" }]);
    const b = buildFormDraft("schedule.rules", { days: [2, 3, 4, 5, 6], windows }, "…");
    expect(b.draft?.days).toEqual([2, 3, 4, 5, 6]);
    expect((b.draft?.rules as unknown[]).length).toBe(10);
    expect(parseFormDraft("schedule.rules", b.draft)).not.toBeNull();
  });

  it("dia citado como fechado entra em days sem janela", () => {
    const b = buildFormDraft("schedule.rules", { days: [0, 1], windows: [{ weekday: 1, start: "10:00", end: "16:00" }] }, "…");
    expect(b.draft).toEqual({ days: [0, 1], rules: [{ weekday: 1, local_start: "10:00", local_end: "16:00" }] });
  });

  it("janela que termina antes de começar sai; sobreposição recusa o rascunho", () => {
    const bad = buildFormDraft("schedule.rules", { days: [2], windows: [{ weekday: 2, start: "19:00", end: "09:00" }] }, "…");
    expect(bad.draft).toEqual({ days: [2], rules: [] });
    expect(bad.notes[0]?.field).toBe("rules");
    const over = buildFormDraft("schedule.rules", { days: [2], windows: [{ weekday: 2, start: "09:00", end: "13:00" }, { weekday: 2, start: "12:00", end: "18:00" }] }, "…");
    expect(over.draft).toBeNull();
  });
});

describe("serviço", () => {
  it("'progressiva 2 horas e meia, 280': nome, duração e preço dito", () => {
    const b = buildFormDraft("service", { ...nullService, name: "Progressiva", duration_min: 150, price_reais: 280 }, "progressiva 2 horas e meia, 280");
    expect(b.draft).toEqual({ name: "Progressiva", duration_min: 150, base_price_cents: 28000 });
  });

  it("preço que o texto não diz não entra (nada de média de mercado)", () => {
    const b = buildFormDraft("service", { ...nullService, name: "Corte", price_reais: 60 }, "corte de cabelo masculino, meia hora");
    expect(b.draft).toEqual({ name: "Corte" });
    expect(b.notes[0]).toMatchObject({ field: "base_price_cents" });
  });

  it("preço com centavos e piso ditos; piso acima do preço sai", () => {
    expect(buildFormDraft("service", { ...nullService, price_reais: 54.9, min_price_reais: 45 }, "sai a R$ 54,90, nunca menos de 45").draft)
      .toEqual({ base_price_cents: 5490, min_price_cents: 4500 });
    const b = buildFormDraft("service", { ...nullService, price_reais: 50, min_price_reais: 70 }, "50 e mínimo 70");
    expect(b.draft).toEqual({ base_price_cents: 5000 });
  });

  it("injeção: nome com instrução, link ou dado redigido não entra", () => {
    for (const name of ["Corte https://golpe.example", "Corte [telefone]", "x".repeat(200)]) {
      const b = buildFormDraft("service", { ...nullService, name, duration_min: 30 }, "…");
      expect(b.draft).toEqual({ duration_min: 30 });
    }
  });
});

describe("plano de assinatura", () => {
  it("'plano de 8 treinos por mês a 640'", () => {
    const b = buildFormDraft("recurrence.plan", { ...nullPlan, name: "8 treinos por mês", service_name: "Sessão individual", sessions_per_cycle: 8, cycle_days: 30, price_reais: 640 }, "plano de 8 treinos por mês a 640");
    expect(b.draft).toEqual({ name: "8 treinos por mês", service_name: "Sessão individual", sessions_per_cycle: 8, cycle_days: 30, price_cents: 64000 });
  });

  it("ciclo fora de 7, 14 ou 30 sai com observação", () => {
    const b = buildFormDraft("recurrence.plan", { ...nullPlan, sessions_per_cycle: 4, cycle_days: 21 }, "…");
    expect(b.draft).toEqual({ sessions_per_cycle: 4 });
    expect(b.notes[0]?.field).toBe("cycle_days");
  });
});

describe("dinheiro no texto", () => {
  it.each([
    ["280", 28000], ["R$ 54,90", 5490], ["54.90", 5490], ["1.250", 125000], ["R$ 1.250,50", 125050], ["60 reais", 6000],
  ])("%s → %i centavos", (t, cents) => {
    expect(moneyInText(t).has(cents)).toBe(true);
  });
});

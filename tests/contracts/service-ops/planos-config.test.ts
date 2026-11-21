// Planos e cobrança (1/5) · planos.json é a ÚNICA fonte dos valores dos planos. A migration que publica cada versão
// carrega uma cópia literal; este teste falha se as duas divergirem, se um valor fugir do contrato ou se um módulo do
// plano não for "por ativação".
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODULE_LEVELS, PlanConfig, PlanModule } from "@contracts";

const root = new URL("../../../", import.meta.url);
const raw = JSON.parse(readFileSync(new URL("supabase/functions/service-ops/planos.json", root), "utf8")) as unknown;
const config = PlanConfig.parse(raw);
const migrations = readdirSync(new URL("supabase/migrations/", root)).filter((f) => f.endsWith(".sql")).sort();
/** Último bloco publicado de cada plano (uma migration nova com valores novos substitui o anterior). */
const published = new Map<string, unknown>();
for (const f of migrations) {
  const sql = readFileSync(new URL(`supabase/migrations/${f}`, root), "utf8");
  for (const m of sql.matchAll(/app\.svc_publish_plan\(\$plano\$([\s\S]*?)\$plano\$::jsonb\)/g)) {
    const entry = JSON.parse(m[1]!) as { code: string };
    published.set(entry.code, entry);
  }
}

describe("planos.json", () => {
  it("segue o contrato (sem chave a mais, limites inteiros)", () => {
    expect(PlanConfig.safeParse(raw).success).toBe(true);
  });

  it("Grátis e Completo (fundador) estão lá", () => {
    expect(config.planos.map((p) => p.code).sort()).toEqual(["founder", "free"]);
  });

  it.each(config.planos)("$code: a migration publica exatamente o que está no arquivo", (plan) => {
    expect(published.get(plan.code), `bloco $plano$ de ${plan.code} na migration`).toEqual(plan);
  });

  it.each(config.planos)("$code: só módulos por ativação", (plan) => {
    for (const m of plan.capabilities.modules) expect(MODULE_LEVELS[m]).toBe("activation");
    expect(PlanModule.options.every((m) => MODULE_LEVELS[m] === "activation")).toBe(true);
  });

  it.each(config.planos)("$code: cada pendência aponta para um campo que existe", (plan) => {
    for (const path of plan.a_confirmar_pelo_felipe) {
      const value = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], plan);
      expect(value, path).not.toBeUndefined();
    }
  });

  it("todo número dos planos está marcado como 'a confirmar pelo Felipe' (nenhum valor inventado passa por decidido)", () => {
    for (const plan of config.planos) {
      for (const k of Object.keys(plan.capabilities)) expect(plan.a_confirmar_pelo_felipe).toContain(`capabilities.${k}`);
    }
  });

  it("o Completo libera tudo que o Grátis libera, com limites maiores ou iguais", () => {
    const free = config.planos.find((p) => p.code === "free")!.capabilities;
    const full = config.planos.find((p) => p.code === "founder")!.capabilities;
    expect(free.modules.every((m) => full.modules.includes(m))).toBe(true);
    for (const k of ["customers_max", "bookings_month", "agent_questions_month", "reminders_month"] as const) {
      expect(full[k]).toBeGreaterThanOrEqual(free[k]);
    }
  });

  it("os textos não prometem o que o sistema não faz (ilimitado, garantido)", () => {
    for (const plan of config.planos) {
      const text = [plan.name, plan.description, ...plan.included].join(" ");
      expect(text).not.toMatch(/ilimitad|garant|sem limite/i);
    }
  });
});

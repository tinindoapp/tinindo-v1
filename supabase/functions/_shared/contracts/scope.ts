// Escopo visível do piloto (P51; decisões D1 a, D3 b e D4). Aditivo ao v1.
// Cada módulo tem um nível: `pilot` (todo negócio vê desde o primeiro dia), `activation` (o dono liga em Conta › Mais
// recursos) e `stored` (guardado: código e testes ficam, nada aparece; só o backend liga, por negócio).
// O mesmo mapa está no banco (`app.module_catalog`) e em cada `module.tsx`; tests/contracts/setup compara os três.
// A chave só decide o que aparece. Não é autorização: quem autoriza continua sendo o banco, em cada RPC.
import { z } from "zod";
import { Profession } from "./context.ts";

export const ModuleCode = z.enum([
  "scheduling", "crm", "finance", "identity", "setup", "network", "lifecycle", "pricing", "waitlist", "agent",
  "recurrence", "sales", "growth-advice", "analytics", "referrals", "service-ops",
  "messaging", "payments", "fiscal", "presence", "campaigns", "reputation", "field-service", "discovery", "resources",
  "materials", "finance-advanced",
]);
export type ModuleCode = z.infer<typeof ModuleCode>;

export const ModuleLevel = z.enum(["pilot", "activation", "stored"]);
export type ModuleLevel = z.infer<typeof ModuleLevel>;

/** Nível de cada módulo (docs/qa/revisao-2026-11-10/01-escopo-produto.md, seção 3): 10 + 6 + 11. */
export const MODULE_LEVELS: Record<ModuleCode, ModuleLevel> = {
  scheduling: "pilot", crm: "pilot", finance: "pilot", identity: "pilot", setup: "pilot",
  network: "pilot", lifecycle: "pilot", pricing: "pilot", waitlist: "pilot", agent: "pilot",
  recurrence: "activation", sales: "activation", "growth-advice": "activation",
  analytics: "activation", referrals: "activation", "service-ops": "activation",
  messaging: "stored", payments: "stored", fiscal: "stored", presence: "stored", campaigns: "stored", reputation: "stored",
  "field-service": "stored", discovery: "stored", resources: "stored", materials: "stored", "finance-advanced": "stored",
};

export const ModuleState = z.object({
  module: ModuleCode,
  level: ModuleLevel,
  /** Vale para este negócio agora. Módulo do piloto é sempre true. */
  enabled: z.boolean(),
});
export type ModuleState = z.infer<typeof ModuleState>;

/** O que a sessão do app precisa saber do negócio para montar o menu. */
export const BusinessScope = z.object({
  profession: Profession,
  /** Só o nome: no piloto o plano não libera nem esconde nada (D3 b). */
  plan: z.object({ code: z.string().regex(/^[a-z0-9_]{3,40}$/), name: z.string().min(1).max(80) }),
  modules: z.array(ModuleState).length(27),
});
export type BusinessScope = z.infer<typeof BusinessScope>;

export const SetupScopeInput = z.object({});
export const SetupScopeOutput = BusinessScope;

/** O dono só liga e desliga os módulos `activation`; `pilot` → 400 e `stored` → 403, decididos no banco. */
export const SetupModuleSetInput = z.object({ module: ModuleCode, enabled: z.boolean() });
export const SetupModuleSetOutput = z.object({ module: ModuleCode, enabled: z.boolean(), scope: BusinessScope });
export type SetupModuleSetOutput = z.infer<typeof SetupModuleSetOutput>;

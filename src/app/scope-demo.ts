// Escopo da demonstração offline (P51): o mesmo recorte do piloto, sem servidor. As chaves que o visitante liga em
// "Mais recursos" ficam na aba (sessionStorage), para a tela continuar igual depois de recarregar.
// `localStorage["tinindo.demo.modulos"] = "todos"` liga os 27 módulos: é como os e2e dos módulos "por ativação" e dos
// guardados abrem as suas telas (tests/e2e/escopo.ts). Só vale aqui, na demonstração; com servidor quem decide é o banco.
import { type BusinessScope, MODULE_LEVELS, ModuleCode, type ModuleId } from "@contracts";
import { ApiError } from "../lib/api/client.ts";

export const DEMO_SCOPE_KEY = "tinindo.demo.modulos";
export const DEMO_SCOPE_ALL = "todos";

function read(storage: () => Storage): string | null {
  try {
    return storage().getItem(DEMO_SCOPE_KEY);
  } catch {
    return null;
  }
}

function enabledInTab(): ModuleId[] {
  try {
    const parsed: unknown = JSON.parse(read(() => sessionStorage) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((m): m is ModuleId => ModuleCode.safeParse(m).success && MODULE_LEVELS[m as ModuleId] === "activation") : [];
  } catch {
    return [];
  }
}

export function demoScope(): BusinessScope {
  const all = read(() => localStorage) === DEMO_SCOPE_ALL;
  const on = new Set(enabledInTab());
  return {
    // Negócio de exemplo da demonstração: Barbearia Exemplo A.
    profession: "barber",
    plan: { code: "free", name: "Grátis" },
    modules: ModuleCode.options.map((module) => ({
      module,
      level: MODULE_LEVELS[module],
      enabled: all || MODULE_LEVELS[module] === "pilot" || on.has(module),
    })),
  };
}

/** Mesmas regras do servidor: só os módulos "por ativação" têm chave para o dono. */
export function demoSetModule(module: ModuleId, enabled: boolean): BusinessScope {
  const level = MODULE_LEVELS[module];
  if (level === "pilot") throw new ApiError("VALIDATION_ERROR", "Este recurso faz parte do piloto.", 400, null, false, "module");
  if (level === "stored") throw new ApiError("FORBIDDEN", "Este recurso não está disponível no piloto.", 403, null, false);
  const on = new Set(enabledInTab());
  if (enabled) on.add(module);
  else on.delete(module);
  try {
    sessionStorage.setItem(DEMO_SCOPE_KEY, JSON.stringify([...on]));
  } catch {
    /* armazenamento indisponível: a chave vale só até recarregar */
  }
  return demoScope();
}

export function resetDemoScope(): void {
  try {
    sessionStorage.removeItem(DEMO_SCOPE_KEY);
    localStorage.removeItem(DEMO_SCOPE_KEY);
  } catch {
    /* sem armazenamento, nada a limpar */
  }
}

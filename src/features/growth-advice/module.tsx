// Módulo Metas e sugestões · P22 + P45 (tasks/P22.md, tasks/P45.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./growth-advice.css";
import "./goals.css";

export { useGrowthAdvicePort } from "./use-port.ts";

export const growthAdviceModule: ModuleDefinition = {
  id: "growth-advice",
  owner: "P22",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "activation",
  path: "metas",
  navLabel: "Metas e sugestões",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.GoalsLayout) }],
};

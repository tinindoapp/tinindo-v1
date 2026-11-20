// Módulo Notas fiscais · P16 (tasks/P16.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./fiscal.css";

export const fiscalModule: ModuleDefinition = {
  id: "fiscal",
  owner: "P16",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "stored",
  path: "notas",
  navLabel: "Notas fiscais",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.FiscalLayout) }],
};

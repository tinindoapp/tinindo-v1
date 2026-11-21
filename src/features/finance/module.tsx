// Módulo Caixa · P07 (tasks/P07.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `finance`.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda. O caixa emulado (demo.ts) segue exportado daqui
// porque a Hoje e o "Atendido" da Agenda usam o mesmo.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import { getDemoPort, resetDemoPort } from "./demo.ts";
import "./finance.css";

export { getDemoPort, resetDemoPort };

export const financeModule: ModuleDefinition = {
  id: "finance",
  owner: "P07",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "caixa",
  navLabel: "Caixa",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.FinanceLayout) }],
};

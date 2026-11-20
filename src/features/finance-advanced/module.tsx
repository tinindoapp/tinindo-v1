// Módulo Contas · P31 (tasks/P31.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `finance-advanced`.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./accounts.css";

export const financeAdvancedModule: ModuleDefinition = {
  id: "finance-advanced",
  owner: "P31",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "stored",
  path: "contas",
  navLabel: "Contas",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.AccountsLayout) }],
};

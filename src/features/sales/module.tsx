// Módulo Orçamentos · P11 (tasks/P11.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `sales`.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./sales.css";

// Importa e reexporta (em vez de `export … from`): tests/e2e/foundation/rotas.ts segue imports para ler as rotas.
import { salesPublicRoutes } from "./public-routes.tsx";
export { salesPublicRoutes };

export const salesModule: ModuleDefinition = {
  id: "sales",
  owner: "P11",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "activation",
  path: "orcamentos",
  navLabel: "Orçamentos",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.SalesLayout) }],
};

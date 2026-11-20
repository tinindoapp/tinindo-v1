// Módulo Site e Google · P17 (tasks/P17.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./presence.css";

/** Rota pública (/s/:slug → /p/:slug), definida em public-routes.tsx para o pacote das páginas do cliente. */
// Importa e reexporta (em vez de `export … from`): tests/e2e/foundation/rotas.ts segue imports para ler as rotas.
import { presencePublicRoutes } from "./public-routes.tsx";
export { presencePublicRoutes };

export const presenceModule: ModuleDefinition = {
  id: "presence",
  owner: "P17",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "stored",
  path: "site",
  navLabel: "Site e Google",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.PresenceLayout) }],
};

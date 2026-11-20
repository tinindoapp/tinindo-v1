// Módulo Pagamentos · P14 (tasks/P14.md). Só esta pasta pertence ao módulo; src/app/modules.ts e router.tsx são do integrador.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda (recado #147: o e2e de totais espera a lista).
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./payments.css";

// Importa e reexporta (em vez de `export … from`): tests/e2e/foundation/rotas.ts segue imports para ler as rotas.
import { paymentsPublicRoutes } from "./public-routes.tsx";
export { paymentsPublicRoutes };

export const paymentsModule: ModuleDefinition = {
  id: "payments",
  owner: "P14",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "stored",
  path: "pagamentos",
  navLabel: "Pagamentos",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.PaymentsLayout) }],
};

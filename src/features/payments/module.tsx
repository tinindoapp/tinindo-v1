// Módulo Pagamentos · P14 (tasks/P14.md). Só esta pasta pertence ao módulo; src/app/modules.ts e router.tsx são do integrador.
// Manifesto (P53): a tela fica em routes.tsx. Exceção: por enquanto ela entra no pacote inicial, porque
// tests/e2e/qa/totais.spec.ts lê a lista "Quem está devendo" logo depois de abrir a página, sem esperar a tela carregar
// sob demanda (recado para-felipe do P53). Quando o teste esperar a lista, troque `element` por
// `lazy: screen(() => import("./routes.tsx"), (m) => m.PaymentsLayout)`.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { PaymentsLayout } from "./routes.tsx";
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
  routes: [{ index: true, element: <PaymentsLayout /> }],
};

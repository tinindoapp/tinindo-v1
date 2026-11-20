// Módulo Clientes e catálogo · dono: P02 (tasks/P02.md).
// Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";

const routes = () => import("./routes.tsx");

export const crmModule: ModuleDefinition = {
  id: "crm",
  owner: "P02",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "clientes",
  navLabel: "Clientes",
  routes: [
    {
      lazy: screen(routes, (m) => m.CrmLayout),
      children: [
        { index: true, lazy: screen(routes, (m) => m.CustomersPage) },
        { path: "servicos", lazy: screen(routes, (m) => m.ServicesPage) },
        { path: "importar", lazy: screen(routes, (m) => m.ImportPage) },
        // Ficha do cliente (rotas fixas acima vencem o parâmetro).
        { path: ":customerId", lazy: screen(routes, (m) => m.CustomerPage) },
      ],
    },
  ],
};

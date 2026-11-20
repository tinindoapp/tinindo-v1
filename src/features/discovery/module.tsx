// Módulo Diretório · P23 (tasks/P23.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./discovery.css";

const directory = screen(() => import("./routes.tsx"), (m) => m.PublicDirectory);

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const discoveryPublicRoutes: RouteObject[] = [
  { path: "/diretorio", lazy: directory },
  { path: "/diretorio/:uf/:cidade", lazy: directory },
  { path: "/diretorio/:uf/:cidade/:categoria", lazy: directory },
];

export const discoveryModule: ModuleDefinition = {
  id: "discovery",
  owner: "P23",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "stored",
  path: "diretorio",
  navLabel: "Diretório",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.SettingsLayout) }],
};

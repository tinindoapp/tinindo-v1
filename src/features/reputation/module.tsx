// Módulo Avaliações · P24 (tasks/P24.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import { reputationAnonRoutes } from "./public-routes.tsx";
import "./reputation.css";

/** Rotas fora do shell: o cliente avalia (com login, sem negócio) e a lista pública do perfil. */
export const reputationPublicRoutes: RouteObject[] = [
  { path: "/avaliar", lazy: screen(() => import("./routes.tsx"), (m) => m.CustomerReview) },
  ...reputationAnonRoutes,
];

export const reputationModule: ModuleDefinition = {
  id: "reputation",
  owner: "P24",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "stored",
  path: "avaliacoes",
  navLabel: "Avaliações",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.OwnerLayout) }],
};

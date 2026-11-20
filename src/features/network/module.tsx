// Módulo Perfil · dono: P09 (tasks/P09.md). Só esta pasta pertence ao módulo;
// src/app/modules.ts e src/app/router.tsx são do integrador.
// Manifesto (P53): as telas são carregadas sob demanda.
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import { networkAnonRoutes } from "./public-routes.tsx";

const pages = () => import("./PublicPages.tsx");

export const networkModule: ModuleDefinition = {
  id: "network",
  owner: "P09",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "perfil",
  navLabel: "Perfil",
  routes: [
    { index: true, lazy: screen(() => import("./NetworkHome.tsx"), (m) => m.NetworkHome) },
    { path: "previa", lazy: screen(pages, (m) => m.ProfilePreviewPage) },
  ],
};

/**
 * Rotas públicas, fora do shell autenticado. Não aceitam nada por GET: inspeção e aceite são POST disparados por ação
 * explícita.
 */
export const networkPublicRoutes: RouteObject[] = [
  // /p/:slug vem de public-routes.tsx (sem sessão), o mesmo arquivo que o pacote das páginas do cliente usa.
  ...networkAnonRoutes,
  { path: "/convite", lazy: screen(pages, (m) => m.InvitePage) },
  { path: "/indicar", lazy: screen(pages, (m) => m.RecommendPage) },
];

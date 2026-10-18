// Módulo Perfil · dono: P09 (tasks/P09.md). Só esta pasta pertence ao módulo;
// src/app/modules.ts e src/app/router.tsx são do integrador.
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { NetworkHome } from "./NetworkHome.tsx";
import { InvitePage, ProfilePreviewPage, PublicProfilePage, RecommendPage } from "./PublicPages.tsx";

export const networkModule: ModuleDefinition = {
  id: "network",
  owner: "P09",
  path: "perfil",
  navLabel: "Perfil",
  routes: [
    { index: true, element: <NetworkHome /> },
    { path: "previa", element: <ProfilePreviewPage /> },
  ],
};

/**
 * Rotas públicas, fora do shell autenticado. PROPOSTA ao integrador: montar em
 * src/app/router.tsx ao lado de /entrar, ex.: `...networkPublicRoutes`.
 * Não aceitam nada por GET: inspeção e aceite são POST disparados por ação explícita.
 */
export const networkPublicRoutes: RouteObject[] = [
  { path: "/p/:slug", element: <PublicProfilePage /> },
  { path: "/convite", element: <InvitePage /> },
  { path: "/indicar", element: <RecommendPage /> },
];

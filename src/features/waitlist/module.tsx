// Módulo Lista de espera · P06 (tasks/P06.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, rotulada; com Supabase, a função `waitlist`.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { RouteObject } from "react-router";
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./waitlist.css";

/** Rotas públicas, fora do shell autenticado (montadas em src/app/router.tsx). */
export const waitlistPublicRoutes: RouteObject[] = [
  { path: "/oferta", lazy: screen(() => import("./routes.tsx"), (m) => m.PublicOffer) },
];

export const waitlistModule: ModuleDefinition = {
  id: "waitlist",
  owner: "P06",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "lista-de-espera",
  navLabel: "Lista de espera",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.WaitlistLayout) }],
};

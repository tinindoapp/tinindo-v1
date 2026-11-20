// Módulo Relacionamento · P13 (tasks/P13.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `lifecycle`.
// P49: a sub-rota `retorno` é a quinta aba da barra (decisão D2 b), com lembretes a mandar, quem não volta e lista de espera.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./lifecycle.css";

const routes = () => import("./routes.tsx");

export const lifecycleModule: ModuleDefinition = {
  id: "lifecycle",
  owner: "P13",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "relacionamento",
  navLabel: "Relacionamento",
  routes: [
    { index: true, lazy: screen(routes, (m) => m.LifecycleLayout) },
    { path: "retorno", lazy: screen(routes, (m) => m.RetornoLayout) },
  ],
};

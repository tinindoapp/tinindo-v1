// Módulo Preços · P05 (tasks/P05.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, rotulada; com Supabase, a função `pricing`.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./pricing.css";

export const pricingModule: ModuleDefinition = {
  id: "pricing",
  owner: "P05",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "precos",
  navLabel: "Preços",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.PricingLayout) }],
};

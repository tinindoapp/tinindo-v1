// Módulo Assinaturas · P20 (tasks/P20.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `recurrence`.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./recurrence.css";

export const recurrenceModule: ModuleDefinition = {
  id: "recurrence",
  owner: "P20",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "activation",
  path: "assinaturas",
  navLabel: "Assinaturas",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.RecurrenceLayout) }],
};

// Módulo Assistente · P08 (tasks/P08.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa o mesmo motor sobre dados de exemplo; com Supabase, a função `agent`.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./agent.css";

export const agentModule: ModuleDefinition = {
  id: "agent",
  owner: "P08",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "assistente",
  navLabel: "Assistente",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.AgentLayout) }],
};

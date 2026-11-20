// Módulo Canal · P12 (tasks/P12.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `messaging`.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./messaging.css";

export { InboxExtraProvider } from "./inbox-extra.ts";

const routes = () => import("./routes.tsx");

export const messagingModule: ModuleDefinition = {
  id: "messaging",
  owner: "P12",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "stored",
  path: "mensagens",
  navLabel: "Mensagens",
  routes: [
    { index: true, lazy: screen(routes, (m) => m.InboxLayout) },
    { path: "simulador", lazy: screen(routes, (m) => m.SimulatorLayout) },
    // Tela da conversa (a rota fixa "simulador" vence o parâmetro).
    { path: ":contactId", lazy: screen(routes, (m) => m.ConversationLayout) },
  ],
};

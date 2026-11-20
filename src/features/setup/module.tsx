// Módulo Configuração · P44 (tasks/P44.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `setup`.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda. O cartão da Home (SetupCard) e a porta saem
// daqui; a Home os liga com a mesma porta.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";

export { SetupCard } from "./SetupCard.tsx";
export { useSetupPort } from "./use-port.ts";

export const setupModule: ModuleDefinition = {
  id: "setup",
  owner: "P44",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "pilot",
  path: "configurar",
  navLabel: "Configuração",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.SetupLayout) }],
};

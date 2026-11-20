// Módulo Indicações · P21 (tasks/P21.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Manifesto (P53): a tela fica em routes.tsx e é carregada sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./referrals.css";

export const referralsModule: ModuleDefinition = {
  id: "referrals",
  owner: "P21",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "activation",
  path: "indicacoes",
  navLabel: "Indicações",
  routes: [{ index: true, lazy: screen(() => import("./routes.tsx"), (m) => m.ReferralsLayout) }],
};

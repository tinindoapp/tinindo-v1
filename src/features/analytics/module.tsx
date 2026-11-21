// Módulo Resultado · P18 (tasks/P18.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa números sintéticos rotulados; com Supabase, a função `analytics`.
// O custo por cliente fica em /app/resultado/custo, fora do menu: o banco decide quem é operador; quem não é da equipe
// (sinal `isOperator` da sessão, recado #88) vê só o aviso, sem chamar o servidor.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./analytics.css";

const routes = () => import("./routes.tsx");
// P32: o painel do piloto (src/features/pilot) entra por aqui, sob demanda, até o integrador registrar o módulo próprio
// (recado). Só a equipe Tinindo passa do OperatorGate.
const pilotRoutes = () => import("../pilot/routes.tsx");

export const analyticsModule: ModuleDefinition = {
  id: "analytics",
  owner: "P18",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "activation",
  path: "resultado",
  navLabel: "Resultado",
  routes: [
    { index: true, lazy: screen(routes, (m) => m.ResultLayout) },
    { path: "custo", lazy: screen(routes, (m) => m.CostLayout) },
    // P32 bloco 4: "Sua semana" e "Seu mês".
    { path: "relatorio", lazy: screen(routes, (m) => m.ReportLayout) },
    { path: "piloto", lazy: screen(pilotRoutes, (m) => m.PilotLayout) },
  ],
};

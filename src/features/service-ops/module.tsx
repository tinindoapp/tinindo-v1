// Módulo Plano e serviços · P15 (tasks/P15.md). Só esta pasta pertence ao módulo; src/app/modules.ts é do integrador.
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `service-ops`.
// A tela da operação fica em /app/servicos-tinindo/operacao, fora do menu: o banco decide quem é operador; quem não é
// da equipe (sinal `isOperator` da sessão, recado #88) vê só o aviso, sem chamar o servidor.
// Manifesto (P53): as telas ficam em routes.tsx e são carregadas sob demanda.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { screen } from "../../app/lazy-route.ts";
import "./service-ops.css";

const routes = () => import("./routes.tsx");

export const serviceOpsModule: ModuleDefinition = {
  id: "service-ops",
  owner: "P15",
  // P51: nível de visibilidade no piloto (o mesmo mapa está em @contracts MODULE_LEVELS e no banco).
  level: "activation",
  path: "servicos-tinindo",
  navLabel: "Plano e serviços",
  routes: [
    { index: true, lazy: screen(routes, (m) => m.ServicesLayout) },
    { path: "operacao", lazy: screen(routes, (m) => m.OpsLayout) },
  ],
};

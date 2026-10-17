// Módulo Assistente · dono: P08 (tasks/P08.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const agentModule: ModuleDefinition = {
  id: "agent",
  owner: "P08",
  path: "assistente",
  navLabel: "Assistente",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Assistente" owner="P08" summary="Assistente com ferramentas limitadas e aprovação." />,
    },
  ],
};

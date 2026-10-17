// Módulo Caixa · dono: P07 (tasks/P07.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const financeModule: ModuleDefinition = {
  id: "finance",
  owner: "P07",
  path: "caixa",
  navLabel: "Caixa",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Caixa" owner="P07" summary="Recebíveis, recebimentos manuais e pacotes de sessões." />,
    },
  ],
};

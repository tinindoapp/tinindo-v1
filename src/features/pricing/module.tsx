// Módulo Preços · dono: P05 (tasks/P05.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const pricingModule: ModuleDefinition = {
  id: "pricing",
  owner: "P05",
  path: "precos",
  navLabel: "Preços",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Preços" owner="P05" summary="Regras de preço por horário com piso e aprovação." />,
    },
  ],
};

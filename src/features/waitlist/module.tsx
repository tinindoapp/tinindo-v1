// Módulo Lista de espera · dono: P06 (tasks/P06.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const waitlistModule: ModuleDefinition = {
  id: "waitlist",
  owner: "P06",
  path: "lista-de-espera",
  navLabel: "Lista de espera",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Lista de espera" owner="P06" summary="Lista de espera e ofertas de vaga com aceite seguro." />,
    },
  ],
};

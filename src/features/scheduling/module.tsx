// Módulo Agenda · dono: P04 (tasks/P04.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const schedulingModule: ModuleDefinition = {
  id: "scheduling",
  owner: "P04",
  path: "agenda",
  navLabel: "Agenda",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Agenda" owner="P04" summary="Agenda visual diária e semanal, reservas e reagendamentos." />,
    },
  ],
};

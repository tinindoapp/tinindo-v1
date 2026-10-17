// Módulo Perfil · dono: P09 (tasks/P09.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const networkModule: ModuleDefinition = {
  id: "network",
  owner: "P09",
  path: "perfil",
  navLabel: "Perfil",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Perfil" owner="P09" summary="Perfil público, área do cliente e convites." />,
    },
  ],
};

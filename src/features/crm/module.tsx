// Módulo Clientes · dono: P02 (tasks/P02.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const crmModule: ModuleDefinition = {
  id: "crm",
  owner: "P02",
  path: "clientes",
  navLabel: "Clientes",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Clientes" owner="P02" summary="Clientes, serviços, custos e importação mínima." />,
    },
  ],
};

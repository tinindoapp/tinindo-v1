// Módulo Conta · dono: P01 (tasks/P01.md). Esqueleto do P00: substitua pelas telas reais.
// Só este arquivo e esta pasta pertencem ao módulo; src/app/modules.ts é do integrador.
import type { ModuleDefinition } from "../../app/module-types.ts";
import { ModulePlaceholder } from "../../app/pages/ModulePlaceholder.tsx";

export const identityModule: ModuleDefinition = {
  id: "identity",
  owner: "P01",
  path: "conta",
  navLabel: "Conta",
  routes: [
    {
      index: true,
      element: <ModulePlaceholder title="Conta" owner="P01" summary="Login, negócio, membros e onboarding técnico." />,
    },
  ],
};

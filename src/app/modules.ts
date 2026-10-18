// Registro central de módulos (dono: integrador). Cada pacote edita APENAS o próprio
// src/features/<módulo>/module.tsx; aqui só entra/sai uma linha por módulo.
import type { ModuleDefinition } from "./module-types.ts";
import { identityModule } from "../features/identity/module.tsx";
import { crmModule } from "../features/crm/module.tsx";
import { schedulingModule } from "../features/scheduling/module.tsx";
import { pricingModule } from "../features/pricing/module.tsx";
import { waitlistModule } from "../features/waitlist/module.tsx";
import { financeModule } from "../features/finance/module.tsx";
import { agentModule } from "../features/agent/module.tsx";
import { networkModule } from "../features/network/module.tsx";
import { salesModule } from "../features/sales/module.tsx";

export const MODULES: readonly ModuleDefinition[] = [
  schedulingModule,
  crmModule,
  financeModule,
  salesModule,
  pricingModule,
  waitlistModule,
  agentModule,
  networkModule,
  identityModule,
];

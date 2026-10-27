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
import { serviceOpsModule } from "../features/service-ops/module.tsx";
import { analyticsModule } from "../features/analytics/module.tsx";
import { messagingModule } from "../features/messaging/module.tsx";
import { paymentsModule } from "../features/payments/module.tsx";
import { lifecycleModule } from "../features/lifecycle/module.tsx";
import { recurrenceModule } from "../features/recurrence/module.tsx";
import { referralsModule } from "../features/referrals/module.tsx";
import { campaignsModule } from "../features/campaigns/module.tsx";
import { growthAdviceModule } from "../features/growth-advice/module.tsx";
import { presenceModule } from "../features/presence/module.tsx";
import { fiscalModule } from "../features/fiscal/module.tsx";
import { discoveryModule } from "../features/discovery/module.tsx";
import { reputationModule } from "../features/reputation/module.tsx";
import { resourcesModule } from "../features/resources/module.tsx";

export const MODULES: readonly ModuleDefinition[] = [
  schedulingModule,
  crmModule,
  messagingModule,
  financeModule,
  paymentsModule,
  fiscalModule,
  lifecycleModule,
  reputationModule,
  recurrenceModule,
  referralsModule,
  campaignsModule,
  growthAdviceModule,
  salesModule,
  analyticsModule,
  pricingModule,
  waitlistModule,
  agentModule,
  networkModule,
  presenceModule,
  discoveryModule,
  serviceOpsModule,
  resourcesModule,
  identityModule,
];

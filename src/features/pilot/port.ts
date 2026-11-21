// P32 · porta do painel do piloto (equipe Tinindo). Servidor: função `pilot`; demonstração: dados de exemplo rotulados.
import type { PilotPanelOutput } from "../../../supabase/functions/pilot/contract.ts";

export type { PilotBusiness, PilotPanelOutput } from "../../../supabase/functions/pilot/contract.ts";

export interface PilotPort {
  readonly kind: "demo" | "server";
  now(): Date;
  panel(period: { starts_at: string; ends_at: string }): Promise<PilotPanelOutput>;
}

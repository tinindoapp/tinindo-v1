// Porta real do painel do piloto: função `pilot`, sem negócio selecionado (o banco confere se é operador).
import type { createApiClient } from "../../lib/api/client.ts";
import { PilotPanelOutput } from "../../../supabase/functions/pilot/contract.ts";
import type { PilotPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerPilotPort(call: Call): PilotPort {
  return {
    kind: "server",
    now: () => new Date(),
    async panel(period) {
      return (await call("/pilot/pilot.panel", PilotPanelOutput, { method: "POST", body: { period } })).data;
    },
  };
}

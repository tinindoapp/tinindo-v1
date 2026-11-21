// Edge Function `pilot` (P32): leituras do piloto para a equipe Tinindo. Cada operação é uma RPC sem negócio
// selecionado (`tenant: false`); o banco confere se quem pede é operador ativo (app.svc_operator).
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";
import { PilotFunnelInput, PilotFunnelOutput, PilotPanelInput, PilotPanelOutput } from "./contract.ts";

export type PilotDeps = RpcHandlerDeps;

export const PILOT_ROUTES: Record<string, Route> = {
  "pilot.funnel": route({ rpc: "pilot_funnel", input: PilotFunnelInput, output: PilotFunnelOutput, command: false, tenant: false, args: () => ({}) }),
  "pilot.panel": route({
    rpc: "pilot_panel", input: PilotPanelInput, output: PilotPanelOutput, command: false, tenant: false,
    args: (i) => ({ p_from: i.period.starts_at, p_to: i.period.ends_at }),
  }),
};

export const createPilotHandler = (deps: PilotDeps) => createRpcHandler("pilot", PILOT_ROUTES, deps);

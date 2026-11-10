// Edge Function `setup` (P44): configuração guiada. Cada operação é uma RPC transacional (ver _shared/http/rpc-handler.ts).
// O estado dos passos é calculado no banco pelos dados reais; criar serviços e aplicar o rascunho passam pelas RPCs do
// P02 e do P03, com a confirmação do dono já dada na tela. A leitura `setup.progress` grava a medição (primeira
// conclusão de cada passo + evento), por isso a RPC não é `stable`, mas a rota continua uma consulta (sem chave).
import {
  SetupDismissInput,
  SetupDismissOutput,
  SetupDraftApplyInput,
  SetupDraftApplyOutput,
  SetupProgressInput,
  SetupProgressOutput,
  SetupServicesApplyInput,
  SetupServicesApplyOutput,
  SetupTemplatesInput,
  SetupTemplatesOutput,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type SetupDeps = RpcHandlerDeps;

export const SETUP_ROUTES: Record<string, Route> = {
  "setup.progress": route({ rpc: "setup_progress", input: SetupProgressInput, output: SetupProgressOutput, command: false, args: () => ({}) }),
  "setup.dismiss": route({
    rpc: "setup_dismiss", input: SetupDismissInput, output: SetupDismissOutput, command: true,
    args: (i) => ({ p_step: i.step, p_dismissed: i.dismissed }),
  }),
  "setup.templates": route({ rpc: "setup_templates", input: SetupTemplatesInput, output: SetupTemplatesOutput, command: false, args: () => ({}) }),
  "setup.services_apply": route({
    rpc: "setup_services_apply", input: SetupServicesApplyInput, output: SetupServicesApplyOutput, command: true,
    args: (i) => ({ p_services: i.services }),
  }),
  "setup.draft_apply": route({
    rpc: "setup_draft_apply", input: SetupDraftApplyInput, output: SetupDraftApplyOutput, command: true,
    args: (i) => ({ p_profession: i.profession, p_hours: i.hours, p_services: i.services }),
  }),
};

export function createSetupHandler(deps: SetupDeps) {
  return createRpcHandler("setup", SETUP_ROUTES, deps);
}

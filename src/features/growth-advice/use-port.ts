// Porta do módulo para a sessão atual (demonstração rotulada ou servidor). Também usada pela casca (resumo semanal na
// caixa de Mensagens), por isso fica fora de routes.tsx: o manifesto reexporta.
import { usePort } from "../../app/api.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { GrowthAdvicePort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

export function useGrowthAdvicePort(): GrowthAdvicePort | null {
  return usePort<GrowthAdvicePort>({ demo: createDemoPort, server: createServerPort });
}

// Porta do módulo Configuração para a sessão atual. A Home usa a mesma (cartão de configuração), por isso fica fora de
// routes.tsx: o manifesto reexporta e a casca não precisa baixar a tela para mostrar o cartão.
import { usePort } from "../../app/api.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { SetupPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

/** null = conta sem negócio selecionado. */
export function useSetupPort(): SetupPort | null {
  return usePort<SetupPort>({ demo: createDemoPort, server: createServerPort });
}

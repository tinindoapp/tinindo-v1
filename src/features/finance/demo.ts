// Caixa emulado da demonstração: um por carregamento de página, compartilhado pela tela do Caixa, pela Hoje e pelo
// "Atendido" da Agenda (P48). Fica fora de routes.tsx para a Hoje usar sem baixar a tela do Caixa (P53, recado #148).
import { completedVisits, provideDemoCollect } from "../../lib/demo/journey.ts";
import { createDemoPort } from "./demoPort.ts";
import type { FinancePort } from "./port.ts";

let demoPort: FinancePort | null = null;
/** Uma emulação por carregamento de página: as mudanças valem enquanto a aba estiver aberta. */
export function getDemoPort(): FinancePort {
  // Atendimentos concluídos na Agenda da mesma aba aparecem aqui como "sem cobrança" (nunca como recebidos).
  demoPort ??= createDemoPort({ visits: completedVisits });
  return demoPort;
}
/** Só para testes. */
export function resetDemoPort() {
  demoPort = null;
}
// P48: "Atendido" na Agenda e na Hoje cobra neste mesmo caixa emulado (o mesmo que a tela do Caixa lê).
provideDemoCollect(getDemoPort);

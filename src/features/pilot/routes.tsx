// P32 · tela do painel do piloto, carregada sob demanda pelo manifesto do Resultado (/app/resultado/piloto), atrás
// do OperatorGate: o banco decide quem é operador; quem não é vê só o aviso, sem chamar o servidor.
import { useSessionPort } from "../../app/api.tsx";
import { MODULES } from "../../app/modules.ts";
import { OperatorGate } from "../../app/OperatorGate.tsx";
import { createDemoPilotPort } from "./demoPort.ts";
import { PilotPage } from "./PilotPage.tsx";
import type { PilotPort } from "./port.ts";
import { createServerPilotPort } from "./serverPort.ts";
import "./pilot.css";

// Telas do menu: uma por módulo, pelo caminho do manifesto (Operação Tinindo e o próprio painel ficam de fora).
const MENU = MODULES.filter((m) => m.id !== "service-ops").map((m) => ({ path: m.path, label: m.navLabel }));

export function PilotLayout() {
  return (
    <OperatorGate title="Painel do piloto" headingId="pilot-title">
      <PilotScreen />
    </OperatorGate>
  );
}

function PilotScreen() {
  const port = useSessionPort<PilotPort>({ demo: createDemoPilotPort, server: createServerPilotPort });
  return <PilotPage key={port.kind} port={port} menu={MENU} />;
}

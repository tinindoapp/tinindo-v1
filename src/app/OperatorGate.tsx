// Telas da equipe Tinindo (recado #88). Com o sinal `isOperator === false`, mostra só o aviso e nem monta a tela,
// então nenhuma chamada sai para o servidor. Enquanto o sinal carrega ou se a leitura falhou (null), a tela monta e
// o servidor decide (FORBIDDEN continua tratado em cada tela). Isto não autoriza nada.
import type { ReactNode } from "react";
import { PageHeader, StatusBanner } from "../components/ui/index.tsx";
import { useSession } from "./session.tsx";

export function OperatorGate({ title, headingId, children }: { title: string; headingId: string; children: ReactNode }) {
  const { isOperator } = useSession();
  if (isOperator === false) {
    return (
      <div className="tn-page-intro">
        <PageHeader id={headingId} title={title} />
        <StatusBanner tone="warning">Só a equipe Tinindo acessa esta tela.</StatusBanner>
      </div>
    );
  }
  return <>{children}</>;
}

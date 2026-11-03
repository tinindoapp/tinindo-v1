// Estado "ainda não configurado" de uma tela principal (P44, docs/12): uma frase e um botão para a tela que resolve
// (ou para os passos da configuração). Complementa o EmptyState de cada módulo; não é chat nem aviso de sistema.
import type { ReactNode } from "react";
import { Link } from "react-router";

export function SetupHint({ children, to, action }: { children: ReactNode; to: string; action: string }) {
  return (
    <div className="tn-setup-hint">
      <p className="tn-setup-hint__text">{children}</p>
      <Link to={to} className="tn-button" data-variant="secondary">{action}</Link>
    </div>
  );
}

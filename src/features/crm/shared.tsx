// Peças visuais internas do módulo CRM (sem novos componentes globais; ADR-0005).
import type { ReactNode } from "react";
import { Outlet } from "react-router";
import "./crm.css";

// P54, D11 (b): o aviso de demonstração fica só na faixa do topo (shell); as telas do módulo não repetem.

/** Moldura das telas do módulo (as sub-telas ficam no menu do app, não em abas próprias). */
export function CrmOutlet() {
  return (
    <div className="tn-stack">
      <Outlet />
    </div>
  );
}

/** Lista carregando (item 40): linhas cinzas no lugar dos itens, sem piscar "lista vazia". O leitor de tela ouve o texto. */
export function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="crm-skeleton" role="status">
      <span className="tn-visually-hidden">{label}</span>
      <ul aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <span className="crm-skeleton__line" data-size="lg" />
            <span className="crm-skeleton__line" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Estado vazio de uma lista (item 40): o que aconteceu, o próximo passo e a ação. */
export function EmptyState({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="crm-empty">
      <p className="crm-empty__title">{title}</p>
      {children ? <p className="tn-muted">{children}</p> : null}
      {actions ? <div className="tn-actions">{actions}</div> : null}
    </div>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="crm-tag">{children}</span>;
}

/** Erros do zod → mensagem por campo (primeiro problema de cada campo). */
export function fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "");
    out[k] ??= i.message;
  }
  return out;
}

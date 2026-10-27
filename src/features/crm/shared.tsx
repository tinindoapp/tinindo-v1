// Peças visuais internas do módulo CRM (sem novos componentes globais; ADR-0005).
import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { StatusBanner } from "../../components/ui/index.tsx";
import { useCrmApi } from "./api.ts";
import "./crm.css";

/** Aviso da demonstração, logo abaixo do cabeçalho de cada tela do módulo. */
export function CrmDemoNotice() {
  const api = useCrmApi();
  return api.readOnly ? (
    <StatusBanner tone="info">Demonstração sem servidor: dados de exemplo, nada é salvo. Os formulários ficam bloqueados.</StatusBanner>
  ) : null;
}

/** Moldura das telas do módulo (as sub-telas ficam no menu do app, não em abas próprias). */
export function CrmOutlet() {
  return (
    <div className="tn-stack">
      <Outlet />
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

// Peças visuais internas do módulo CRM (sem novos componentes globais; ADR-0005).
import { type ReactNode, useId } from "react";
import { NavLink, Outlet } from "react-router";
import { StatusBanner } from "../../components/ui/index.tsx";
import { useCrmApi } from "./api.ts";
import "./crm.css";

export function CrmTabs() {
  const api = useCrmApi();
  return (
    <div className="crm-stack">
      <nav className="crm-tabs" aria-label="Seções de clientes e catálogo">
        <NavLink to="." end>Clientes</NavLink>
        <NavLink to="servicos">Serviços</NavLink>
        <NavLink to="importar">Importar CSV</NavLink>
      </nav>
      {api.readOnly ? (
        <StatusBanner tone="info">
          Demonstração sem servidor: dados de exemplo, nada é salvo. Os formulários ficam bloqueados.
        </StatusBanner>
      ) : null}
      <Outlet />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="tn-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
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

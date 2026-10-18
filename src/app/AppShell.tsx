import { Navigate, NavLink, Outlet } from "react-router";
import { Button, Wordmark } from "../components/ui/index.tsx";
import { DemoBanner } from "./DemoBanner.tsx";
import { MODULES } from "./modules.ts";
import { useSession } from "./session.tsx";
import "./shell.css";

export { DemoBanner };

export function AppShell() {
  const session = useSession();
  const { state } = session;

  if (state.status === "loading") {
    return (
      <p className="tn-shell-loading" role="status">
        Carregando…
      </p>
    );
  }
  if (state.status === "signed_out") return <Navigate to="/entrar" replace />;

  const memberships = state.memberships;

  return (
    <div className="tn-shell">
      <DemoBanner />
      <header className="tn-shell__header tn-glass">
        <NavLink to="/app" aria-label="Início">
          <Wordmark width={120} />
        </NavLink>
        <div className="tn-shell__account">
          {memberships.length > 1 ? (
            <label className="tn-shell__tenant">
              <span className="tn-visually-hidden">Negócio</span>
              <select value={session.tenantId ?? ""} onChange={(e) => session.selectTenant(e.target.value)}>
                {memberships.map((m) => (
                  <option key={m.tenant_id} value={m.tenant_id}>
                    {m.tenant_name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="tn-shell__tenant-name">{memberships[0]?.tenant_name ?? "Sem negócio"}</span>
          )}
          {state.status === "signed_in" ? (
            <Button variant="ghost" onClick={() => void session.signOut()}>
              Sair
            </Button>
          ) : null}
        </div>
      </header>
      <nav className="tn-shell__nav" aria-label="Principal">
        <ul>
          <li>
            <NavLink to="/app" end>
              Início
            </NavLink>
          </li>
          {MODULES.map((m) => (
            <li key={m.id}>
              <NavLink to={`/app/${m.path}`}>{m.navLabel}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="tn-shell__main" id="conteudo">
        {memberships.length === 0 ? (
          <p>Sua conta ainda não está ligada a um negócio. Peça um convite ou conclua o cadastro.</p>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

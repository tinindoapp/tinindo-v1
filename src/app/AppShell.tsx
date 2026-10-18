import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { Button, Wordmark } from "../components/ui/index.tsx";
import { DemoBanner } from "./DemoBanner.tsx";
import { MODULES } from "./modules.ts";
import { useSession } from "./session.tsx";
import "./shell.css";

export { DemoBanner };

/** Área da Conta (P01): alcançável sem negócio, para criar o primeiro ou resgatar um vínculo de cliente. */
export function isAccountArea(pathname: string): boolean {
  return pathname === "/app/conta" || pathname.startsWith("/app/conta/");
}

export function AppShell() {
  const session = useSession();
  const { state } = session;
  const { pathname } = useLocation();

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
      {/* Foca o conteúdo sem pôr "#conteudo" na URL (o histórico e os links com hash ficam intactos). */}
      <a
        className="tn-skip-link"
        href="#conteudo"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("conteudo")?.focus();
        }}
      >
        Pular para o conteúdo
      </a>
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
      <main className="tn-shell__main" id="conteudo" tabIndex={-1}>
        {/* Sem negócio, só a Conta abre: ela lê tudo pelo servidor (RLS/RPC), sem dado de tenant. */}
        {memberships.length === 0 && !isAccountArea(pathname) ? (
          <p>
            Sua conta ainda não está ligada a um negócio.{" "}
            <Link to="/app/conta/novo-negocio">Criar meu negócio</Link> ou{" "}
            <Link to="/app/conta/vincular">usar um código de vínculo</Link>.
          </p>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

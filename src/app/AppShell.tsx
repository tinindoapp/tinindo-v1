import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { BrandSymbol, Wordmark } from "../components/ui/index.tsx";
import { Icon, IconSprite } from "../components/ui/icons.tsx";
import { DemoBanner } from "./DemoBanner.tsx";
import { MODULES } from "./modules.ts";
import { buildNavigation, HOME, isItemActive, type NavSection, sectionFor } from "./navigation.ts";
import { useSession } from "./session.tsx";
import "./shell.css";

export { DemoBanner };

/** Área da Conta (P01): alcançável sem negócio, para criar o primeiro ou resgatar um vínculo de cliente. */
export function isAccountArea(pathname: string): boolean {
  return pathname === "/app/conta" || pathname.startsWith("/app/conta/");
}

function TenantSwitcher({ compact }: { compact?: boolean }) {
  const session = useSession();
  const memberships = session.state.status === "loading" || session.state.status === "signed_out" ? [] : session.state.memberships;
  if (memberships.length > 1) {
    return (
      <label className="tn-tenant" data-compact={compact || undefined}>
        <span className="tn-visually-hidden">Negócio</span>
        <select value={session.tenantId ?? ""} onChange={(e) => session.selectTenant(e.target.value)}>
          {memberships.map((m) => (
            <option key={m.tenant_id} value={m.tenant_id}>
              {m.tenant_name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return <span className="tn-tenant__name">{memberships[0]?.tenant_name ?? "Sem negócio"}</span>;
}

/** Sub-abas do grupo atual (ex.: Dinheiro → Caixa, Pagamentos, Assinaturas). No desktop a barra lateral já mostra. */
function SectionTabs({ section }: { section: NavSection }) {
  return (
    <nav className="tn-subnav" aria-label={`Telas de ${section.label}`}>
      <ul>
        {section.items.map((i) => (
          <li key={i.to}>
            <NavLink to={i.to}>{i.label}</NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell() {
  const session = useSession();
  const { state } = session;
  const { pathname } = useLocation();
  const sections = useMemo(() => buildNavigation(MODULES), []);
  // Menu do celular aberto na rota em que foi aberto: navegar fecha sem efeito colateral.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const menuOpen = openAt === pathname;
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenAt(null);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.dataset.menuOpen = "true";
    return () => {
      document.removeEventListener("keydown", onKey);
      delete document.body.dataset.menuOpen;
    };
  }, [menuOpen]);

  if (state.status === "loading") {
    return (
      <p className="tn-shell-loading" role="status">
        Carregando…
      </p>
    );
  }
  if (state.status === "signed_out") return <Navigate to="/entrar" replace />;

  const memberships = state.memberships;
  const current = sectionFor(sections, pathname);
  const closeMenu = () => {
    setOpenAt(null);
    menuButton.current?.focus();
  };

  return (
    <div className="tn-app">
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
      <IconSprite />
      <div className="tn-app__top">
        <DemoBanner />
        <header className="tn-appbar tn-glass">
          <NavLink to="/app" end className="tn-appbar__brand" aria-label="Início">
            <span className="tn-only-mobile"><BrandSymbol size={32} /></span>
            <span className="tn-only-desktop"><Wordmark width={120} /></span>
          </NavLink>
          <div className="tn-appbar__tenant">
            <TenantSwitcher compact />
          </div>
          {state.status === "signed_in" ? (
            <button type="button" className="tn-appbar__action tn-only-desktop" onClick={() => void session.signOut()}>
              <Icon name="sair" size={20} />
              Sair
            </button>
          ) : null}
          <button
            ref={menuButton}
            type="button"
            className="tn-appbar__action tn-only-mobile"
            aria-expanded={menuOpen}
            aria-controls="tn-menu"
            data-active={current && !current.tab ? true : undefined}
            onClick={() => setOpenAt(menuOpen ? null : pathname)}
          >
            <Icon name="menu" size={22} />
            Menu
          </button>
        </header>
      </div>

      {menuOpen ? <div className="tn-scrim" aria-hidden="true" onClick={closeMenu} /> : null}
      <nav id="tn-menu" className="tn-nav" aria-label="Principal" data-open={menuOpen || undefined}>
        <div className="tn-nav__head">
          <strong>Menu</strong>
          <button ref={closeButton} type="button" className="tn-icon-button" aria-label="Fechar menu" onClick={closeMenu}>
            <Icon name="fechar" size={22} />
          </button>
        </div>
        <ul className="tn-nav__list">
          <li>
            <NavLink to={HOME.to} end className="tn-nav__link">
              <Icon name={HOME.icon} size={20} />
              {HOME.label}
            </NavLink>
          </li>
        </ul>
        {sections.map((s) => (
          <div className="tn-nav__group" key={s.id}>
            {/* Grupo de um item só (Assistente): o próprio item já é o título. */}
            {s.items.length > 1 ? <p className="tn-nav__title">{s.label}</p> : null}
            <ul className="tn-nav__list">
              {s.items.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} className="tn-nav__link">
                    <Icon name={i.icon} size={20} />
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="tn-nav__foot tn-only-mobile">
          <TenantSwitcher />
          {state.status === "signed_in" ? (
            <button type="button" className="tn-nav__link" onClick={() => void session.signOut()}>
              <Icon name="sair" size={20} />
              Sair
            </button>
          ) : null}
        </div>
      </nav>

      <main className="tn-main" id="conteudo" tabIndex={-1}>
        {current && current.items.length > 1 ? <SectionTabs section={current} /> : null}
        <div className="tn-main__inner">
          {/* Sem negócio, só a Conta abre: ela lê tudo pelo servidor (RLS/RPC), sem dado de tenant. */}
          {memberships.length === 0 && !isAccountArea(pathname) ? (
            <div className="tn-empty">
              <h1>Vamos começar</h1>
              <p>Sua conta ainda não está ligada a um negócio.</p>
              <p>
                <Link to="/app/conta/novo-negocio">Criar meu negócio</Link> ou <Link to="/app/conta/vincular">usar um código de vínculo</Link>.
              </p>
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>

      <nav className="tn-tabbar tn-glass" aria-label="Abas">
        <ul>
          <li>
            <NavLink to={HOME.to} end>
              <Icon name={HOME.icon} />
              <span>{HOME.label}</span>
            </NavLink>
          </li>
          {sections
            .filter((s) => s.tab)
            .map((s) => {
              const active = s.items.some((i) => isItemActive(i, pathname));
              return (
                <li key={s.id}>
                  <Link to={s.to} aria-current={active ? "page" : undefined}>
                    <Icon name={s.icon} />
                    <span>{s.label}</span>
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
    </div>
  );
}

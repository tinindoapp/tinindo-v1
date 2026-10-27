// Título e foco por rota (WCAG 2.4.2 e 2.4.3), para todas as páginas sem exigir mudança nos módulos.
// O título vem do <h1> da tela ("Agenda · Tinindo"). Ao trocar de caminho, o foco vai para o <h1>,
// que o leitor de tela anuncia; na primeira carga o foco não é movido. Mudar só a query (ex.: dia da
// agenda) não move o foco, para não tirar a pessoa do controle que acabou de usar.
import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { DemoBanner } from "./DemoBanner.tsx";

export const APP_TITLE = "Tinindo";
/** Telas que montam o <h1> depois de carregar dados têm este prazo para ele aparecer. */
const WAIT_MS = 2000;

export function pageTitle(heading: string | null | undefined): string {
  const text = heading?.replace(/\s+/g, " ").trim();
  return text ? `${text} · ${APP_TITLE}` : APP_TITLE;
}

function findHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("h1");
}

function focusHeading(el: HTMLElement) {
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: false });
}

export function RouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    const moveFocus = !first.current;
    first.current = false;
    let focused: HTMLElement | null = null;

    const apply = () => {
      const heading = findHeading();
      document.title = pageTitle(heading?.textContent);
      if (!moveFocus || !heading) return;
      // Refoca se o <h1> focado foi trocado (ex.: "Carregando…" → conteúdo) e o foco caiu no body.
      const lost = focused && !focused.isConnected && document.activeElement === document.body;
      if (!focused || lost) {
        focusHeading(heading);
        focused = heading;
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const stop = setTimeout(() => observer.disconnect(), WAIT_MS);
    return () => {
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}

/** Raiz do roteador: faixa "Demonstração" (uma vez, em todas as rotas), efeitos globais de navegação e a rota atual. */
export function RouteFrame() {
  return (
    <>
      <DemoBanner />
      <RouteFocus />
      <Outlet />
    </>
  );
}

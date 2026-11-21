// Faixa do app instalável (P34), montada numa raiz própria ao lado do app (register.ts), sem tocar no AppShell:
// - "Nova versão disponível" com "Atualizar";
// - convite para instalar no celular (depois de um dia de uso; "Agora não" vale 30 dias) e as instruções de "Adicionar à tela de início"
//   para iPhone e Android. As instruções abrem também pelo endereço com #instalar (link no menu, por recado).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../components/ui/index.tsx";
import { now } from "../../lib/time.ts";
import { dismissInstall, installDismissed, installSteps, inviteDue, type Platform, platformOf } from "./install.ts";
import type { PwaStore } from "./store.ts";
import "./pwa.css";

const INSTALL_HASH = "#instalar";

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function useRoute() {
  const read = () => ({ path: window.location.pathname, hash: window.location.hash });
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const update = () => setRoute((cur) => {
      const next = read();
      return cur.path === next.path && cur.hash === next.hash ? cur : next;
    });
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    // O roteador troca o caminho com pushState, que não dispara evento.
    const t = window.setInterval(update, 1000);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
      window.clearInterval(t);
    };
  }, []);
  return route;
}

const isPhone = () => window.matchMedia?.("(pointer: coarse)").matches && window.matchMedia("(max-width: 900px)").matches;

export function PwaLayer({ store, onApply }: { store: PwaStore; onApply(): void }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const route = useRoute();
  const [updateHidden, setUpdateHidden] = useState(false);
  const [dismissed, setDismissed] = useState(() => installDismissed(now().getTime(), safeStorage()));
  const [due] = useState(() => inviteDue(now().getTime(), safeStorage()));
  const [helpOpenByTap, setHelpOpen] = useState(false);
  // A rota em que o dono fechou as instruções: voltar a abrir #instalar depois (rota nova) abre de novo.
  const [closedAt, setClosedAt] = useState<object | null>(null);
  const platform = platformOf({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone: state.standalone });

  // #instalar abre as instruções (link do menu); fechar tira o #instalar do endereço.
  const helpOpen = helpOpenByTap || (route.hash === INSTALL_HASH && closedAt !== route);

  const inApp = route.path === "/app" || route.path.startsWith("/app/");
  const offerInstall = inApp && due && !state.standalone && !dismissed && !helpOpen && isPhone();

  const closeHelp = () => {
    setHelpOpen(false);
    setClosedAt(route);
    if (window.location.hash === INSTALL_HASH) history.replaceState(history.state, "", window.location.pathname + window.location.search);
  };

  async function install() {
    const p = state.installPrompt;
    if (!p) {
      setHelpOpen(true);
      return;
    }
    await p.prompt().catch(() => undefined);
    const choice = await p.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    store.set({ installPrompt: null });
    if (choice.outcome === "dismissed") setHelpOpen(true);
  }

  return (
    <>
      {state.updateReady && !updateHidden ? (
        <div className="tn-pwa-bar" role="status" aria-live="polite">
          <p><strong>Nova versão disponível.</strong> {state.updating ? "Atualizando…" : "Atualize quando terminar o que está fazendo."}</p>
          <div className="tn-pwa-bar__actions">
            <Button size="compact" loading={state.updating} loadingText="Atualizando…" onClick={onApply}>Atualizar</Button>
            {state.updating ? null : <Button size="compact" variant="ghost" onClick={() => setUpdateHidden(true)}>Depois</Button>}
          </div>
        </div>
      ) : null}
      {offerInstall && !state.updateReady ? (
        <aside className="tn-pwa-bar" aria-label="Instalar o app">
          <p><strong>Use a Tinindo como app.</strong> Abre pelo ícone, em tela cheia, sem procurar o endereço.</p>
          <div className="tn-pwa-bar__actions">
            <Button size="compact" onClick={() => void install()}>{state.installPrompt ? "Instalar" : "Como instalar"}</Button>
            <Button size="compact" variant="ghost" onClick={() => {
              dismissInstall(now().getTime(), safeStorage());
              setDismissed(true);
            }}>Agora não</Button>
          </div>
        </aside>
      ) : null}
      {helpOpen ? <InstallHelp platform={platform} standalone={state.standalone} canPrompt={!!state.installPrompt} onInstall={() => void install()} onClose={closeHelp} /> : null}
    </>
  );
}

function InstallHelp({ platform, standalone, canPrompt, onInstall, onClose }: {
  platform: Platform; standalone: boolean; canPrompt: boolean; onInstall(): void; onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);
  const main = installSteps(platform);
  const others = (["ios", "android"] as const).filter((p) => p !== platform && !(platform === "ios-other-browser" && p === "ios"));
  return (
    <dialog ref={ref} className="tn-pwa-help" aria-labelledby="tn-pwa-help-title" onClose={onClose} onCancel={onClose}>
      <h2 id="tn-pwa-help-title">Adicionar à tela de início</h2>
      {standalone ? <p>Você já está usando a Tinindo como app neste aparelho.</p> : (
        <>
          <p>O app é o mesmo do navegador, com os mesmos dados. Instalar só coloca o ícone na tela e abre em tela cheia.</p>
          {canPrompt ? <Button block onClick={onInstall}>Instalar agora</Button> : null}
          <h3>{main.title}</h3>
          <ol>{main.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {others.map((p) => {
            const o = installSteps(p);
            return (
              <details key={p}>
                <summary>{o.title}</summary>
                <ol>{o.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              </details>
            );
          })}
        </>
      )}
      <Button variant="secondary" block onClick={() => {
        ref.current?.close();
        onClose();
      }}>Fechar</Button>
    </dialog>
  );
}

export function mountPwaLayer(store: PwaStore, onApply: () => void): void {
  if (document.getElementById("tn-pwa")) return;
  const el = document.createElement("div");
  el.id = "tn-pwa";
  document.body.appendChild(el);
  createRoot(el).render(<PwaLayer store={store} onApply={onApply} />);
}

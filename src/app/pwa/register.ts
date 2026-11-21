// Registro do service worker e montagem da faixa do app instalável (P34). Chamado pelo src/main.tsx só fora das páginas
// do cliente final: quem só reserva pelo link não baixa o app inteiro para o cache.
//
// Atualização: o navegador confere o sw.js a cada abertura, e o app a cada 30 minutos com a tela visível. A versão nova
// baixa tudo e assume sozinha (sw.ts); a página aberta continua com o código dela e mostra "Nova versão disponível".
// "Atualizar" recarrega no código novo. Sem o toque, a próxima abertura já é a versão nova.
import { applyOfflineMessage, wireOffline } from "./offline.ts";
import { SW_MESSAGE } from "./sw-logic.ts";
import { createPwaStore, type PwaStore } from "./store.ts";
import type { DeferredPrompt } from "./install.ts";

const CHECK_EVERY_MS = 30 * 60_000;

export interface RegisterDeps {
  container: ServiceWorkerContainer;
  store: PwaStore;
  reload(): void;
  /** Para o teste: sem intervalo de verdade. */
  every?(fn: () => void, ms: number): void;
  visible?(): boolean;
}

/** Liga o registro ao estado. Devolve a função de "Atualizar" (a faixa chama). */
export async function wireServiceWorker(deps: RegisterDeps): Promise<{ apply(): void }> {
  const { container, store } = deps;
  // Já registrado: reaproveita. Primeira vez: registra.
  const existing = await container.getRegistration("/").catch(() => undefined);
  const reg = existing ?? (await container.register("/sw.js", { scope: "/", updateViaCache: "none" }));
  // Primeira instalação não é "versão nova": só avisa quando já havia um service worker controlando a página.
  let hadController = !!container.controller;

  container.addEventListener("controllerchange", () => {
    if (hadController) store.set({ updateReady: true });
    hadController = true;
  });

  const every = deps.every ?? ((fn, ms) => void setInterval(fn, ms));
  const visible = deps.visible ?? (() => document.visibilityState === "visible");
  every(() => {
    if (visible()) void reg.update().catch(() => undefined);
  }, CHECK_EVERY_MS);

  return {
    apply() {
      store.set({ updating: true });
      deps.reload();
    },
  };
}

export const pwaStore = createPwaStore();

/** Entrada do main.tsx. Falha em silêncio: sem service worker o app funciona como sempre. */
export async function registerPwa(): Promise<void> {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  pwaStore.set({ standalone: !!standalone });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pwaStore.set({ installPrompt: e as DeferredPrompt });
  });
  window.addEventListener("appinstalled", () => pwaStore.set({ installPrompt: null, standalone: true }));

  wireOffline({ store: pwaStore, win: window, doc: document, reload: () => window.location.reload(), later: (fn, ms) => void setTimeout(fn, ms) });
  let apply = () => window.location.reload();
  if ("serviceWorker" in navigator) {
    try {
      navigator.serviceWorker.addEventListener("message", (e) => applyOfflineMessage(pwaStore, e.data));
      apply = (await wireServiceWorker({ container: navigator.serviceWorker, store: pwaStore, reload: () => window.location.reload() })).apply;
      watchSignOut(() => navigator.serviceWorker.controller?.postMessage({ type: SW_MESSAGE.clearOffline }));
    } catch {
      /* registro recusado (modo privado, http): segue sem */
    }
  }
  const { mountPwaLayer } = await import("./PwaLayer.tsx");
  mountPwaLayer(pwaStore, () => apply());
}

/** Login do Supabase guardado neste aparelho (chave `sb-<projeto>-auth-token`). */
export function hasStoredLogin(storage: Pick<Storage, "length" | "key"> | null): boolean {
  try {
    if (!storage) return false;
    for (let i = 0; i < storage.length; i++) if (/^sb-.+-auth-token$/.test(storage.key(i) ?? "")) return true;
  } catch {
    /* sem acesso: trata como sem login */
  }
  return false;
}

/**
 * Saiu da conta: o que estava guardado para uso sem internet sai do aparelho. Confere a cada 10 s e quando outra aba
 * muda o login (evento storage), sem depender da tela de sessão.
 */
export function watchSignOut(onSignOut: () => void, storage: Storage | null = safeLocalStorage(), every = (fn: () => void) => void setInterval(fn, 10_000)) {
  let had = hasStoredLogin(storage);
  const check = () => {
    const has = hasStoredLogin(storage);
    if (had && !has) onSignOut();
    had = has;
  };
  every(check);
  window.addEventListener("storage", check);
  return check;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Estado do app instalável, fora do React: o registro do service worker escreve, a faixa (PwaLayer) lê.
import type { DeferredPrompt } from "./install.ts";

export interface PwaState {
  /** Uma versão nova já foi baixada e espera o toque em "Atualizar". */
  updateReady: boolean;
  /** Tocou em "Atualizar": a página recarrega quando a versão nova assumir. */
  updating: boolean;
  /** Pedido de instalação do navegador (Android/Chromium), guardado até o toque em "Instalar". */
  installPrompt: DeferredPrompt | null;
  /** O app já está aberto como instalado (tela cheia, pelo ícone). */
  standalone: boolean;
}

type Listener = () => void;

export function createPwaStore(initial: Partial<PwaState> = {}) {
  let state: PwaState = { updateReady: false, updating: false, installPrompt: null, standalone: false, ...initial };
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<PwaState>) {
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export type PwaStore = ReturnType<typeof createPwaStore>;

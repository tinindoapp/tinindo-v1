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
  /** O navegador diz que está sem rede. */
  offline: boolean;
  /** Hora (ISO) dos dados guardados mais antigos que a tela mostrou sem internet; null = a tela está com dados da rede. */
  offlineSavedAt: string | null;
  /** A internet voltou depois de a tela mostrar dados guardados: falta atualizar. */
  reconnected: boolean;
}

type Listener = () => void;

export function createPwaStore(initial: Partial<PwaState> = {}) {
  let state: PwaState = {
    updateReady: false, updating: false, installPrompt: null, standalone: false, offline: false, offlineSavedAt: null, reconnected: false,
    ...initial,
  };
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

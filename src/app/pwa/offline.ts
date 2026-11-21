// Sem internet (P34, item 2), lado da página: junta o que o navegador diz (online/offline) com o que o service worker
// avisa (mostrou dados guardados, ou voltou a receber da rede) e decide o aviso. Ao voltar a conexão depois de dados
// guardados, atualiza a tela: recarrega sozinho se ninguém está digitando; se está, pede o toque em "Atualizar".
import type { PwaStore } from "./store.ts";

export type OfflineMessage = { type: "tinindo:offline-data"; savedAt: string } | { type: "tinindo:online-data" };

/** Mensagem do service worker → estado. Guarda a hora MAIS ANTIGA mostrada (é ela que o aviso precisa dizer). */
export function applyOfflineMessage(store: PwaStore, msg: unknown): void {
  const m = msg as Partial<OfflineMessage> | null;
  if (m?.type === "tinindo:offline-data" && typeof m.savedAt === "string") {
    const cur = store.get().offlineSavedAt;
    store.set({ offlineSavedAt: cur && cur < m.savedAt ? cur : m.savedAt, reconnected: false });
  }
}

/** Alguém está digitando? (campo de texto com foco). Aí não recarregamos sozinhos. */
export function typing(doc: Document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export interface OfflineDeps {
  store: PwaStore;
  win: Pick<Window, "addEventListener"> & { navigator: { onLine: boolean } };
  doc: Document;
  reload(): void;
  later(fn: () => void, ms: number): void;
}

export function wireOffline(deps: OfflineDeps): void {
  const { store, win } = deps;
  store.set({ offline: !win.navigator.onLine });
  win.addEventListener("offline", () => store.set({ offline: true }));
  win.addEventListener("online", () => {
    const showedSaved = store.get().offlineSavedAt !== null;
    store.set({ offline: false, reconnected: showedSaved });
    if (!showedSaved) return;
    // Um instante para a rede firmar; depois, a tela pede tudo de novo.
    deps.later(() => {
      if (store.get().reconnected && !typing(deps.doc)) deps.reload();
    }, 1500);
  });
}

/** "Dados de 14:05": hora local do aparelho em que os dados foram guardados. */
export function savedAtLabel(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

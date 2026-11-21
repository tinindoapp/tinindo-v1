import { describe, expect, it, vi } from "vitest";
import { applyOfflineMessage, savedAtLabel, typing, wireOffline } from "./offline.ts";
import { hasStoredLogin, watchSignOut } from "./register.ts";
import { createPwaStore } from "./store.ts";

function win(onLine: boolean) {
  const t = new EventTarget();
  return Object.assign(t, { navigator: { onLine } });
}

describe("aviso sem conexão (P34, item 2)", () => {
  it("guarda a hora mais antiga dos dados mostrados; ignora mensagem estranha", () => {
    const store = createPwaStore();
    applyOfflineMessage(store, { type: "tinindo:offline-data", savedAt: "2026-11-21T17:05:00.000Z" });
    applyOfflineMessage(store, { type: "tinindo:offline-data", savedAt: "2026-11-21T18:00:00.000Z" });
    applyOfflineMessage(store, { type: "tinindo:offline-data", savedAt: "2026-11-21T16:30:00.000Z" });
    applyOfflineMessage(store, { type: "outra" });
    applyOfflineMessage(store, null);
    expect(store.get().offlineSavedAt).toBe("2026-11-21T16:30:00.000Z");
  });

  it("'dados de HH:MM' na hora local", () => {
    expect(savedAtLabel("2026-11-21T17:05:00.000Z", "America/Sao_Paulo")).toBe("14:05");
  });

  it("volta a conexão depois de dados guardados: recarrega sozinho se ninguém digita", () => {
    const store = createPwaStore();
    const w = win(false);
    const reload = vi.fn();
    const timers: (() => void)[] = [];
    wireOffline({ store, win: w as never, doc: document, reload, later: (fn) => void timers.push(fn) });
    expect(store.get().offline).toBe(true);
    applyOfflineMessage(store, { type: "tinindo:offline-data", savedAt: "2026-11-21T17:05:00.000Z" });
    w.dispatchEvent(new Event("online"));
    expect(store.get()).toMatchObject({ offline: false, reconnected: true });
    timers.shift()!();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("com alguém digitando, não recarrega (o aviso pede o toque)", () => {
    const store = createPwaStore({ offlineSavedAt: "2026-11-21T17:05:00.000Z" });
    const w = win(false);
    const reload = vi.fn();
    const timers: (() => void)[] = [];
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(typing(document)).toBe(true);
    wireOffline({ store, win: w as never, doc: document, reload, later: (fn) => void timers.push(fn) });
    w.dispatchEvent(new Event("online"));
    timers.shift()!();
    expect(reload).not.toHaveBeenCalled();
    input.remove();
  });

  it("caiu e voltou sem mostrar dado guardado: nada a atualizar", () => {
    const store = createPwaStore();
    const w = win(true);
    const reload = vi.fn();
    const later = vi.fn();
    wireOffline({ store, win: w as never, doc: document, reload, later });
    w.dispatchEvent(new Event("offline"));
    expect(store.get().offline).toBe(true);
    w.dispatchEvent(new Event("online"));
    expect(store.get().reconnected).toBe(false);
    expect(later).not.toHaveBeenCalled();
  });
});

describe("saiu da conta: limpa o que estava guardado", () => {
  it("reconhece o login guardado do Supabase", () => {
    localStorage.clear();
    expect(hasStoredLogin(localStorage)).toBe(false);
    localStorage.setItem("sb-proj-auth-token", "{}");
    expect(hasStoredLogin(localStorage)).toBe(true);
    expect(hasStoredLogin(null)).toBe(false);
  });

  it("com login → sem login chama a limpeza uma vez", () => {
    localStorage.clear();
    localStorage.setItem("sb-proj-auth-token", "{}");
    const onOut = vi.fn();
    const check = watchSignOut(onOut, localStorage, () => undefined);
    check();
    expect(onOut).not.toHaveBeenCalled();
    localStorage.removeItem("sb-proj-auth-token");
    check();
    check();
    expect(onOut).toHaveBeenCalledOnce();
  });
});

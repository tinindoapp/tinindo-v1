// Atualização segura (P34): aviso só quando uma versão nova assume uma página que já estava controlada; "Atualizar"
// recarrega; o app confere a versão a cada 30 minutos só com a tela visível.
import { describe, expect, it, vi } from "vitest";
import { wireServiceWorker } from "./register.ts";
import { createPwaStore } from "./store.ts";

class FakeRegistration extends EventTarget {
  update = vi.fn(async () => undefined);
}

function setup(opts: { controller: boolean; registered?: boolean } = { controller: true }) {
  const reg = new FakeRegistration();
  const container = Object.assign(new EventTarget(), {
    controller: opts.controller ? {} : null,
    getRegistration: vi.fn(async () => (opts.registered ? reg : undefined)),
    register: vi.fn(async () => reg),
  });
  const store = createPwaStore();
  const reload = vi.fn();
  let tick: () => void = () => undefined;
  let visible = true;
  const deps = {
    container: container as unknown as ServiceWorkerContainer,
    store,
    reload,
    every: (fn: () => void) => { tick = fn; },
    visible: () => visible,
  };
  return { reg, container, store, reload, deps, tick: () => tick(), hide: () => { visible = false; } };
}

describe("registro do service worker", () => {
  it("registra /sw.js no escopo raiz, sem cache HTTP do script; já registrado, não registra de novo", async () => {
    const s = setup();
    await wireServiceWorker(s.deps);
    expect(s.container.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    const again = setup({ controller: true, registered: true });
    await wireServiceWorker(again.deps);
    expect(again.container.register).not.toHaveBeenCalled();
  });

  it("primeira instalação (página sem controle) não mostra 'Nova versão'; a seguinte mostra", async () => {
    const s = setup({ controller: false });
    await wireServiceWorker(s.deps);
    s.container.dispatchEvent(new Event("controllerchange"));
    expect(s.store.get().updateReady).toBe(false);
    s.container.dispatchEvent(new Event("controllerchange"));
    expect(s.store.get().updateReady).toBe(true);
  });

  it("versão nova assumiu: avisa e não recarrega sozinha; 'Atualizar' recarrega", async () => {
    const s = setup();
    const { apply } = await wireServiceWorker(s.deps);
    s.container.dispatchEvent(new Event("controllerchange"));
    expect(s.store.get().updateReady).toBe(true);
    expect(s.reload).not.toHaveBeenCalled();
    apply();
    expect(s.store.get().updating).toBe(true);
    expect(s.reload).toHaveBeenCalledOnce();
  });

  it("confere a versão periodicamente só com a tela visível", async () => {
    const s = setup();
    await wireServiceWorker(s.deps);
    s.tick();
    expect(s.reg.update).toHaveBeenCalledTimes(1);
    s.hide();
    s.tick();
    expect(s.reg.update).toHaveBeenCalledTimes(1);
  });
});

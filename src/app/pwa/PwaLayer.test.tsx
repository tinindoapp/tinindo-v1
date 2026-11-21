import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaLayer } from "./PwaLayer.tsx";
import { createPwaStore } from "./store.ts";

function phone(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && /(coarse|max-width)/.test(q), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  // Primeiro uso há dois dias: o convite já pode aparecer.
  localStorage.setItem("tinindo.pwa.primeiro-uso", String(Date.now() - 2 * 86_400_000));
  history.replaceState(null, "", "/app");
  phone(true);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
});
afterEach(() => vi.restoreAllMocks());

describe("faixa do app instalável", () => {
  it("'Nova versão disponível': Atualizar chama a troca; Depois esconde", () => {
    const store = createPwaStore({ updateReady: true });
    const onApply = vi.fn();
    render(<PwaLayer store={store} onApply={onApply} />);
    expect(screen.getByRole("status")).toHaveTextContent("Nova versão disponível");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(onApply).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Depois" }));
    expect(screen.queryByText(/Nova versão/)).toBeNull();
  });

  it("convite para instalar só no celular, dentro do app e fora do modo instalado; 'Agora não' guarda a escolha", () => {
    const store = createPwaStore();
    const { unmount } = render(<PwaLayer store={store} onApply={() => undefined} />);
    expect(screen.getByRole("complementary", { name: "Instalar o app" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agora não" }));
    expect(screen.queryByRole("complementary", { name: "Instalar o app" })).toBeNull();
    unmount();
    render(<PwaLayer store={createPwaStore()} onApply={() => undefined} />);
    expect(screen.queryByRole("complementary", { name: "Instalar o app" })).toBeNull();
  });

  it("no primeiro dia de uso não convida", () => {
    localStorage.clear();
    render(<PwaLayer store={createPwaStore()} onApply={() => undefined} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(localStorage.getItem("tinindo.pwa.primeiro-uso")).not.toBeNull();
  });

  it("não convida no computador, já instalado, ou fora do /app", () => {
    phone(false);
    const a = render(<PwaLayer store={createPwaStore()} onApply={() => undefined} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    a.unmount();
    phone(true);
    const b = render(<PwaLayer store={createPwaStore({ standalone: true })} onApply={() => undefined} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    b.unmount();
    history.replaceState(null, "", "/entrar");
    render(<PwaLayer store={createPwaStore()} onApply={() => undefined} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("com o pedido do navegador, 'Instalar' abre a instalação; recusada, mostra as instruções", async () => {
    const prompt = vi.fn(async () => undefined);
    const store = createPwaStore({ installPrompt: Object.assign(new Event("beforeinstallprompt"), { prompt, userChoice: Promise.resolve({ outcome: "dismissed" as const }) }) });
    render(<PwaLayer store={store} onApply={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Adicionar à tela de início" })).toBeInTheDocument();
  });

  it("#instalar abre as instruções do aparelho e as dos outros", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1");
    history.replaceState(null, "", "/app/agenda#instalar");
    render(<PwaLayer store={createPwaStore()} onApply={() => undefined} />);
    expect(screen.getByRole("heading", { name: "No iPhone (Safari)" })).toBeInTheDocument();
    expect(screen.getByText(/Adicionar à Tela de Início/, { selector: "li" })).toBeInTheDocument();
    expect(screen.getByText("No Android (Chrome)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(window.location.hash).toBe("");
  });
});

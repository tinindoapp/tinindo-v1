// "Por quê?" nas sugestões de Metas e sugestões (T3): uma chamada só ao abrir, "Carregando…", selo só para a frase do
// assistente, frase fixa se a chamada falhar; regra sem dado suficiente explica o que falta em "O que a conta olhou".
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { GoalsPage } from "./GoalsPage.tsx";

beforeEach(() => resetDemoState());
afterEach(() => act(() => dismissToast()));

const FIXED = "De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta. Um lembrete no dia anterior costuma ajudar quem esquece. Ajuste os lembretes em Relacionamento.";
const renderPage = (port: ReturnType<typeof createDemoPort>) => render(<MemoryRouter><GoalsPage port={port} /><Toaster /></MemoryRouter>);
async function noShowItem() {
  const open = await screen.findByRole("list", { name: "Sugestões abertas" }, { timeout: 3000 });
  const item = (await within(open).findByRole("heading", { name: "Faltas concentradas na quarta" })).closest("li")!;
  return within(item);
}

describe("Metas e sugestões · Por quê?", () => {
  it("abre com uma chamada, mostra a frase fixa sem selo; fechar e abrir de novo não chama outra vez", async () => {
    const port = createDemoPort();
    const explain = vi.spyOn(port, "explain");
    renderPage(port);
    const item = await noShowItem();
    const button = item.getByRole("button", { name: /^Por quê\?\s*Faltas concentradas na quarta$/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(explain).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(button); });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(await item.findByText(FIXED)).toBeInTheDocument();
    expect(item.queryByText("escrito pelo assistente")).toBeNull();
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel).toHaveAttribute("aria-live", "polite");
    expect(panel).toHaveTextContent(FIXED);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(item.queryByText(FIXED)).toBeNull();
    await act(async () => { fireEvent.click(button); });
    expect(item.getByText(FIXED)).toBeInTheDocument();
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it("frase do assistente: Carregando… enquanto espera e o selo discreto depois", async () => {
    const port = createDemoPort();
    let resolve: (v: Awaited<ReturnType<NonNullable<typeof port.explain>>>) => void = () => {};
    vi.spyOn(port, "explain").mockImplementation((id) => new Promise((r) => { resolve = r; void id; }));
    renderPage(port);
    const item = await noShowItem();
    fireEvent.click(item.getByRole("button", { name: /^Por quê\?/ }));
    expect(item.getByRole("status")).toHaveTextContent("Carregando…");
    await act(async () => { resolve({ insight_id: "x", version: 1, text: "De 21/08 a 20/10, 5 de 12 atendimentos de quarta tiveram falta.", source: "assistant" }); });
    expect(item.getByText(/5 de 12 atendimentos de quarta tiveram falta\.$/)).toBeInTheDocument();
    expect(item.getByText("escrito pelo assistente")).toBeInTheDocument();
  });

  it("a chamada falhou: mostra a frase fixa calculada com a mesma evidência, sem erro", async () => {
    const port = createDemoPort();
    vi.spyOn(port, "explain").mockRejectedValue(new Error("rede"));
    renderPage(port);
    const item = await noShowItem();
    await act(async () => { fireEvent.click(item.getByRole("button", { name: /^Por quê\?/ })); });
    expect(await item.findByText(FIXED)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("O que a conta olhou: regra sem dado suficiente diz o que falta, o número de hoje e que não é zero", async () => {
    renderPage(createDemoPort());
    const rules = await screen.findByRole("list", { name: "Regras e dados" }, { timeout: 3000 });
    expect(rules).toHaveTextContent(
      "Ainda não dá para saber se seus clientes estão voltando: preciso de pelo menos 5 clientes com 2 atendimentos. Hoje são 4. Isso não quer dizer zero.");
    // Regra quieta não ganha frase de insuficiente.
    expect(rules.textContent!.match(/Isso não quer dizer zero/g)).toHaveLength(1);
  });

  it("porta sem explain (a da Home): sem botão Por quê?", async () => {
    const port = createDemoPort();
    delete (port as { explain?: unknown }).explain;
    renderPage(port);
    await screen.findByRole("list", { name: "Sugestões abertas" }, { timeout: 3000 });
    await screen.findByRole("heading", { name: "Faltas concentradas na quarta" });
    expect(screen.queryByRole("button", { name: /^Por quê\?/ })).toBeNull();
  });
});

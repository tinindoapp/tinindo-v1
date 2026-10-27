import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { LifecyclePage } from "./LifecyclePage.tsx";

function setClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => resetDemoState());
afterEach(() => Reflect.deleteProperty(navigator, "clipboard"));

async function manualStep() {
  const port = createDemoPort();
  const markShared = vi.spyOn(port, "markShared");
  render(<LifecyclePage port={port} timezone="America/Sao_Paulo" />);
  const steps = await screen.findByRole("list", { name: "Passos" });
  const item = (await within(steps).findAllByText(/Confirmação do agendamento · Carlos/))[0]!.closest("li")!;
  return { markShared, item: within(item) };
}

describe("Relacionamento: copiar e marcar como compartilhado", () => {
  it("não marca quando a cópia falha", async () => {
    setClipboard(() => Promise.reject(new Error("negado")));
    const { markShared, item } = await manualStep();
    await act(async () => { fireEvent.click(item.getByRole("button", { name: "Copiar e marcar como compartilhado" })); });
    expect(markShared).not.toHaveBeenCalled();
    expect(item.getByRole("status")).toHaveTextContent("Não deu para copiar.");
  });

  it("marca só depois da cópia dar certo, sem dizer que foi entregue", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const { markShared, item } = await manualStep();
    await act(async () => { fireEvent.click(item.getByRole("button", { name: "Copiar e marcar como compartilhado" })); });
    expect(writeText).toHaveBeenCalled();
    expect(markShared).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Compartilhar não confirma entrega\./)).toBeInTheDocument();
  });

  it("WhatsApp sem telefone usa wa.me/?text= com o texto pronto", async () => {
    const { item } = await manualStep();
    const href = item.getByRole("link", { name: "Enviar pelo WhatsApp" }).getAttribute("href")!;
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(new URL(href).searchParams.get("text")).toContain("Seu horário de Barba está confirmado");
  });
});

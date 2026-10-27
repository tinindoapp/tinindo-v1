import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";
import { LifecyclePage } from "./LifecyclePage.tsx";

function setClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => resetDemoState());
afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  dismissToast();
});
const renderPage = (port: ReturnType<typeof createDemoPort>) =>
  render(
    <>
      <LifecyclePage port={port} timezone="America/Sao_Paulo" />
      <Toaster />
    </>,
  );

async function manualStep() {
  const port = createDemoPort();
  const markShared = vi.spyOn(port, "markShared");
  renderPage(port);
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

describe("Relacionamento: ações que não voltam atrás pedem confirmação", () => {
  it("Cancelar passo só cancela no “Sim, cancelar passo”", async () => {
    const port = createDemoPort();
    const cancelStep = vi.spyOn(port, "cancelStep");
    renderPage(port);
    const steps = await screen.findByRole("list", { name: "Passos" });
    const item = within((await within(steps).findAllByText(/Confirmação do agendamento · Carlos/))[0]!.closest("li")!);
    fireEvent.click(item.getByRole("button", { name: /^Cancelar Confirmação do agendamento/ }));
    expect(item.getByRole("group", { name: "Cancelar este passo?" })).toHaveTextContent(/não volta para a fila/);
    fireEvent.click(item.getByRole("button", { name: "Voltar" }));
    expect(cancelStep).not.toHaveBeenCalled();
    fireEvent.click(item.getByRole("button", { name: /^Cancelar Confirmação do agendamento/ }));
    fireEvent.click(item.getByRole("button", { name: "Sim, cancelar passo" }));
    await waitFor(() => expect(cancelStep).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Passo cancelado.")).toBeInTheDocument();
  });

  it("Revogar consentimento pede confirmação (sem desfazer) e só revoga no “Sim, revogar”", async () => {
    const port = createDemoPort();
    const carlos = DEMO_CUSTOMERS[1]!;
    await port.setConsent(carlos.id, "marketing", true, "consent-1");
    const setConsent = vi.spyOn(port, "setConsent");
    renderPage(port);
    fireEvent.click(await screen.findByRole("button", { name: `Revogar consentimento de ${carlos.name}` }));
    expect(screen.getByRole("group", { name: `Revogar o consentimento de ${carlos.name}?` })).toHaveTextContent(/novo consentimento/);
    expect(setConsent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim, revogar" }));
    await waitFor(() => expect(setConsent).toHaveBeenCalledWith(carlos.id, "marketing", false, expect.any(String)));
    expect(await screen.findByText(/fora da reativação/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeInTheDocument();
  });

  it("teto da campanha inválido aparece embaixo do campo, com foco nele", async () => {
    const port = createDemoPort();
    await port.setConsent(DEMO_CUSTOMERS[1]!.id, "marketing", true, "consent-2");
    const approve = vi.spyOn(port, "approveCampaign");
    renderPage(port);
    const field = await screen.findByLabelText("Teto de envios desta campanha");
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Aprovar campanha/ }));
    expect(await screen.findByText("Informe um teto de pelo menos 1 envio.")).toBeInTheDocument();
    await waitFor(() => expect(field).toHaveFocus());
    expect(approve).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, DEMO_BUSINESS_PHONE, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";
import { InboxPage } from "./InboxPage.tsx";

const ANA = DEMO_CUSTOMERS[0]!;

async function connectedWithAna() {
  const port = createDemoPort();
  await port.connect("simulated", DEMO_BUSINESS_PHONE, "c1");
  await port.dispatch!();
  const body = (await port.simPhone(DEMO_BUSINESS_PHONE)).messages[0]!.body;
  await port.verify(/([0-9]{6})/.exec(body)![1]!, "v1");
  await port.simInbound({ kind: "inbound", phone_e164: ANA.phone, text: "Oi" }, "e1");
  return port;
}

const page = (port: ReturnType<typeof createDemoPort>) =>
  render(
    <>
      <InboxPage port={port} timezone="America/Sao_Paulo" />
      <Toaster />
    </>,
  );

describe("caixa de entrada", () => {
  beforeEach(() => resetDemoState());
  afterEach(() => dismissToast());

  it("Desconectar pede confirmação com a consequência e só desconecta no “Sim”", async () => {
    const port = await connectedWithAna();
    const disconnect = vi.spyOn(port, "disconnect");
    page(port);
    fireEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    const confirm = screen.getByRole("group", { name: "Desconectar o número?" });
    expect(confirm).toHaveTextContent(`${DEMO_BUSINESS_PHONE} para de enviar e receber`);
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Voltar" }));
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desconectar" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Canal desconectado/)).toBeInTheDocument();
  });

  it("Desvincular do cadastro executa na hora e Desfazer vincula de novo ao mesmo cadastro", async () => {
    const port = await connectedWithAna();
    const link = vi.spyOn(port, "link");
    page(port);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir conversa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desvincular do cadastro" }));
    await waitFor(() => expect(link).toHaveBeenCalledTimes(1));
    const contactId = link.mock.calls[0]![0];
    expect(link.mock.calls[0]![1]).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(link).toHaveBeenCalledTimes(2));
    expect(link.mock.calls[1]!.slice(0, 2)).toEqual([contactId, ANA.id]);
    expect(await screen.findByText("Contato vinculado de novo ao cadastro.")).toBeInTheDocument();
  });

  it("Verificar fica ativo; código incompleto mostra o erro embaixo do campo e foca nele", async () => {
    const port = createDemoPort();
    await port.connect("simulated", DEMO_BUSINESS_PHONE, "c1");
    const verify = vi.spyOn(port, "verify");
    page(port);
    const button = await screen.findByRole("button", { name: "Verificar" });
    expect(button).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Código recebido no número"), { target: { value: "12" } });
    fireEvent.click(button);
    expect(await screen.findByText(/Informe os 6 números do código/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Código recebido no número")).toHaveFocus());
    expect(verify).not.toHaveBeenCalled();
  });
});

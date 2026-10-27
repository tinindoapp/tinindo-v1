import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, DEMO_BUSINESS_PHONE, DEMO_CUSTOMERS, resetDemoState } from "./demoPort.ts";
import { ConversationPage, InboxPage } from "./InboxPage.tsx";

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
    <MemoryRouter>
      <InboxPage port={port} timezone="America/Sao_Paulo" />
      <Toaster />
    </MemoryRouter>,
  );

const conversation = (port: ReturnType<typeof createDemoPort>, contactId: string) =>
  render(
    <MemoryRouter>
      <ConversationPage port={port} timezone="America/Sao_Paulo" contactId={contactId} />
      <Toaster />
    </MemoryRouter>,
  );

describe("caixa de entrada", () => {
  beforeEach(() => resetDemoState());
  afterEach(() => dismissToast());

  it("Desconectar pede confirmação com a consequência e só desconecta no “Sim”", async () => {
    const port = await connectedWithAna();
    const disconnect = vi.spyOn(port, "disconnect");
    page(port);
    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar" }));
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
    conversation(port, (await port.inbox()).contacts[0]!.id);
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

  it("conectado: a conexão é uma linha de status com Gerenciar, e as conversas vêm primeiro", async () => {
    const port = await connectedWithAna();
    await port.simInbound({ kind: "inbound", phone_e164: ANA.phone, text: "Tem horário?" }, "e2");
    await port.simInbound({ kind: "inbound", phone_e164: ANA.phone, text: "Quarta?" }, "e3");
    page(port);
    const line = await screen.findByRole("group", { name: "Número conectado" });
    expect(line).toHaveTextContent("Número simulado conectado · (11) 99999-0001");
    expect(screen.queryByRole("form", { name: "Conectar número" })).not.toBeInTheDocument();
    const manage = within(line).getByRole("button", { name: "Gerenciar" });
    expect(manage).toHaveAttribute("aria-expanded", "false");
    expect(within(line).queryByRole("button", { name: "Desconectar" })).not.toBeInTheDocument();
    fireEvent.click(manage);
    expect(manage).toHaveAttribute("aria-expanded", "true");
    expect(within(line).getByRole("button", { name: "Desconectar" })).toBeInTheDocument();
    // Linha inteira é o link da conversa, com o selo numérico.
    const row = await screen.findByRole("link", { name: /Ana Beatriz \(exemplo\)/ });
    const contactId = (await port.inbox()).contacts[0]!.id;
    expect(row).toHaveAttribute("href", `/${contactId}`);
    expect(within(row).getByText("3 não lidas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir conversa" })).not.toBeInTheDocument();
    expect(line.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sem conexão: estado vazio guiado com o passo e o botão de conectar", async () => {
    page(createDemoPort());
    expect(await screen.findByRole("heading", { name: "Conecte o número do seu negócio" })).toBeInTheDocument();
    expect(screen.getByText(/código de 6 números chega pelo próprio canal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Caixa de entrada" })).not.toBeInTheDocument();
  });

  it("conversa: responder fica no rodapé e o aviso de fila sai dentro dele", async () => {
    const port = await connectedWithAna();
    const contactId = (await port.inbox()).contacts[0]!.id;
    conversation(port, contactId);
    expect(await screen.findByRole("heading", { name: "Ana Beatriz (exemplo)", level: 1 })).toBeInTheDocument();
    const reply = screen.getByRole("form", { name: "Responder" });
    expect(reply).toHaveClass("tn-msg-composer");
    fireEvent.change(within(reply).getByLabelText("Resposta"), { target: { value: "Oi!" } });
    fireEvent.click(within(reply).getByRole("button", { name: "Enviar" }));
    expect(await within(reply).findByText(/Mensagem na fila\./)).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Mensagens da conversa" })).toHaveTextContent("Na fila");
    // Ao abrir, a conversa fica lida: a lista não mostra mais o selo.
    expect((await port.inbox()).contacts[0]!.unread_count).toBe(0);
  });
});

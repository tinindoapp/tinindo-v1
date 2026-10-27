import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { WaitlistPage, WaitlistPortProvider } from "./WaitlistPage.tsx";

function renderPage() {
  const port = createDemoPort();
  const withdraw = vi.spyOn(port, "withdraw");
  render(
    <WaitlistPortProvider value={port}>
      <WaitlistPage />
      <Toaster />
    </WaitlistPortProvider>,
  );
  return { withdraw };
}

afterEach(() => {
  resetDemoState();
  act(() => dismissToast());
});

describe("lista de espera", () => {
  it("tirar da lista pede confirmação com a consequência; Voltar não executa", async () => {
    const { withdraw } = renderPage();
    const entries = await screen.findByRole("region", { name: "Na lista" });
    fireEvent.click(within(entries).getByRole("button", { name: /^Tirar da lista Cliente Exemplo Ana/ }));
    expect(within(entries).getByText("Tirar Cliente Exemplo Ana da lista?")).toHaveFocus();
    expect(within(entries).getByText(/perde a vez na fila/)).toBeInTheDocument();
    fireEvent.click(within(entries).getByRole("button", { name: "Voltar" }));
    expect(withdraw).not.toHaveBeenCalled();
    expect(within(entries).getByRole("button", { name: /^Tirar da lista Cliente Exemplo Ana/ })).toHaveFocus();

    fireEvent.click(within(entries).getByRole("button", { name: /^Tirar da lista Cliente Exemplo Ana/ }));
    fireEvent.click(within(entries).getByRole("button", { name: "Sim, tirar" }));
    expect(await within(document.querySelector<HTMLElement>(".tn-toaster")!).findByText("Cliente saiu da lista.")).toBeInTheDocument();
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(await within(entries).findByText("Ninguém na lista.")).toBeInTheDocument();
  });

  it("adicionar sem preencher: cada erro embaixo do seu campo e foco no primeiro", async () => {
    renderPage();
    const form = await screen.findByRole("form", { name: "Adicionar à lista" });
    fireEvent.click(within(form).getByRole("button", { name: "Adicionar" }));
    expect(await within(form).findByText("Escolha o cliente.")).toBeInTheDocument();
    expect(within(form).getByText("Escolha pelo menos um dia.")).toBeInTheDocument();
    expect(within(form).getByText(/Só entra na lista quem autorizou/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Cliente")).toHaveFocus();
  });
});

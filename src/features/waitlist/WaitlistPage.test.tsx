import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { WaitlistPage, WaitlistPortProvider } from "./WaitlistPage.tsx";

function renderPage(vaga: string | null = null) {
  const port = createDemoPort();
  const withdraw = vi.spyOn(port, "withdraw");
  vi.spyOn(port, "prepareOffer");
  render(
    <WaitlistPortProvider value={port}>
      <WaitlistPage vaga={vaga} />
      <Toaster />
    </WaitlistPortProvider>,
  );
  return { withdraw, port };
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

  it("vaga pela URL com candidato: no topo, \"Vaga liberada agora\" e o foco em Preparar oferta", async () => {
    // Quarta 21/10 às 10:00 no fuso do negócio (a vaga liberada da demonstração).
    const { port } = renderPage("2026-10-21T10:00:00-03:00");
    const slots = await screen.findByRole("region", { name: "Vagas para oferecer" });
    const tag = await within(slots).findByText("Vaga liberada agora");
    const item = tag.closest(".tn-wl-target")!;
    expect(item).toHaveTextContent("Próximo da fila: Cliente Exemplo Ana");
    const button = within(item as HTMLElement).getByRole("button", { name: /^Preparar oferta/ });
    await waitFor(() => expect(button).toHaveFocus());
    // A mesma vaga não se repete embaixo.
    expect(within(slots).getAllByRole("button", { name: /^Preparar oferta/ })).toHaveLength(1);
    fireEvent.click(button);
    await waitFor(() => expect(port.prepareOffer).toHaveBeenCalledWith(expect.objectContaining({ customer_id: expect.any(String) }),
      { starts_at: "2026-10-21T13:00:00Z", ends_at: "2026-10-21T13:30:00Z" }, expect.any(String)));
    expect(await within(slots).findByText(/Oferta preparada para Cliente Exemplo Ana na vaga de quarta-feira, 21\/10, às 10:00/)).toBeInTheDocument();
  });

  it("vaga pela URL ainda sem candidato: quem da lista aceita aquele horário aparece em destaque", async () => {
    // Quarta às 11:00: a Ana aceita quartas das 09:00 às 19:00; a vaga dura o serviço dela (Corte, 30 min).
    const { port } = renderPage("2026-10-21T11:00:00-03:00");
    const slots = await screen.findByRole("region", { name: "Vagas para oferecer" });
    const item = (await within(slots).findByText("Vaga liberada agora")).closest(".tn-wl-target") as HTMLElement;
    expect(item).toHaveTextContent(/quarta-feira, 21\/10, 11:00–11:30/);
    await waitFor(() => expect(within(item).getByRole("button", { name: /^Preparar oferta/ })).toHaveFocus());
    // A vaga de exemplo das 10:00 continua na lista, embaixo.
    expect(within(slots).getByRole("list", { name: "Outras vagas" })).toHaveTextContent("10:00");
    fireEvent.click(within(item).getByRole("button", { name: /^Preparar oferta/ }));
    await waitFor(() => expect(port.prepareOffer).toHaveBeenCalledWith(expect.anything(),
      { starts_at: "2026-10-21T14:00:00.000Z", ends_at: "2026-10-21T14:30:00.000Z" }, expect.any(String)));
  });

  it("vaga pela URL que ninguém aceita: diz isso com o horário escrito", async () => {
    renderPage("2026-10-20T15:00:00-03:00");
    const slots = await screen.findByRole("region", { name: "Vagas para oferecer" });
    const none = await within(slots).findByText("Ninguém da lista aceita terça-feira, 20/10, às 15:00. A vaga continua livre na agenda.");
    await waitFor(() => expect(none).toHaveFocus());
    expect(within(slots).queryByText("Vaga liberada agora")).not.toBeInTheDocument();
  });

  it("sem vaga na URL a tela fica como antes", async () => {
    renderPage();
    const slots = await screen.findByRole("region", { name: "Vagas para oferecer" });
    expect(await within(slots).findByText(/Próximo da fila: Cliente Exemplo Ana/)).toBeInTheDocument();
    expect(within(slots).queryByText("Vaga liberada agora")).not.toBeInTheDocument();
    expect(within(slots).queryByText(/Ninguém da lista aceita/)).not.toBeInTheDocument();
  });
});

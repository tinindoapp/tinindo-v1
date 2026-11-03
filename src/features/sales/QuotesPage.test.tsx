import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { QuotesPage, SalesPortProvider, suggestTitle } from "./QuotesPage.tsx";

const page = (port: ReturnType<typeof createDemoPort>) =>
  render(
    <SalesPortProvider value={port}>
      <QuotesPage />
      <Toaster />
    </SalesPortProvider>,
  );

async function withQuote() {
  const port = createDemoPort();
  await port.create(
    {
      customer_id: FX.customers.abInA, title: "Corte e barba", valid_until: "2026-10-27T12:00:00Z", notes: null, slot: null,
      items: [{ service_id: FX.services.corteA, description: "Corte", quantity: 1, unit_price_cents: 6000 }],
    },
    "k-create",
  );
  return port;
}

describe("orçamentos", () => {
  beforeEach(() => resetDemoState());
  afterEach(() => dismissToast());

  it("Cancelar orçamento pede confirmação e só cancela no “Sim”", async () => {
    const port = await withQuote();
    const cancel = vi.spyOn(port, "cancel");
    page(port);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar orçamento “Corte e barba”" }));
    const confirm = screen.getByRole("group", { name: "Cancelar “Corte e barba”?" });
    expect(confirm).toHaveTextContent(/não pode mais ser aceito/);
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Voltar" }));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar orçamento “Corte e barba”" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Orçamento cancelado. O link deixou de funcionar.")).toBeInTheDocument();
  });

  it("Salvar fica ativo; no envio cada erro aparece embaixo do campo e o foco vai para o primeiro", async () => {
    const port = createDemoPort();
    const create = vi.spyOn(port, "create");
    page(port);
    fireEvent.click(await screen.findByRole("button", { name: "Novo orçamento" }));
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "12,345" } });
    const save = screen.getByRole("button", { name: "Salvar rascunho" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    // Todos os erros de uma vez, cada um embaixo do seu campo; o foco vai para o primeiro (a busca do cliente).
    expect(await screen.findByText("Escolha o cliente.")).toBeInTheDocument();
    expect(screen.getByText("Dê um título ao orçamento.")).toBeInTheDocument();
    expect(screen.getByText("Descreva o item.")).toBeInTheDocument();
    expect(screen.getByText(/Valor inválido/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Buscar cliente")).toHaveFocus());
    expect(create).not.toHaveBeenCalled();
  });

  it("recado #89: a busca acha o cliente pelo telefone; pouco dígito não filtra por telefone", async () => {
    page(createDemoPort());
    fireEvent.click(await screen.findByRole("button", { name: "Novo orçamento" }));
    const group = screen.getByRole("group", { name: "Escolha o cliente" });
    fireEvent.change(within(group).getByLabelText("Buscar cliente"), { target: { value: "(11) 98888-7777" } });
    expect(within(group).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["Cliente Exemplo Ana"]);
    fireEvent.change(within(group).getByLabelText("Buscar cliente"), { target: { value: "11" } });
    expect(group).toHaveTextContent("Ninguém com “11”");
  });

  it("recado #89: o link sai para o WhatsApp do cliente quando ele tem telefone", async () => {
    page(await withQuote());
    fireEvent.click(await screen.findByRole("button", { name: "Gerar link" }));
    const wa = await screen.findByRole("link", { name: "Enviar pelo WhatsApp" });
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
  });

  it("item 46: nenhum cliente vem escolhido; a busca filtra e o título acompanha os itens até a pessoa mudar", async () => {
    const port = createDemoPort();
    const create = vi.spyOn(port, "create");
    page(port);
    fireEvent.click(await screen.findByRole("button", { name: "Novo orçamento" }));
    const group = screen.getByRole("group", { name: "Escolha o cliente" });
    expect(within(group).getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    fireEvent.change(within(group).getByLabelText("Buscar cliente"), { target: { value: "bruno" } });
    expect(within(group).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["Cliente Exemplo Bruno"]);
    fireEvent.change(within(group).getByLabelText("Buscar cliente"), { target: { value: "zzz" } });
    expect(group).toHaveTextContent("Ninguém com “zzz”");
    fireEvent.change(within(group).getByLabelText("Buscar cliente"), { target: { value: "ana" } });
    fireEvent.click(within(group).getByRole("radio", { name: "Cliente Exemplo Ana" }));

    fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: FX.services.corteA } });
    expect(screen.getByLabelText("Título")).toHaveValue("Corte");
    expect(screen.getByText("Sugerido pelos itens. Você pode mudar.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar item" }));
    fireEvent.change(within(screen.getByRole("group", { name: "Item 2" })).getByLabelText("Descrição"), { target: { value: "Hidratação" } });
    fireEvent.change(within(screen.getByRole("group", { name: "Item 2" })).getByLabelText("Valor (R$)"), { target: { value: "30" } });
    expect(screen.getByLabelText("Título")).toHaveValue("Corte e Hidratação");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ customer_id: FX.customers.abInA, title: "Corte e Hidratação" });
  });

  it("título sugerido junta até três itens e resume o resto", () => {
    const d = (...n: string[]) => n.map((description) => ({ description }));
    expect(suggestTitle(d(""))).toBe("");
    expect(suggestTitle(d("Corte", "Corte"))).toBe("Corte");
    expect(suggestTitle(d("Corte", "Barba", "Sobrancelha"))).toBe("Corte, Barba e Sobrancelha");
    expect(suggestTitle(d("A", "B", "C", "D"))).toBe("A, B e mais 2 itens");
  });
});

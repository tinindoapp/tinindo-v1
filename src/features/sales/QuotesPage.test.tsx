import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { QuotesPage, SalesPortProvider } from "./QuotesPage.tsx";

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
    expect(await screen.findByText("Dê um título ao orçamento.")).toBeInTheDocument();
    expect(screen.getByText("Descreva o item.")).toBeInTheDocument();
    expect(screen.getByText(/Valor inválido/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Título")).toHaveFocus());
    expect(create).not.toHaveBeenCalled();
  });
});

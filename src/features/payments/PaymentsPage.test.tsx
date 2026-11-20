import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { PaymentsPage } from "./PaymentsPage.tsx";
import { newIdempotencyKey as newKey } from "../../lib/idempotency.ts";

beforeEach(() => resetDemoState());
afterEach(() => act(() => dismissToast()));

describe("Pagamentos: cancelar cobrança pede confirmação", () => {
  it("sem confirmar, a cobrança continua; confirmado, cancela e avisa no Toast", async () => {
    const port = createDemoPort();
    const [receivable] = await port.openReceivables();
    await port.createCharge(receivable!.id, "simulated", newKey());
    const cancel = vi.spyOn(port, "cancelCharge");
    render(<MemoryRouter><PaymentsPage port={port} timezone="America/Sao_Paulo" /><Toaster /></MemoryRouter>);
    const list = within(await screen.findByRole("region", { name: "Cobranças" }));
    fireEvent.click(await list.findByRole("button", { name: /Cancelar cobrança de/ }));
    const confirm = list.getByRole("group", { name: "Cancelar cobrança?" });
    expect(confirm).toHaveTextContent("param de funcionar para a cliente");
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Sim, cancelar" })); });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((await screen.findByText(/Cobrança cancelada\./)).closest(".tn-toaster")).not.toBeNull();
    expect(await list.findByText("Cancelada")).toBeInTheDocument();
  });

  it("Gerar cobrança falhou: tocar de novo manda a mesma chave (o servidor não cria duas cobranças)", async () => {
    const port = createDemoPort();
    const create = vi.spyOn(port, "createCharge").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    render(<MemoryRouter><PaymentsPage port={port} timezone="America/Sao_Paulo" /><Toaster /></MemoryRouter>);
    const form = within(await screen.findByRole("form", { name: "Cobrar por Pix" }));
    await act(async () => { fireEvent.click(await form.findByRole("button", { name: "Gerar cobrança Pix" })); });
    expect(await form.findByText(/O banco não respondeu ou o Pix de verdade/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Gerar cobrança Pix" })); });
    expect(await screen.findByText(/Cobrança de .* criada\./)).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![2]).toBe(create.mock.calls[0]![2]);
  });
});

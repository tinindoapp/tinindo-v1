import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { PaymentsPage } from "./PaymentsPage.tsx";
import { newKey } from "./port.ts";

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
});

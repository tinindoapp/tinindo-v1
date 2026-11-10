import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { MaterialsPage } from "./MaterialsPage.tsx";

beforeEach(() => resetDemoState());
afterEach(() => act(() => dismissToast()));

describe("Materiais: nova tentativa depois de falha de rede não lança a compra em dobro", () => {
  it("o formulário fica como está e a segunda tentativa sai com a mesma chave e o mesmo pedido", async () => {
    const port = createDemoPort();
    const purchase = vi.spyOn(port, "purchase").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    render(<><MaterialsPage port={port} /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Nova compra" }));
    const form = within(screen.getByRole("form", { name: "Nova compra" }));
    fireEvent.change(form.getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.change(form.getByLabelText("Valor pago (R$)"), { target: { value: "80,00" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: /^Registrar compra/ })); });
    expect(purchase).toHaveBeenCalledTimes(1);
    // Depois do erro o que foi digitado continua na tela.
    expect(form.getByLabelText("Quantidade")).toHaveValue("2");
    expect(form.getByLabelText("Valor pago (R$)")).toHaveValue("80,00");
    await act(async () => { fireEvent.click(form.getByRole("button", { name: /^Registrar compra/ })); });
    expect(purchase).toHaveBeenCalledTimes(2);
    expect(purchase.mock.calls[1]).toEqual(purchase.mock.calls[0]);
    expect(await screen.findByText(/lançada no estoque/)).toBeInTheDocument();
  });
});

describe("Materiais: o valor pago vale o mesmo que no Caixa", () => {
  it("\"10.50\" é R$ 10,50 e \"R$ 60,00\" é R$ 60,00", async () => {
    const port = createDemoPort();
    const purchase = vi.spyOn(port, "purchase");
    render(<><MaterialsPage port={port} /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Nova compra" }));
    const form = within(screen.getByRole("form", { name: "Nova compra" }));
    fireEvent.change(form.getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.change(form.getByLabelText("Valor pago (R$)"), { target: { value: "10.50" } });
    expect(form.getByRole("button", { name: /^Registrar compra/ })).toHaveTextContent(/R\$\s10,50/);
    fireEvent.change(form.getByLabelText("Valor pago (R$)"), { target: { value: "R$ 60,00" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: /^Registrar compra/ })); });
    expect(purchase).toHaveBeenCalledTimes(1);
    expect(purchase.mock.calls[0]![2][0]!.total_cents).toBe(6000);
  });

  it("vazio pede o valor e não lança a compra", async () => {
    const port = createDemoPort();
    const purchase = vi.spyOn(port, "purchase");
    render(<><MaterialsPage port={port} /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Nova compra" }));
    const form = within(screen.getByRole("form", { name: "Nova compra" }));
    fireEvent.change(form.getByLabelText("Quantidade"), { target: { value: "2" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: /^Registrar compra/ })); });
    expect(purchase).not.toHaveBeenCalled();
    expect(form.getByText("Informe o valor pago.")).toBeInTheDocument();
  });
});

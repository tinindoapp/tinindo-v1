import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { AccountsPage } from "./AccountsPage.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";

beforeEach(() => resetDemoState());
afterEach(() => act(() => dismissToast()));

describe("Contas: nova tentativa depois de falha de rede não cria a conta em dobro", () => {
  it("conta mensal: a segunda tentativa sai com a mesma chave e o mesmo pedido", async () => {
    const port = createDemoPort();
    const save = vi.spyOn(port, "savePayable").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    render(<><AccountsPage port={port} /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Nova conta" }));
    const form = within(screen.getByRole("form", { name: "Nova conta a pagar" }));
    fireEvent.change(form.getByLabelText("O que é"), { target: { value: "Aluguel do salão" } });
    fireEvent.change(form.getByLabelText("Valor (R$)"), { target: { value: "1.200,00" } });
    fireEvent.click(form.getByRole("checkbox", { name: /Repetir todo mês/ }));
    const submit = form.getByRole("button", { name: "Criar conta" });
    await act(async () => { fireEvent.click(submit); });
    await act(async () => { fireEvent.click(submit); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toBe(save.mock.calls[0]![1]);
    expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0]);
  });
});

describe("Contas: o valor digitado vale o mesmo que no Caixa", () => {
  async function openForm() {
    const port = createDemoPort();
    const save = vi.spyOn(port, "savePayable");
    render(<><AccountsPage port={port} /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Nova conta" }));
    const form = within(screen.getByRole("form", { name: "Nova conta a pagar" }));
    fireEvent.change(form.getByLabelText("O que é"), { target: { value: "Luz" } });
    return { form, save };
  }

  it("\"10.50\" é R$ 10,50, não R$ 1.050,00", async () => {
    const { form, save } = await openForm();
    fireEvent.change(form.getByLabelText("Valor (R$)"), { target: { value: "10.50" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Criar conta" })); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].amount_cents).toBe(1050);
  });

  it("texto que não é valor fica no campo com o aviso, sem criar conta", async () => {
    const { form, save } = await openForm();
    fireEvent.change(form.getByLabelText("Valor (R$)"), { target: { value: "R$ 60 reais" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Criar conta" })); });
    expect(save).not.toHaveBeenCalled();
    expect(form.getByText("Use só números, por exemplo 150,00.")).toBeInTheDocument();
  });
});

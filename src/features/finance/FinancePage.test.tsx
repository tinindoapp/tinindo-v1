import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import { FinancePage, FinancePortProvider } from "./FinancePage.tsx";

afterEach(() => act(() => dismissToast()));

function renderPage() {
  const port = createDemoPort();
  render(
    <MemoryRouter>
      <FinancePortProvider value={port}>
        <FinancePage />
      </FinancePortProvider>
      <Toaster />
    </MemoryRouter>,
  );
  return port;
}

describe("Caixa: validação no envio, confirmação e aviso", () => {
  it("cobrança sem descrição e valor: erros embaixo de cada campo e foco no primeiro", async () => {
    const port = renderPage();
    const create = vi.spyOn(port, "createReceivable");
    const form = within(await screen.findByRole("form", { name: "Nova cobrança" }));
    const submit = form.getByRole("button", { name: "Criar cobrança" });
    expect(submit).toBeEnabled();
    await act(async () => { fireEvent.click(submit); });
    expect(form.getByText("Descreva a cobrança.")).toBeInTheDocument();
    expect(form.getByText("Informe o valor.")).toBeInTheDocument();
    expect(form.getByLabelText("Descrição")).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it("estorno não acontece sem confirmar; confirmado, o aviso aparece no Toast", async () => {
    const port = renderPage();
    const reverse = vi.spyOn(port, "reversePayment");
    const payments = within(await screen.findByRole("region", { name: "Recebimentos no mês" }));
    fireEvent.click(payments.getAllByRole("button", { name: /^Estornar recebimento/ })[0]!);
    const confirm = payments.getByRole("group", { name: /Estornar recebimento de .*\?/ });
    expect(confirm).toHaveTextContent("O registro original continua no histórico.");
    // Sem motivo, o botão explica e não estorna.
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Sim, estornar" })); });
    expect(reverse).not.toHaveBeenCalled();
    expect(confirm).toHaveTextContent("Preencha o que falta acima para confirmar.");
    fireEvent.change(within(confirm).getByLabelText("Motivo do estorno"), { target: { value: "Pago em dobro" } });
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Sim, estornar" })); });
    expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ reason: "Pago em dobro" }), expect.any(String));
    expect((await screen.findByText(/estornado\. O registro original continua no histórico\./)).closest(".tn-toaster")).not.toBeNull();
  });
});

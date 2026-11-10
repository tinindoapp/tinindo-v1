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

/** Relógio que anda a cada leitura, como no servidor: na demonstração ele é fixo e esconde o defeito. */
function tickingClock(port: ReturnType<typeof createDemoPort>) {
  const start = port.now().getTime();
  let ticks = 0;
  vi.spyOn(port, "now").mockImplementation(() => new Date(start + (ticks += 1) * 1000));
}

describe("Caixa: nova tentativa depois de falha de rede não grava em dobro", () => {
  it("recebimento de hoje: a segunda tentativa sai com a mesma chave e o mesmo corpo", async () => {
    const port = renderPage();
    tickingClock(port);
    const pay = vi.spyOn(port, "recordPayment").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    const open = within(await screen.findByRole("region", { name: "A receber" }));
    fireEvent.click(open.getAllByRole("button", { name: /^Registrar recebimento/ })[0]!);
    const submit = open.getByRole("button", { name: "Registrar pagamento" });
    await act(async () => { fireEvent.click(submit); });
    expect(open.getByText(/Tentar de novo é seguro/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(submit); });
    expect(pay).toHaveBeenCalledTimes(2);
    const [firstBody, firstKey] = pay.mock.calls[0]!;
    const [secondBody, secondKey] = pay.mock.calls[1]!;
    expect(secondKey).toBe(firstKey);
    expect(secondBody).toEqual(firstBody);
  });

  it("despesa de hoje: a segunda tentativa sai com a mesma chave e o mesmo corpo", async () => {
    const port = renderPage();
    tickingClock(port);
    const expense = vi.spyOn(port, "recordExpense").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    const form = within(await screen.findByRole("form", { name: "Nova despesa" }));
    fireEvent.change(form.getByLabelText("Valor da despesa (R$)"), { target: { value: "45,00" } });
    const submit = form.getByRole("button", { name: "Registrar despesa" });
    await act(async () => { fireEvent.click(submit); });
    expect(form.getByText(/Tentar de novo é seguro/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(submit); });
    expect(expense).toHaveBeenCalledTimes(2);
    expect(expense.mock.calls[1]![1]).toBe(expense.mock.calls[0]![1]);
    expect(expense.mock.calls[1]![0]).toEqual(expense.mock.calls[0]![0]);
  });

  it("valor diferente é outro pedido: chave nova", async () => {
    const port = renderPage();
    tickingClock(port);
    const pay = vi.spyOn(port, "recordPayment").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    const open = within(await screen.findByRole("region", { name: "A receber" }));
    fireEvent.click(open.getAllByRole("button", { name: /^Registrar recebimento/ })[0]!);
    const submit = open.getByRole("button", { name: "Registrar pagamento" });
    await act(async () => { fireEvent.click(submit); });
    fireEvent.change(open.getByLabelText("Valor recebido (R$)"), { target: { value: "1,00" } });
    await act(async () => { fireEvent.click(submit); });
    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[1]![1]).not.toBe(pay.mock.calls[0]![1]);
  });
});

describe("Caixa: validação no envio, confirmação e aviso", () => {
  it("cobrança sem descrição e valor: erros embaixo de cada campo e foco no primeiro", async () => {
    const port = renderPage();
    const create = vi.spyOn(port, "createReceivable");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Cobrança avulsa" }));
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
    expect(confirm).toHaveTextContent("Escreva o motivo do estorno.");
    fireEvent.change(within(confirm).getByLabelText("Motivo do estorno"), { target: { value: "Pago em dobro" } });
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Sim, estornar" })); });
    expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ reason: "Pago em dobro" }), expect.any(String));
    expect((await screen.findByText(/estornado\. O registro original continua no histórico\./)).closest(".tn-toaster")).not.toBeNull();
  });

  it("formulários fechados até tocar em Registrar; abre no lugar com foco no primeiro campo", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    expect(screen.queryByRole("form")).toBeNull();
    const open = screen.getByRole("button", { name: "Registrar" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Valor da despesa (R$)")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("atalho “Recebi R$ 40,00 no Pix ▾”: troca a forma e registra cobrança e recebimento num toque", async () => {
    const port = renderPage();
    const pay = vi.spyOn(port, "recordPayment");
    const pending = within(await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" }));
    const bruno = within(pending.getAllByRole("listitem").find((li) => li.textContent?.includes("Bruno"))!);
    expect(bruno.getByRole("button", { name: /^Recebi R\$\s?40,00 no Pix/ })).toBeInTheDocument();
    fireEvent.click(bruno.getByRole("button", { name: /Outra forma de pagamento/ }));
    fireEvent.click(bruno.getByRole("radio", { name: "Cartão" }));
    await act(async () => { fireEvent.click(bruno.getByRole("button", { name: /^Recebi R\$\s?40,00 no cartão/ })); });
    expect(pay).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 4000, method: "card" }), expect.any(String));
    expect(await screen.findByText(/Recebido R\$\s?40,00 \(Cartão\)/)).toBeInTheDocument();
  });
});

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

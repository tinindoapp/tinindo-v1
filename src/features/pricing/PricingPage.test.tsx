import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import { PricingPage, PricingPortProvider } from "./PricingPage.tsx";

function renderPage() {
  const port = createDemoPort();
  const deactivate = vi.spyOn(port, "deactivate");
  render(
    <PricingPortProvider value={port}>
      <PricingPage />
      <Toaster />
    </PricingPortProvider>,
  );
  return { deactivate };
}

afterEach(() => act(() => dismissToast()));

describe("preços", () => {
  it("lista cortada no servidor avisa embaixo das regras (P56, recado #169)", async () => {
    const port = createDemoPort();
    const list = port.list.bind(port);
    vi.spyOn(port, "list").mockImplementation(async () => ({ ...(await list()), truncated: { rules: true, proposals: false } }));
    render(
      <PricingPortProvider value={port}>
        <PricingPage />
      </PricingPortProvider>,
    );
    const active = await screen.findByRole("region", { name: "Regras ativas" });
    expect(within(active).getByText("Mostrando as 100 regras mais recentes.")).toBeInTheDocument();
    expect(screen.queryByText("Mostrando as 20 prévias mais recentes.")).not.toBeInTheDocument();
  });

  it("desativar regra pede confirmação; Voltar não desativa e Sim desativa com aviso curto", async () => {
    const { deactivate } = renderPage();
    const active = await screen.findByRole("region", { name: "Regras ativas" });
    fireEvent.click(await within(active).findByRole("button", { name: /^Desativar regra de/ }));
    expect(within(active).getByText(/^Desativar a regra de /)).toHaveFocus();
    expect(within(active).getByText(/voltam ao preço base/)).toBeInTheDocument();
    fireEvent.click(within(active).getByRole("button", { name: "Voltar" }));
    expect(deactivate).not.toHaveBeenCalled();

    fireEvent.click(within(active).getByRole("button", { name: /^Desativar regra de/ }));
    fireEvent.click(within(active).getByRole("button", { name: "Sim, desativar" }));
    expect(await within(document.querySelector<HTMLElement>(".tn-toaster")!).findByText(/^Regra de .* desativada/)).toBeInTheDocument();
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(await within(active).findByText(/Nenhuma regra ativa/)).toBeInTheDocument();
  });

  it("nova regra com percentual inválido: erro embaixo do campo e foco nele", async () => {
    renderPage();
    // P54: o formulário só aparece pela ação principal da abertura.
    expect(screen.queryByRole("form", { name: "Nova regra" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Nova regra" }));
    const form = await screen.findByRole("form", { name: "Nova regra" });
    fireEvent.change(within(form).getByLabelText("Desconto máximo (%)"), { target: { value: "150" } });
    fireEvent.click(within(form).getByRole("button", { name: "Ver prévia" }));
    expect(await within(form).findByText("Use um percentual entre 0 e 100.")).toBeInTheDocument();
    expect(within(form).getByLabelText("Desconto máximo (%)")).toHaveFocus();
    expect(screen.queryByRole("list", { name: "Propostas aguardando aprovação" })).not.toBeInTheDocument();
  });

  it("P54: regras ativas primeiro; simulador recolhido mostra o valor final em destaque; prévia vai para a aprovação", async () => {
    renderPage();
    const active = await screen.findByRole("region", { name: "Regras ativas" });
    const sim = screen.getByText("Simular um desconto").closest("details")!;
    expect(active.compareDocumentPosition(sim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sim).not.toHaveAttribute("open");
    const result = within(sim).getByRole("group", { name: "Resultado da simulação" });
    expect(within(result).getByText("Valor final")).toBeInTheDocument();
    expect(result).toHaveTextContent(/R\$\s51,00/);
    expect(screen.queryByText(/Dados de exemplo/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nova regra" }));
    const form = await screen.findByRole("form", { name: "Nova regra" });
    fireEvent.click(within(form).getByRole("button", { name: "Ver prévia" }));
    const proposals = await screen.findByRole("list", { name: "Propostas aguardando aprovação" });
    expect(proposals).toHaveTextContent("Prévia · Corte");
    expect(screen.queryByRole("form", { name: "Nova regra" })).not.toBeInTheDocument();
  });
});

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
  it("desativar regra pede confirmação; Voltar não desativa e Sim desativa com aviso curto", async () => {
    const { deactivate } = renderPage();
    const active = await screen.findByRole("region", { name: "Regras ativas" });
    fireEvent.click(await within(active).findByRole("button", { name: /^Desativar regra de/ }));
    expect(within(active).getByText(/^Desativar a regra v3 de/)).toHaveFocus();
    expect(within(active).getByText(/voltam ao preço base/)).toBeInTheDocument();
    fireEvent.click(within(active).getByRole("button", { name: "Voltar" }));
    expect(deactivate).not.toHaveBeenCalled();

    fireEvent.click(within(active).getByRole("button", { name: /^Desativar regra de/ }));
    fireEvent.click(within(active).getByRole("button", { name: "Sim, desativar" }));
    expect(await within(document.querySelector<HTMLElement>(".tn-toaster")!).findByText(/Regra v3 desativada/)).toBeInTheDocument();
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(await within(active).findByText(/Nenhuma regra ativa/)).toBeInTheDocument();
  });

  it("nova regra com percentual inválido: erro embaixo do campo e foco nele", async () => {
    renderPage();
    const form = await screen.findByRole("form", { name: "Nova regra" });
    fireEvent.change(within(form).getByLabelText("Teto aprovado (%)"), { target: { value: "150" } });
    fireEvent.click(within(form).getByRole("button", { name: "Ver prévia" }));
    expect(await within(form).findByText("Use um percentual entre 0 e 100.")).toBeInTheDocument();
    expect(within(form).getByLabelText("Teto aprovado (%)")).toHaveFocus();
    expect(screen.queryByRole("list", { name: "Propostas aguardando aprovação" })).not.toBeInTheDocument();
  });
});

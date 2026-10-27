// Plano e serviços (dono): validação no envio, confirmação ao revogar e ao cancelar, retorno em toast (auditoria de UX).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoOpsPort, createDemoPort, DEMO_OPERATOR, resetDemoState } from "./demoPort.ts";
import { ServiceOpsPortProvider, ServicesPage } from "./ServicesPage.tsx";

beforeEach(() => resetDemoState());
afterEach(() => dismissToast());

function renderPage(port = createDemoPort()) {
  render(
    <ServiceOpsPortProvider value={port}>
      <ServicesPage />
      <Toaster />
    </ServiceOpsPortProvider>,
  );
  return port;
}

describe("Plano e serviços (dono)", () => {
  it("Pedir este serviço sempre ativo: sem aceitar o escopo mostra o erro, foca a caixa e não pede", async () => {
    const port = renderPage();
    const request = vi.spyOn(port, "request");
    const form = await screen.findByRole("form", { name: /^Pedir / });
    const button = within(form).getByRole("button", { name: "Pedir este serviço" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await within(form).findByText(/Marque que leu e aceita o escopo/)).toBeInTheDocument();
    await waitFor(() => expect(within(form).getByRole("checkbox", { name: /Li e aceito este escopo/ })).toHaveFocus());
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("checkbox", { name: /Li e aceito este escopo/ }));
    fireEvent.click(button);
    expect(await screen.findByText(/registrado com o escopo da versão/)).toBeInTheDocument();
  });

  it("revogar acesso e cancelar pedido só executam depois de confirmar", async () => {
    const port = createDemoPort();
    const ops = createDemoOpsPort();
    const svc = (await port.plan()).catalog.find((c) => c.kind === "service")!;
    await port.request(svc, null, "r1");
    await ops.assign((await ops.queue()).orders[0]!, DEMO_OPERATOR.user_id, "a1");
    const order = (await port.orders())[0]!;
    await port.grant(order, ["catalog"], new Date(port.now().getTime() + 86_400_000).toISOString(), "Cadastrar serviços", "g1");
    const revoke = vi.spyOn(port, "revoke");
    const cancel = vi.spyOn(port, "cancel");
    renderPage(port);

    fireEvent.click(await screen.findByRole("button", { name: `Revogar acesso de ${DEMO_OPERATOR.display_name}` }));
    expect(screen.getByText(`Revogar o acesso de ${DEMO_OPERATOR.display_name}?`)).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim, revogar" }));
    expect(await screen.findByText("Acesso revogado.")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole("button", { name: `Cancelar pedido de ${svc.name}` }));
    expect(screen.getByText(/Para retomar, será preciso fazer um pedido novo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manter pedido" }));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Cancelar pedido de ${svc.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar pedido" }));
    expect(await screen.findByText("Pedido cancelado. Acessos encerrados.")).toBeInTheDocument();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

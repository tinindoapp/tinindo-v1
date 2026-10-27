// Site e Google: toast, Desfazer ao tirar do ar, confirmação ao revogar e validação no envio (auditoria de UX).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { PresencePage } from "./PresencePage.tsx";

const k = () => crypto.randomUUID();
beforeEach(() => resetDemoState());
afterEach(() => dismissToast());

function renderPage(port = createDemoPort()) {
  render(
    <MemoryRouter>
      <PresencePage port={port} />
      <Toaster />
    </MemoryRouter>,
  );
  return port;
}

describe("Site e Google (dono)", () => {
  it("Tirar do ar executa na hora e o Desfazer põe a mesma versão no ar de novo", async () => {
    const port = createDemoPort();
    const o = await port.saveSite({ expected_version: 0, headline: "Corte", sections: ["services"], service_ids: [FX.services.corteA] }, k());
    await port.publish(o.preview_hash!, k());
    const restore = vi.spyOn(port, "restore");
    renderPage(port);
    fireEvent.click(await screen.findByRole("button", { name: "Tirar do ar" }));
    expect(await screen.findByText(/Site fora do ar\. Você pode pôr/)).toBeInTheDocument();
    expect(await screen.findByText("Fora do ar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(1, expect.any(Number), expect.any(String)));
    expect(await screen.findByText("Versão 1 no ar de novo, como foi aprovada.")).toBeInTheDocument();
    expect(screen.getByText(/No ar · versão/)).toBeInTheDocument();
  });

  it("Google: Registrar sempre ativo, erros embaixo dos campos com foco no primeiro; revogar só depois de confirmar", async () => {
    const port = renderPage();
    const setGoogle = vi.spyOn(port, "setGoogle");
    const form = await screen.findByRole("form", { name: "Conceder acesso ao Google" });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar acesso" }));
    expect(await within(form).findByText("Informe o nome do perfil no Google.")).toBeInTheDocument();
    expect(within(form).getByText("Confirme que adicionou a Tinindo como gerente.")).toBeInTheDocument();
    await waitFor(() => expect(within(form).getByLabelText("Nome do perfil no Google")).toHaveFocus());
    expect(setGoogle).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText("Nome do perfil no Google"), { target: { value: "Barbearia Exemplo A" } });
    fireEvent.click(within(form).getByLabelText(/Adicionei a Tinindo como gerente/));
    fireEvent.click(within(form).getByRole("button", { name: "Registrar acesso" }));
    expect(await screen.findByText(/Acesso registrado/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Revogar acesso" }));
    expect(screen.getByText("Revogar o acesso da Tinindo?")).toBeInTheDocument();
    expect(setGoogle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sim, revogar" }));
    expect(await screen.findByText(/Acesso revogado\. Remova também/)).toBeInTheDocument();
    expect(setGoogle).toHaveBeenLastCalledWith(expect.objectContaining({ action: "revoke" }), expect.any(String));
  });
});

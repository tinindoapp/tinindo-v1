// Tela do dono no Diretório: validação no envio e "Desfazer" ao sair do diretório (auditoria de UX, itens 5, 6 e 12).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { DiscoverySettingsPage } from "./DirectoryPages.tsx";

beforeEach(() => resetDemoState());
afterEach(() => dismissToast());

function renderPage() {
  const port = createDemoPort();
  const save = vi.spyOn(port, "save");
  render(
    <MemoryRouter>
      <DiscoverySettingsPage port={port} />
      <Toaster />
    </MemoryRouter>,
  );
  return { save };
}

describe("Diretório (dono)", () => {
  it("Salvar sempre ativo: sem cidade mostra o erro embaixo do campo, foca e não salva", async () => {
    const { save } = renderPage();
    const button = await screen.findByRole("button", { name: "Salvar" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByText("Informe a cidade.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Cidade")).toHaveFocus());
    expect(save).not.toHaveBeenCalled();
  });

  it("sair do diretório executa na hora e o Desfazer salva de novo como estava", async () => {
    const { save } = renderPage();
    fireEvent.change(await screen.findByLabelText("Cidade"), { target: { value: "São Paulo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Pronto: seu negócio aparece no diretório.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Quero aparecer no diretório"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Salvo. Seu negócio não aparece no diretório.")).toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ listed: false }), expect.any(String));

    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(await screen.findByText("Seu negócio voltou ao diretório.")).toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ listed: true, city_name: "São Paulo" }), expect.any(String));
    expect(screen.getByLabelText("Quero aparecer no diretório")).toBeChecked();
  });
});

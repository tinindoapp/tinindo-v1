// Tela do dono no Diretório: validação no envio e "Desfazer" ao sair do diretório (auditoria de UX, itens 5, 6 e 12).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoDirectoryPort, createDemoPort, resetDemoState } from "./demoPort.ts";
import { cardDetails, DiscoverySettingsPage, PublicDirectoryPage } from "./DirectoryPages.tsx";
import type { DirectoryCard } from "./port.ts";

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

const card: DirectoryCard = {
  slug: "barbearia-a", display_name: "Barbearia Exemplo A", category: "barber", area: "Centro", city_name: "São Paulo",
  city_slug: "sao-paulo", uf: "SP", profile_path: "/p/barbearia-a", site_path: null, booking: true, weekdays: null,
};

describe("Diretório público (E11)", () => {
  it("cartão sem repetir o título: sai a cidade na busca e a profissão quando filtrada", () => {
    expect(cardDetails(card)).toBe("Barbearia · Centro · São Paulo/SP");
    expect(cardDetails(card, { city: true })).toBe("Barbearia · Centro");
    expect(cardDetails(card, { city: true, category: true })).toBe("Centro");
    // Sem nome público, profissão e bairro já são o nome do cartão.
    expect(cardDetails({ ...card, display_name: null }, { city: true })).toBe("");
  });

  it("usa a moldura pública com a marca, plural sem (s) e Ver horários como botão que leva à reserva", async () => {
    await createDemoPort().save({ expected_version: 0, uf: "SP", city_name: "São Paulo", show_hours: false, listed: true }, crypto.randomUUID());
    const port = createDemoDirectoryPort();
    const { unmount } = render(
      <MemoryRouter initialEntries={["/diretorio"]}>
        <Routes><Route path="/diretorio" element={<PublicDirectoryPage port={port} />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("img", { name: "Tinindo" })).toBeInTheDocument();
    const cities = await screen.findByRole("list", { name: "Cidades" });
    await waitFor(() => expect(cities).toHaveTextContent(/\d+ profissionai?s?\b/));
    expect(cities).not.toHaveTextContent("(is)");
    unmount();

    render(
      <MemoryRouter initialEntries={["/diretorio/sp/sao-paulo/barber"]}>
        <Routes><Route path="/diretorio/:uf/:cidade/:categoria" element={<PublicDirectoryPage port={port} />} /></Routes>
      </MemoryRouter>,
    );
    const results = await screen.findByRole("list", { name: "Resultados" });
    expect(await screen.findByText(/^\d+ profissionai?s? · /)).toBeInTheDocument();
    const first = (await within(results).findAllByRole("listitem"))[0]!;
    expect(first).not.toHaveTextContent("São Paulo/SP");
    const book = within(results).getAllByRole("link", { name: "Ver horários" })[0]!;
    expect(book).toHaveClass("tn-button");
    expect(book.getAttribute("href")).toMatch(/^\/p\/[a-z0-9-]+#agendar$/);
  });
});

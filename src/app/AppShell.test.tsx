import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { MODULES } from "./modules.ts";
import { routes } from "./router.tsx";
import { SessionProvider } from "./session.tsx";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <SessionProvider client={null}>
      <RouterProvider router={router} />
    </SessionProvider>,
  );
}

describe("shell do app (demonstração sem servidor)", () => {
  it("mostra banner de demonstração, negócio de exemplo e início", async () => {
    renderAt("/app");
    expect(await screen.findByRole("heading", { name: "Seu negócio em ordem" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Demonstração");
    expect(screen.getByText("Barbearia Exemplo A")).toBeInTheDocument();
  });

  it("navegação lista um item por módulo registrado", async () => {
    renderAt("/app");
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    for (const m of MODULES) expect(nav).toHaveTextContent(m.navLabel);
  });

  it("rota de módulo mostra o pacote responsável sem simular dados", async () => {
    renderAt("/app/agenda");
    expect(await screen.findByRole("heading", { name: "Agenda" })).toBeInTheDocument();
    expect(screen.getByText("Pacote P04")).toBeInTheDocument();
    expect(screen.getByText(/ainda não guarda nem altera dados/)).toBeInTheDocument();
  });

  it("raiz redireciona para /app e rota desconhecida dá 404 amigável", async () => {
    renderAt("/qualquer-coisa");
    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeInTheDocument();
  });

  it("caminhos de módulo são únicos", () => {
    const paths = MODULES.map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

// P53 (R8): o erro de uma tela fica no lugar dela, dentro do shell. O menu e a navegação continuam.
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isChunkLoadError, ModuleError } from "./ModuleError.tsx";

function Shell() {
  return (
    <div>
      <nav aria-label="Principal">
        <Link to="/app">Hoje</Link>
      </nav>
      <Outlet />
    </div>
  );
}
function Boom(): never {
  throw new Error("falha de teste");
}

function renderAt(route: { Component?: () => never; lazy?: () => Promise<never> }) {
  const router = createMemoryRouter(
    [
      {
        path: "/app",
        element: <Shell />,
        children: [
          { index: true, element: <p>Hoje</p> },
          { path: "caixa", errorElement: <ModuleError module={{ navLabel: "Caixa" }} />, children: [{ index: true, ...route }] },
        ],
      },
    ],
    { initialEntries: ["/app/caixa"] },
  );
  render(<RouterProvider router={router} />);
}

afterEach(() => vi.restoreAllMocks());

describe("fronteira de erro por módulo", () => {
  it("exceção na tela: aviso no lugar da tela, com o menu do shell", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderAt({ Component: Boom });
    expect(await screen.findByRole("heading", { name: "Não foi possível abrir Caixa" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar para Hoje" })).toHaveAttribute("href", "/app");
    expect(screen.queryByText("falha de teste")).not.toBeInTheDocument();
  });

  it("pedaço da tela que não baixou (versão nova): pede para recarregar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderAt({ lazy: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/x.js")) });
    expect(await screen.findByText(/Saiu uma versão nova do Tinindo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar a página" })).toBeInTheDocument();
  });

  it("reconhece as mensagens de pedaço que não carregou nos navegadores", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: x"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("x is undefined"))).toBe(false);
  });
});

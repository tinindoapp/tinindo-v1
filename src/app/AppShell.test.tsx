import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { isAccountArea } from "./AppShell.tsx";
import { MODULES } from "./modules.ts";
import { buildNavigation, SECTION_SPECS, ungrouped } from "./navigation.ts";
import { pageTitle } from "./RouteFocus.tsx";
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
    expect(await screen.findByRole("heading", { name: "Hoje", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Demonstração");
    expect(within(document.querySelector<HTMLElement>("header.tn-appbar")!).getByText("Barbearia Exemplo A")).toBeInTheDocument();
  });

  it("navegação lista um item por módulo registrado", async () => {
    renderAt("/app");
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    for (const m of MODULES) expect(nav).toHaveTextContent(m.navLabel);
  });

  it("rota de módulo abre dentro do grupo, com as telas do grupo e sem simular dados", async () => {
    renderAt("/app/agenda");
    expect(await screen.findByRole("heading", { name: "Agenda", level: 1 })).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Telas de Agenda" });
    expect(tabs).toHaveTextContent("Lista de espera");
    expect(within(tabs).getByRole("link", { name: "Agenda" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Horários" })).not.toHaveAttribute("aria-current");
    expect(tabs).toHaveTextContent("Preços");
    expect(screen.getByText(/ainda não guarda nem altera dados/)).toBeInTheDocument();
  });

  it("todo módulo registrado está em exatamente um grupo do menu", () => {
    expect(ungrouped(MODULES)).toEqual([]);
    const main = SECTION_SPECS.flatMap((s) => s.items.filter((i) => !i.sub).map((i) => i.module));
    expect(new Set(main).size).toBe(main.length);
    expect(buildNavigation(MODULES).flatMap((s) => s.items).filter((i) => !i.sub).length).toBe(MODULES.length);
    const tos = buildNavigation(MODULES).flatMap((s) => s.items.map((i) => i.to));
    expect(new Set(tos).size).toBe(tos.length);
  });

  it("abas do celular: Hoje, Agenda, Clientes, Dinheiro e Assistente (doc 12)", async () => {
    renderAt("/app/caixa");
    const tabs = await screen.findByRole("navigation", { name: "Abas" });
    const names = within(tabs).getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Hoje", "Agenda", "Clientes", "Dinheiro", "Assistente"]);
    expect(within(tabs).getByRole("link", { name: "Dinheiro" })).toHaveAttribute("aria-current", "page");
  });

  it("botão Menu abre e fecha o menu (Esc devolve o foco ao botão)", async () => {
    renderAt("/app");
    const button = await screen.findByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fechar menu" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);
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

describe("integração do P01 no shell", () => {
  it("sem negócio, só a área da Conta abre", () => {
    expect(isAccountArea("/app/conta")).toBe(true);
    expect(isAccountArea("/app/conta/novo-negocio")).toBe(true);
    expect(isAccountArea("/app/conta/vincular")).toBe(true);
    expect(isAccountArea("/app/contas")).toBe(false);
    expect(isAccountArea("/app/agenda")).toBe(false);
    expect(isAccountArea("/app")).toBe(false);
  });

  it("cadastro e recuperação de senha são rotas públicas, fora do shell", async () => {
    renderAt("/criar-conta");
    expect(await screen.findByRole("heading", { name: /criar conta/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });

  it("recuperação de senha abre sem sessão", async () => {
    renderAt("/recuperar-senha");
    expect(await screen.findByRole("heading", { name: "Recuperar acesso" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });
});

describe("acessibilidade do shell (A11Y-02 a A11Y-04)", () => {
  it("primeiro elemento focável é o “Pular para o conteúdo”, que leva ao main", async () => {
    renderAt("/app");
    await screen.findByRole("heading", { name: "Hoje", level: 1 });
    const skip = screen.getByRole("link", { name: "Pular para o conteúdo" });
    const focusables = document.querySelectorAll("a[href], button, input, select, textarea");
    expect(focusables[0]).toBe(skip);
    skip.click();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("título da página vem do h1 da tela", async () => {
    renderAt("/app/agenda");
    await screen.findByRole("heading", { name: "Agenda", level: 1 });
    await waitFor(() => expect(document.title).toBe("Agenda · Tinindo"));
  });

  it("pageTitle normaliza espaços e cai no nome do app sem h1", () => {
    expect(pageTitle("  Novo\n agendamento ")).toBe("Novo agendamento · Tinindo");
    expect(pageTitle(null)).toBe("Tinindo");
  });
});

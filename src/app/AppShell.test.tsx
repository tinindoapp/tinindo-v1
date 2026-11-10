import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { isAccountArea } from "./AppShell.tsx";
import { MODULES } from "./modules.ts";
import { buildNavigation, SECTION_SPECS, ungrouped } from "./navigation.ts";
import { pageTitle } from "./RouteFocus.tsx";
import { routes } from "./router.tsx";
import { SessionProvider } from "./session.tsx";
import { createDemoPort as createMessagingDemo, DEMO_BUSINESS_PHONE, resetDemoState as resetMessagingDemo } from "../features/messaging/demoPort.ts";

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

  it("faixa Demonstração aparece uma vez, no app e nas páginas públicas", async () => {
    for (const path of ["/app", "/entrar", "/criar-conta", "/recuperar-senha", "/diretorio"]) {
      const { unmount } = renderAt(path);
      await screen.findAllByRole("heading", { level: 1 });
      expect(screen.getAllByRole("note")).toHaveLength(1);
      expect(screen.getByRole("note")).toHaveTextContent("Demonstração · ");
      expect(screen.getByRole("note")).toHaveTextContent("dados fictícios");
      unmount();
    }
  });

  it("sub-abas usam rótulo curto só onde há um (Espera, Lembretes)", () => {
    const items = buildNavigation(MODULES).flatMap((s) => s.items);
    const short = Object.fromEntries(items.filter((i) => i.short !== i.label).map((i) => [i.label, i.short]));
    expect(short).toEqual({ "Lista de espera": "Espera", Relacionamento: "Lembretes" });
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
    // Sub-aba com rótulo curto; o menu lateral mantém o nome inteiro.
    expect(within(tabs).getByRole("link", { name: "Espera" })).toHaveAttribute("href", "/app/lista-de-espera");
    expect(screen.getByRole("navigation", { name: "Principal" })).toHaveTextContent("Lista de espera");
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

  it("abas do celular: Hoje, Agenda, Clientes, Retorno e Dinheiro; Mensagens e Assistente juntos no menu (D2 b)", async () => {
    renderAt("/app/caixa");
    const tabs = await screen.findByRole("navigation", { name: "Abas" });
    const names = within(tabs).getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Hoje", "Agenda", "Clientes", "Retorno", "Dinheiro"]);
    expect(within(tabs).getByRole("link", { name: "Dinheiro" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Retorno" })).toHaveAttribute("href", "/app/relacionamento/retorno");
    const nav = buildNavigation(MODULES);
    const mensagens = nav.find((s) => s.id === "mensagens")!;
    expect(mensagens.tab).toBe(false);
    expect(mensagens.items.map((i) => i.label)).toEqual(["Mensagens", "Assistente"]);
    expect(nav.find((s) => s.id === "retorno")!.items.map((i) => [i.label, i.to])).toEqual([["Retorno", "/app/relacionamento/retorno"]]);
    expect(nav.find((s) => s.id === "clientes")!.items.map((i) => i.label)).not.toContain("Mensagens");
    // Mensagens continua a um toque, no menu.
    expect(within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: "Mensagens" })).toHaveAttribute("href", "/app/mensagens");
  });

  it("Retorno é tela do Relacionamento, mas acende só a aba Retorno; Relacionamento continua em Clientes", async () => {
    const { unmount } = renderAt("/app/relacionamento/retorno");
    expect(await screen.findByRole("heading", { name: "Retorno", level: 1 })).toBeInTheDocument();
    let tabs = screen.getByRole("navigation", { name: "Abas" });
    expect(within(tabs).getByRole("link", { name: "Retorno" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Clientes" })).not.toHaveAttribute("aria-current");
    expect(within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: "Retorno" })).toHaveAttribute("aria-current", "page");
    // Grupo de uma tela só: sem faixa de sub-abas.
    expect(screen.queryByRole("navigation", { name: "Telas de Retorno" })).not.toBeInTheDocument();
    unmount();

    renderAt("/app/relacionamento");
    expect(await screen.findByRole("heading", { name: "Relacionamento", level: 1 })).toBeInTheDocument();
    tabs = screen.getByRole("navigation", { name: "Abas" });
    expect(within(tabs).getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Retorno" })).not.toHaveAttribute("aria-current");
    expect(within(screen.getByRole("navigation", { name: "Telas de Clientes" })).getByRole("link", { name: "Lembretes" })).toHaveAttribute("aria-current", "page");
  });

  it("no Assistente, nenhuma aba acende, o Menu marca a área e a sub-aba leva às conversas", async () => {
    renderAt("/app/assistente");
    const tabs = await screen.findByRole("navigation", { name: "Abas" });
    expect(tabs.querySelector('[aria-current="page"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("data-active", "true");
    const sub = screen.getByRole("navigation", { name: "Telas de Mensagens" });
    expect(within(sub).getByRole("link", { name: "Assistente" })).toHaveAttribute("aria-current", "page");
    expect(within(sub).getByRole("link", { name: "Mensagens" })).toHaveAttribute("href", "/app/mensagens");
  });

  it("selo de não lidas no menu, escrito por extenso para o leitor de tela (a barra não tem mais Mensagens)", async () => {
    resetMessagingDemo();
    const port = createMessagingDemo();
    await port.connect("simulated", DEMO_BUSINESS_PHONE, "c1");
    await port.dispatch!();
    const code = /([0-9]{6})/.exec((await port.simPhone(DEMO_BUSINESS_PHONE)).messages[0]!.body)![1]!;
    await port.verify(code, "v1");
    await port.simInbound({ kind: "inbound", phone_e164: "+5511988887777", text: "Oi" }, "e1");
    await port.simInbound({ kind: "inbound", phone_e164: "+5511988880000", text: "Olá" }, "e2");
    await port.simInbound({ kind: "inbound", phone_e164: "+5511988880000", text: "Tem horário?" }, "e3");
    renderAt("/app");
    const menu = await screen.findByRole("navigation", { name: "Principal" });
    const link = await within(menu).findByRole("link", { name: "Mensagens, 3 não lidas" });
    expect(within(link).getByText("3")).toHaveAttribute("aria-hidden", "true");
    expect(link).toHaveTextContent(/^Mensagens3$/);
    expect(within(screen.getByRole("navigation", { name: "Abas" })).queryByRole("link", { name: /Mensagens/ })).not.toBeInTheDocument();
    resetMessagingDemo();
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

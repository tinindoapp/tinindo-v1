import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { routes } from "../router.tsx";
import { SessionProvider } from "../session.tsx";
import { createFixturePort } from "../../features/scheduling/fixturePort.ts";
import type { SchedulingPort } from "../../features/scheduling/port.ts";
import { resetDemoPort } from "../../features/scheduling/SchedulingLayout.tsx";

const SLOW = { timeout: 5000 };

/** Agenda de exemplo (terça 20/10) vista às 11:20: quatro atendimentos já passaram e o próximo é o das 11:25, da Ana. */
function portAt(now: string): SchedulingPort {
  const port = createFixturePort();
  return {
    ...port,
    now: () => new Date(now),
    listCustomers: async () => (await port.listCustomers()).map((c) => (c.id === FX.customers.abInA ? { ...c, phone: "+5511987654321" } : c)),
  };
}

function renderHome(port: SchedulingPort) {
  resetDemoPort(port);
  render(
    <SessionProvider client={null}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/app"] })} />
    </SessionProvider>,
  );
}

afterEach(() => resetDemoPort());

describe("Hoje (auditoria de UX, itens 30 e 31)", () => {
  it("destaca o próximo atendimento com quanto falta, Abrir e WhatsApp", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const next = await screen.findByRole("region", { name: /^Próximo:/ }, SLOW);
    expect(next).toHaveAccessibleName("Próximo: 11:25 · Cliente Exemplo Ana · em 5 min");
    expect(within(next).getByRole("link", { name: /^Abrir/ })).toHaveAttribute("href", "/app/agenda/atendimento/60000000-0000-4000-8000-000000000005");
    expect(within(next).getByRole("link", { name: /^WhatsApp/ })).toHaveAttribute("href", "https://wa.me/5511987654321");
  });

  it("passados em cinza, selo só nas exceções e \"Ver os N de hoje\" como link", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const list = await screen.findByRole("list", { name: "Outros atendimentos de hoje" }, SLOW);
    const rows = within(list).getAllByRole("listitem");
    // Seis no dia: o próximo fica no destaque e os outros cinco na lista, em ordem.
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("09:00");
    expect(rows[0]).toHaveAttribute("data-past", "true");
    const held = rows.find((r) => r.textContent?.includes("10:45"))!;
    expect(held).toHaveAttribute("data-past", "true");
    expect(held).toHaveTextContent("Reserva provisória");
    const later = rows.find((r) => r.textContent?.includes("15:00"))!;
    expect(later).not.toHaveAttribute("data-past");
    // Confirmado é o normal: sem selo.
    expect(within(list).queryByText("Confirmado")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver os 6 de hoje" })).toHaveAttribute("href", "/app/agenda");
  });

  it("sem WhatsApp no cadastro, o botão não aparece; o que já começou é \"agora\"", async () => {
    const port = createFixturePort();
    renderHome(port);
    const next = await screen.findByRole("region", { name: /^Próximo:/ }, SLOW);
    expect(next).toHaveAccessibleName("Próximo: 09:00 · Cliente Exemplo Ana · agora");
    expect(within(next).queryByRole("link", { name: /^WhatsApp/ })).not.toBeInTheDocument();
  });

  it("P45/P48: \"Para você esta semana\" com uma sugestão (período, número e denominador), Ver, Agora não e Ver todas", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const card = await screen.findByRole("region", { name: "Para você esta semana" }, SLOW);
    const items = await within(card).findAllByRole("listitem", {}, SLOW);
    expect(items).toHaveLength(1);
    expect(within(card).getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/app/metas");
    for (const item of items) {
      expect(item.textContent).toMatch(/\d+ de \d+/);
      expect(item.textContent).toMatch(/\d{2}\/\d{2}/);
      expect(within(item).getByRole("button", { name: /^Agora não/ })).toBeInTheDocument();
      expect(within(item).queryByRole("link", { name: /^Ver/ }) ?? within(item).queryByRole("button", { name: /^Ver/ })).toBeInTheDocument();
    }
    // A linha antiga de sugestões saiu das Pendências (o cartão ocupa esse papel).
    expect(screen.queryByText(/com base nos seus números/)).not.toBeInTheDocument();
  });
});

describe("Hoje: \"sem cobrança\" é o que está em aberto, de qualquer mês (revisão 10/11, ux-nucleo-celular-03)", () => {
  it("conta o atendimento de setembro sem cobrança junto com os de outubro", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const pending = await screen.findByRole("list", { name: "Pendências" }, SLOW);
    const row = within(pending).getByRole("link", { name: /sem cobrança/ });
    expect(row).toHaveTextContent(/^3 atendimentos sem cobrançaR\$\s160,00 a registrar no Caixa$/);
    expect(row).toHaveAttribute("href", "/app/caixa");
  });
});

describe("Hoje: o dia primeiro (P48, decisão D6)", () => {
  /** Na ordem do documento, os blocos da tela (sem o cabeçalho). */
  function blocks(): string[] {
    const main = document.querySelector(".tn-today")!;
    return [...main.querySelectorAll("[aria-labelledby], .tn-stats")].map((e) =>
      e.classList.contains("tn-stats") ? "números" : document.getElementById(e.getAttribute("aria-labelledby")!)!.textContent!);
  }

  it("Próximo, lista do dia, pendências, números, configuração em uma linha e uma sugestão; sem \"Ações rápidas\"", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    await screen.findByRole("region", { name: "Para você esta semana" }, SLOW);
    await screen.findByRole("region", { name: /Deixe seu negócio pronto/ }, SLOW);
    const order = blocks();
    const at = (re: RegExp) => order.findIndex((x) => re.test(x));
    expect(at(/^Próximo:/)).toBe(0);
    expect(at(/^Atendimentos de hoje$/)).toBe(1);
    expect(at(/^Pendências$/)).toBe(2);
    expect(at(/^números$/)).toBe(3);
    expect(at(/^Deixe seu negócio pronto/)).toBe(4);
    expect(at(/^Para você esta semana/)).toBe(5);
    expect(screen.queryByRole("list", { name: "Ações rápidas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Perguntar ao assistente" })).not.toBeInTheDocument();
    // Novo agendamento é o "+": um link só, para o fluxo de agendamento.
    expect(screen.getByRole("link", { name: "Novo agendamento" })).toHaveAttribute("href", "/app/agenda/novo");
  });

  it("com atendimento no dia, a configuração é uma linha fina: contagem, barra e o próximo passo como link", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const line = await screen.findByRole("region", { name: /Deixe seu negócio pronto/ }, SLOW);
    expect(line).toHaveClass("tn-setup-line");
    expect(line).toHaveAccessibleName("Deixe seu negócio pronto · 5 de 8");
    expect(within(line).getByRole("progressbar", { name: "Passos feitos" })).toHaveAttribute("aria-valuenow", "5");
    expect(within(line).getByRole("link", { name: /^Publicar perfil/ })).toHaveAttribute("href", "/app/perfil");
    // O texto longo do cartão fica para o dia vazio e para a tela Configuração.
    expect(within(line).queryByRole("button", { name: "Agora não" })).not.toBeInTheDocument();
    expect(line).not.toHaveTextContent("O link público é como o cliente reserva com você.");
  });

  it("sem atendimento no dia, o cartão de configuração aparece inteiro", async () => {
    const port = createFixturePort();
    renderHome({ ...port, listBookings: async () => [] });
    expect(await screen.findByText("Nenhum atendimento hoje.", undefined, SLOW)).toBeInTheDocument();
    const card = await screen.findByRole("region", { name: /Deixe seu negócio pronto/ }, SLOW);
    expect(card).toHaveClass("tn-setup-card");
    expect(card).toHaveTextContent("O link público é como o cliente reserva com você.");
    expect(screen.queryByRole("region", { name: /^Próximo:/ })).not.toBeInTheDocument();
  });

  it("números: atendimentos de hoje e recebido na semana, com o mês na nota", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const stats = await screen.findByRole("group", { name: "Resumo" }, SLOW);
    const week = within(stats).getByRole("link", { name: /^Recebido na semana/ });
    expect(week).toHaveTextContent(/^Recebido na semanaR\$\s[\d.]+,\d\dno mês: R\$\s1\.740,00$/);
    expect(week).toHaveAttribute("href", "/app/caixa");
    expect(within(stats).getByRole("link", { name: /^Atendimentos hoje/ })).toBeInTheDocument();
    expect(within(stats).queryByRole("link", { name: /Recebido no mês/ })).not.toBeInTheDocument();
  });

  it("Próximo que ainda não começou: sem Atendido e Faltou", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const next = await screen.findByRole("region", { name: /^Próximo:/ }, SLOW);
    expect(within(next).queryByRole("button", { name: /^Atendido/ })).not.toBeInTheDocument();
    expect(within(next).getByRole("link", { name: /^Abrir/ })).toHaveAttribute("data-variant", "primary");
  });
});


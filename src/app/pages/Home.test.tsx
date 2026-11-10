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

  it("P45: \"Para você esta semana\" com até 3 sugestões, cada uma com período, número e denominador, Ver e Agora não", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const card = await screen.findByRole("region", { name: "Para você esta semana" }, SLOW);
    const items = await within(card).findAllByRole("listitem", {}, SLOW);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
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

describe("Hoje: \"A cobrar\" é o que está em aberto, de qualquer mês (revisão 10/11, ux-nucleo-celular-03)", () => {
  it("conta o atendimento de setembro sem cobrança junto com os de outubro", async () => {
    renderHome(portAt("2026-10-20T11:20:00-03:00"));
    const card = await screen.findByRole("link", { name: /^A cobrar/ }, SLOW);
    expect(card).toHaveTextContent(/^A cobrar3R\$\s160,00 em aberto$/);
  });
});


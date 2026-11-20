import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/router.tsx";
import { SessionProvider } from "../../app/session.tsx";
import { dismissToast } from "../../components/ui/index.tsx";
import { FX } from "@contracts/fixtures.ts";
import { createFixturePort } from "./fixturePort.ts";
import type { SchedulingPort } from "./port.ts";
import { resetDemoPort } from "./SchedulingLayout.tsx";

// Relógio da demonstração: terça 20/10/2026, 09:00. Na quinta 22/10 a Ana já tem um Corte às 09:00 (conflito natural).
const SLOW = { timeout: 5000 };
const THURSDAYS = { starts_at: "2026-10-22T00:00:00-03:00", ends_at: "2026-11-20T00:00:00-03:00" };

function renderAt(path: string, port: SchedulingPort) {
  resetDemoPort(port);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SessionProvider client={null}>
      <RouterProvider router={router} />
    </SessionProvider>,
  );
  return router;
}

afterEach(() => {
  resetDemoPort();
  act(() => dismissToast());
});

/** Abre o Novo agendamento na quarta 21/10, liga a repetição e troca a quarta pelos dias pedidos. */
async function openSeries(port: SchedulingPort, days: string[], time: string, weeks: string) {
  renderAt("/app/agenda/novo?data=2026-10-21", port);
  fireEvent.click(await screen.findByRole("checkbox", { name: /Repetir toda semana/ }, SLOW));
  const form = screen.getByRole("form", { name: "Repetir toda semana" });
  fireEvent.click(within(form).getByRole("checkbox", { name: "Quarta" }));
  for (const day of days) fireEvent.click(within(form).getByRole("checkbox", { name: day }));
  fireEvent.change(within(form).getByLabelText("Horário"), { target: { value: time } });
  fireEvent.change(within(form).getByLabelText("Quantas semanas"), { target: { value: weeks } });
  return form;
}

describe("repetir toda semana (demonstração sobre fixtures)", () => {
  it("prévia marca a data em conflito, nada é criado sem confirmar e a confirmação diz o que ficou de fora", async () => {
    const port = createFixturePort();
    const createSeries = vi.spyOn(port, "createSeries");
    const before = (await port.listBookings(THURSDAYS)).length;
    const form = await openSeries(port, ["Quinta"], "09:00", "3");
    // Com a repetição ligada, a escolha de um horário avulso sai da tela.
    expect(screen.queryByRole("group", { name: "Horários livres" })).not.toBeInTheDocument();

    const dates = await within(form).findByRole("list", { name: "Datas da repetição" }, SLOW);
    const items = within(dates).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("22/10");
    expect(items[0]).toHaveTextContent("Indisponível: fica de fora");
    expect(items[1]).toHaveTextContent("29/10");
    expect(items[1]).toHaveTextContent("Livre");
    expect(within(form).getByText("3 datas: 2 livres e 1 fica de fora.")).toBeInTheDocument();
    expect(within(form).getByText(/Toda semana: quinta, às 09:00\./)).toBeInTheDocument();
    expect(within(form).getByText(/Nada é criado até você confirmar\./)).toBeInTheDocument();
    // Só olhar a prévia não grava nada.
    expect(createSeries).not.toHaveBeenCalled();
    expect(await port.listBookings(THURSDAYS)).toHaveLength(before);

    fireEvent.click(screen.getByRole("radio", { name: /Cliente Exemplo Ana/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar repetição" }));

    expect(await screen.findByRole("heading", { name: "2 agendamentos criados" }, SLOW)).toBeInTheDocument();
    const done = screen.getByRole("region", { name: "2 agendamentos criados" });
    expect(done).toHaveTextContent("1 data ficou de fora");
    expect(within(done).getByRole("list", { name: "Datas que ficaram de fora" })).toHaveTextContent("quinta-feira, 22 de outubro, 09:00–09:30");
    expect(within(done).getByRole("link", { name: "Ver na agenda" })).toHaveAttribute("href", "/app/agenda?data=2026-10-29");

    expect(createSeries).toHaveBeenCalledTimes(1);
    const [input, key] = createSeries.mock.calls[0]!;
    expect(input).toEqual({
      customer_id: FX.customers.abInA, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A,
      slot: { starts_at: "2026-10-22T09:00:00-03:00", ends_at: "2026-10-22T09:30:00-03:00" }, weeks: 3, all_or_nothing: false,
    });
    expect(key).toMatch(/^[0-9a-f-]{36}-d4$/);
    expect(await port.listBookings(THURSDAYS)).toHaveLength(before + 2);
    // O vínculo vem do servidor: os criados têm o mesmo series_id.
    const created = (await port.listBookings(THURSDAYS)).filter((b) => b.series_id);
    expect(new Set(created.map((b) => b.series_id)).size).toBe(1);
  });

  it("valida no envio: dias, cliente e a data final; 'Até uma data' vira semanas", async () => {
    const port = createFixturePort();
    const createSeries = vi.spyOn(port, "createSeries");
    const form = await openSeries(port, [], "09:00", "3");
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar repetição" }));
    expect(await within(form).findByText("Escolha pelo menos um dia da semana.")).toBeInTheDocument();
    expect(screen.getByText("Escolha o cliente, cadastre um novo ou marque Sem cadastro.")).toBeInTheDocument();

    fireEvent.click(within(form).getByRole("checkbox", { name: "Quinta" }));
    fireEvent.click(within(form).getByRole("radio", { name: "Até uma data" }));
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar repetição" }));
    expect(await within(form).findByText("Informe o dia do último atendimento.")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Último dia"), { target: { value: "2026-10-23" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar repetição" }));
    expect(await within(form).findByText(/quinta teria só 1 atendimento/)).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText("Último dia"), { target: { value: "2026-11-05" } });
    const dates = await within(form).findByRole("list", { name: "Datas da repetição" }, SLOW);
    expect(within(dates).getAllByRole("listitem").map((li) => li.textContent?.slice(0, 11))).toEqual(["qui., 22/10", "qui., 29/10", "qui., 05/11"]);
    expect(createSeries).not.toHaveBeenCalled();
  });

  it("resposta perdida: a nova tentativa sai com a mesma chave e não cria em dobro; quinta e sexta numa série só", async () => {
    const port = createFixturePort();
    const real = port.createSeries.bind(port);
    let calls = 0;
    const createSeries = vi.spyOn(port, "createSeries").mockImplementation(async (input, key) => {
      calls += 1;
      // A primeira chamada é gravada no servidor, mas a resposta se perde no caminho.
      const out = await real(input, key);
      if (calls === 1) throw new TypeError("Failed to fetch");
      return out;
    });
    const form = await openSeries(port, ["Quinta", "Sexta"], "09:00", "2");
    await within(form).findByRole("list", { name: "Datas da repetição" }, SLOW);
    fireEvent.click(screen.getByRole("radio", { name: /Cliente Exemplo Bruno/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar repetição" }));

    expect(await within(form).findByText("Não deu para concluir a repetição", undefined, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /criados?$/ })).not.toBeInTheDocument();

    fireEvent.click(within(form).getByRole("button", { name: "Tentar de novo" }));
    // Quinta 22/10 em conflito; quinta 29/10, sexta 23/10 e sexta 30/10 criadas.
    expect(await screen.findByRole("heading", { name: "3 agendamentos criados" }, SLOW)).toBeInTheDocument();
    expect(createSeries).toHaveBeenCalledTimes(2);
    const [first, retry] = createSeries.mock.calls;
    expect(retry).toEqual(first);
    expect(first![0]).toMatchObject({ weekdays: [4, 5], weeks: 2 });
    expect(first![1]).toMatch(/-d45$/);
    // Gravado uma vez só, apesar de a chamada ter saído duas vezes, e com um series_id.
    const made = (await port.listBookings(THURSDAYS)).filter((b) => b.customer_id === FX.customers.guestInA && b.starts_at.includes("T09:00"));
    expect(made.map((b) => b.starts_at.slice(0, 10))).toEqual(["2026-10-23", "2026-10-29", "2026-10-30"]);
    expect(new Set(made.map((b) => b.series_id)).size).toBe(1);
  });
});

describe("repetição na Agenda e no detalhe", () => {
  async function seeded() {
    const port = createFixturePort();
    const out = await port.createSeries({
      customer_id: FX.customers.guestInA, guest_ref: null, service_id: FX.services.corteA, resource_id: FX.resources.A,
      slot: { starts_at: "2026-10-23T10:00:00-03:00", ends_at: "2026-10-23T10:30:00-03:00" }, weeks: 3, all_or_nothing: false,
    }, "chave-teste-serie-0001");
    return { port, ids: out.created.map((b) => b.id) };
  }

  it("detalhe mostra 'Repete toda semana · 1 de 3'; 'Cancelar só este' deixa os outros marcados", async () => {
    const { port, ids } = await seeded();
    renderAt(`/app/agenda/atendimento/${ids[0]}`, port);
    expect(await screen.findByText("Repete toda semana · 1 de 3", undefined, SLOW)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir o próximo" })).toHaveAttribute("href", `/app/agenda/atendimento/${ids[1]}`);
    expect(screen.queryByRole("button", { name: "Cancelar atendimento" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar os próximos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar só este" }));
    expect(screen.getByText(/Os outros atendimentos da repetição continuam marcados/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Aluno viajou" } });
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    expect(await screen.findByText("Cancelado", undefined, SLOW)).toBeInTheDocument();
    // Os outros dois continuam confirmados.
    await waitFor(async () => expect((await port.getBooking(ids[0]!)).status).toBe("cancelled"));
    expect((await port.getBooking(ids[1]!)).status).toBe("confirmed");
    expect((await port.getBooking(ids[2]!)).status).toBe("confirmed");
  });

  it("agenda do dia marca o atendimento da repetição; atendimento avulso não leva a marca", async () => {
    const { port } = await seeded();
    renderAt("/app/agenda?data=2026-10-30", port);
    const list = await screen.findByRole("list", { name: /Linha do tempo de sexta-feira, 30 de outubro/ }, SLOW);
    expect(await within(list).findByText("Repete toda semana · 2 de 3")).toBeInTheDocument();
    expect(within(list).getAllByText(/Repete toda semana/)).toHaveLength(1);
  });

  it("'Cancelar os próximos' pede confirmação com motivo e cancela este e os seguintes de uma vez", async () => {
    const { port, ids } = await seeded();
    const spy = vi.spyOn(port, "cancelSeriesFrom");
    renderAt(`/app/agenda/atendimento/${ids[1]}`, port);
    expect(await screen.findByText("Repete toda semana · 2 de 3", undefined, SLOW)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar os próximos" }));
    expect(screen.getByText("Cancelar este e os próximos 1?")).toBeInTheDocument();
    expect(screen.getByText(/2 atendimentos da repetição/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar 2" }));
    expect(await screen.findByText("Informe o motivo do cancelamento.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Aluno mudou de academia" } });
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar 2" }));
    await waitFor(async () => expect((await port.getBooking(ids[2]!)).status).toBe("cancelled"));
    expect((await port.getBooking(ids[1]!)).status).toBe("cancelled");
    expect((await port.getBooking(ids[0]!)).status).toBe("confirmed");
    expect((await port.getBooking(ids[2]!)).status_reason).toBe("Aluno mudou de academia");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("'Mandar link da reserva' gera o link e abre o WhatsApp com o texto pronto", async () => {
    const { port, ids } = await seeded();
    const opened = { location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
    renderAt(`/app/agenda/atendimento/${ids[0]}`, port);
    fireEvent.click(await screen.findByRole("button", { name: "Mandar link da reserva" }, SLOW));
    expect(await screen.findByText(/Veja os detalhes da reserva por este link: http.*\/reserva#t=/)).toBeInTheDocument();
    expect(screen.getByText(/Demonstração: o link é de exemplo/)).toBeInTheDocument();
    if (opened.location.href) expect(opened.location.href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    open.mockRestore();
  });
});

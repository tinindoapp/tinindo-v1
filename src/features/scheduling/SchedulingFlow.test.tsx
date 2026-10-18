import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../../app/router.tsx";
import { SessionProvider } from "../../app/session.tsx";
import { createFixturePort, type Simulation } from "./fixturePort.ts";
import { resetDemoPort } from "./SchedulingLayout.tsx";

function renderAt(path: string, simulate: Simulation = null) {
  resetDemoPort(createFixturePort({ simulate }));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SessionProvider client={null}>
      <RouterProvider router={router} />
    </SessionProvider>,
  );
  return router;
}

afterEach(() => resetDemoPort());

describe("agenda (demonstração sobre fixtures)", () => {
  it("dia mostra atendimentos no fuso do negócio, ocupação e aviso de dados de exemplo", async () => {
    renderAt("/app/agenda");
    const list = await screen.findByRole("list", { name: /Linha do tempo/ });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("09:00–09:30");
    expect(screen.getByText(/Dados de exemplo\./)).toBeInTheDocument();
    expect(screen.getByText(/confirmados de 9 h vendáveis/)).toBeInTheDocument();
    expect(screen.getByText(/Reservas provisórias \(não contam\): 1/)).toBeInTheDocument();
  });

  it("novo agendamento: 409 explicado, horário some e segunda tentativa confirma", async () => {
    const router = renderAt("/app/agenda/novo?data=2026-10-20", "conflito");
    fireEvent.click(await screen.findByRole("button", { name: "15:45" }));
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "30000000-0000-4000-8000-0000000000a1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar agendamento" }));

    expect(await screen.findByText("Esse horário acabou de ser ocupado")).toBeInTheDocument();
    expect(screen.getByText(/Nenhum agendamento foi criado/)).toBeInTheDocument();
    await screen.findByRole("button", { name: "16:30" });
    expect(screen.queryByRole("button", { name: "15:45" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Revise e confirme" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "16:30" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar agendamento" }));
    expect(await screen.findByText("Agendamento confirmado.")).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/app\/agenda\/atendimento\//);
  });

  it("cancelar exige motivo, mostra política e libera o horário", async () => {
    renderAt("/app/agenda/atendimento/60000000-0000-4000-8000-000000000006");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar atendimento" }));
    expect(screen.getByText(/Nenhuma multa é cobrada automaticamente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o motivo");
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Cliente pediu" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText(/O horário voltou a ficar livre/)).toBeInTheDocument();
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
  });

  it("edição concorrente (409 de versão) é explicada e os dados são recarregados", async () => {
    renderAt("/app/agenda/atendimento/60000000-0000-4000-8000-000000000006", "versao");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar atendimento" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Cliente pediu" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText("Este atendimento mudou enquanto você editava")).toBeInTheDocument();
    expect(await screen.findByText("Confirmado")).toBeInTheDocument();
  });
});

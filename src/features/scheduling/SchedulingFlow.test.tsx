import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../../app/router.tsx";
import { SessionProvider } from "../../app/session.tsx";
import { dismissToast } from "../../components/ui/index.tsx";
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

afterEach(() => {
  resetDemoPort();
  act(() => dismissToast());
});

/** O retorno das ações sai no aviso curto (Toast) do RouteFrame, região viva única. */
// Bloqueios cobrem 60 dias de expediente: a primeira leitura demora mais que o padrão de 1 s no jsdom.
const SLOW = { timeout: 5000 };
const toaster = () => document.querySelector<HTMLElement>(".tn-toaster")!;

describe("agenda (demonstração sobre fixtures)", () => {
  it("dia mostra atendimentos no fuso do negócio, ocupação e aviso de dados de exemplo", async () => {
    renderAt("/app/agenda");
    const list = await screen.findByRole("list", { name: /Linha do tempo/ });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("09:00–09:30");
    expect(screen.getByText(/Dados de exemplo\./)).toBeInTheDocument();
    // Ocupação compacta acima da lista; detalhes recolhidos em "Ver números do dia".
    expect(screen.getByText(/% ocupado/)).toBeInTheDocument();
    expect(screen.getByText("Ver números do dia")).toBeInTheDocument();
    expect(screen.getByText(/de 9 h vendáveis/)).toBeInTheDocument();
    const occ = screen.getByRole("group", { name: "Ocupação do dia" });
    expect(occ.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(await within(toaster()).findByText("Agendamento confirmado.")).toBeInTheDocument();
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
    expect(await within(toaster()).findByText(/O horário voltou a ficar livre/)).toBeInTheDocument();
    expect(await screen.findByText("Cancelado")).toBeInTheDocument();
  });

  it("edição concorrente (409 de versão) é explicada e os dados são recarregados", async () => {
    renderAt("/app/agenda/atendimento/60000000-0000-4000-8000-000000000006", "versao");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar atendimento" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Cliente pediu" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText("Este atendimento mudou enquanto você editava")).toBeInTheDocument();
    expect(await screen.findByText("Confirmado")).toBeInTheDocument();
  });

  it("novo agendamento sem cliente: erro embaixo do campo e foco nele, sem criar nada", async () => {
    const router = renderAt("/app/agenda/novo?data=2026-10-20");
    fireEvent.click(await screen.findByRole("button", { name: "15:45" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar agendamento" }));
    const select = screen.getByLabelText("Cliente");
    expect(await screen.findByText("Escolha o cliente.")).toBeInTheDocument();
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveFocus();
    expect(router.state.location.pathname).toBe("/app/agenda/novo");
  });

  it("agenda: Dia/Semana é escolha única e as setas de data são botões de ícone com nome", async () => {
    renderAt("/app/agenda");
    await screen.findByRole("list", { name: /Linha do tempo/ });
    expect(screen.getByRole("radio", { name: "Dia" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Semana" }));
    expect(await screen.findByRole("heading", { name: /Semana de/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Semana" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Semana anterior" })).toHaveClass("tn-icon-button");
    expect(screen.getByRole("button", { name: "Próxima semana" })).toHaveClass("tn-icon-button");
  });
});

describe("horários (demonstração)", () => {
  it("bloqueio sem motivo: erro embaixo do campo e foco nele", async () => {
    renderAt("/app/agenda/horarios");
    const form = await screen.findByRole("form", { name: "Novo bloqueio" });
    fireEvent.click(within(form).getByRole("button", { name: "Bloquear" }));
    expect(await within(form).findByText("Diga o motivo do bloqueio (só você vê).")).toBeInTheDocument();
    expect(within(form).getByLabelText("Motivo")).toHaveFocus();
  });

  it("remover bloqueio executa na hora e Desfazer recria o mesmo bloqueio", async () => {
    renderAt("/app/agenda/horarios");
    const blockRow = async () => (await screen.findByText("Compromisso pessoal", undefined, SLOW)).closest("li")!;
    fireEvent.click(within(await blockRow()).getByRole("button", { name: /^Remover/ }));
    expect(await within(toaster()).findByText(/Bloqueio "Compromisso pessoal" removido/)).toBeInTheDocument();
    expect(await screen.findByText("Nenhum bloqueio.", undefined, SLOW)).toBeInTheDocument();

    fireEvent.click(within(toaster()).getByRole("button", { name: "Desfazer" }));
    expect(await within(toaster()).findByText(/Bloqueio "Compromisso pessoal" refeito/)).toBeInTheDocument();
    expect(await blockRow()).toHaveTextContent(/quinta-feira, 22 de outubro, 14:00–16:00/);
  });

  it("expediente com fim antes do início: erro embaixo da faixa e foco no campo", async () => {
    renderAt("/app/agenda/horarios");
    const monday = await screen.findByRole("group", { name: "Segunda" });
    const end = within(monday).getAllByLabelText("Fim")[0]!;
    fireEvent.change(end, { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar expediente" }));
    expect(await within(monday).findByText("O fim deve ser depois do início.")).toBeInTheDocument();
    expect(end).toHaveFocus();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/router.tsx";
import { SessionProvider } from "../../app/session.tsx";
import { dismissToast } from "../../components/ui/index.tsx";
import { FX } from "@contracts/fixtures.ts";
import { createFixturePort, type Simulation } from "./fixturePort.ts";
import type { SchedulingPort } from "./port.ts";
import { resetDemoPort } from "./SchedulingLayout.tsx";

const FIRST = "60000000-0000-4000-8000-000000000001"; // terça 09:00, Ana (começa no relógio da demonstração)
const HELD = "60000000-0000-4000-8000-000000000004"; // terça 10:45, reserva provisória
const ANA = FX.customers.abInA;
const BRUNO = FX.customers.guestInA;

function renderAt(path: string, simulate: Simulation = null, port: SchedulingPort = createFixturePort({ simulate })) {
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

/** O retorno das ações sai no aviso curto (Toast) do RouteFrame, região viva única. */
// Bloqueios cobrem 60 dias de expediente: a primeira leitura demora mais que o padrão de 1 s no jsdom.
const SLOW = { timeout: 5000 };
const toaster = () => document.querySelector<HTMLElement>(".tn-toaster")!;

describe("agenda (demonstração sobre fixtures)", () => {
  it("dia mostra atendimentos no fuso do negócio, ocupação e aviso de dados de exemplo", async () => {
    renderAt("/app/agenda");
    const list = await screen.findByRole("list", { name: /Linha do tempo/ }, SLOW);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("09:00–09:30");
    expect(screen.getByText(/Dados de exemplo\./)).toBeInTheDocument();
    // Ocupação compacta acima da lista; detalhes recolhidos em "Ver números do dia".
    expect(screen.getByText(/% ocupado/)).toBeInTheDocument();
    expect(screen.getByText("Ver números do dia")).toBeInTheDocument();
    expect(screen.getByText(/de 9 h livres para agendar/)).toBeInTheDocument();
    const occ = screen.getByRole("group", { name: "Ocupação do dia" });
    expect(occ.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Reservas provisórias \(não contam\): 1/)).toBeInTheDocument();
  });

  it("novo agendamento: 409 explicado, horário some e segunda tentativa confirma", async () => {
    const router = renderAt("/app/agenda/novo?data=2026-10-20", "conflito");
    fireEvent.click(await screen.findByRole("button", { name: "15:45" }, SLOW));
    fireEvent.click(screen.getByRole("radio", { name: /Cliente Exemplo Ana/ }));
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

  it("cancelar exige motivo (erro embaixo do campo e foco nele), mostra política e libera o horário", async () => {
    renderAt("/app/agenda/atendimento/60000000-0000-4000-8000-000000000006");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar atendimento" }, SLOW));
    expect(screen.getByText(/Nenhuma multa é cobrada automaticamente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    expect(await screen.findByText("Informe o motivo do cancelamento.")).toBeInTheDocument();
    const motivo = screen.getByLabelText("Motivo");
    expect(motivo).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(motivo).toHaveFocus());
    fireEvent.change(motivo, { target: { value: "Cliente pediu" } });
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    expect(await within(toaster()).findByText(/O horário voltou a ficar livre/)).toBeInTheDocument();
    expect(await screen.findByText("Cancelado", undefined, SLOW)).toBeInTheDocument();
    // Próximo passo na tela: o motivo digitado agora e Desfazer. Terça às 15:00 ninguém da lista de espera aceita.
    const next = await screen.findByRole("region", { name: "Atendimento cancelado" }, SLOW);
    expect(next).toHaveTextContent("Motivo: Cliente pediu");
    expect(within(next).getByRole("button", { name: "Desfazer" })).toBeInTheDocument();
    expect(await within(next).findByText(/Ninguém na lista de espera aceita este horário/)).toBeInTheDocument();
    // Cliente sem WhatsApp no cadastro de exemplo: o botão não aparece.
    expect(within(next).queryByRole("link", { name: "Avisar no WhatsApp" })).not.toBeInTheDocument();
  });

  it("edição concorrente (409 de versão) é explicada e os dados são recarregados", async () => {
    renderAt("/app/agenda/atendimento/60000000-0000-4000-8000-000000000006", "versao");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar atendimento" }, SLOW));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Cliente pediu" } });
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    expect(await screen.findByText("Este atendimento mudou enquanto você editava")).toBeInTheDocument();
    expect(await screen.findByText("Confirmado", undefined, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Atendimento cancelado" })).not.toBeInTheDocument();
  });

  it("cancelar na quarta: oferece à lista de espera (1 pessoa) e Desfazer refaz no mesmo horário com id novo", async () => {
    const port = createFixturePort();
    const slot = { starts_at: "2026-10-21T11:00:00-03:00", ends_at: "2026-10-21T11:20:00-03:00" };
    const made = await port.create({ customer_id: BRUNO, guest_ref: null, service_id: FX.services.barbaA, resource_id: FX.resources.A, slot, quote_id: null, mode: "confirm" }, "k-1");
    const router = renderAt(`/app/agenda/atendimento/${made.id}`, null, port);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar atendimento" }, SLOW));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Cliente avisou que não vem" } });
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    const next = await screen.findByRole("region", { name: "Atendimento cancelado" }, SLOW);
    const offer = await within(next).findByRole("link", { name: "Oferecer à lista de espera (1 pessoa)" });
    // O horário vai na URL: a lista de espera abre com a vaga em destaque.
    expect(offer).toHaveAttribute("href", `/app/lista-de-espera?vaga=${encodeURIComponent(slot.starts_at)}`);

    fireEvent.click(within(next).getByRole("button", { name: "Desfazer" }));
    expect(await within(toaster()).findByText(/Cancelamento desfeito: o atendimento foi refeito no mesmo horário/, undefined, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).not.toContain(made.id));
    expect(await screen.findByText("Confirmado", undefined, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Atendimento cancelado" })).not.toBeInTheDocument();
    const day = await port.listBookings({ starts_at: "2026-10-21T00:00:00-03:00", ends_at: "2026-10-22T00:00:00-03:00" });
    expect(day.filter((b) => b.starts_at === slot.starts_at).map((b) => b.status).sort()).toEqual(["cancelled", "confirmed"]);
  });

  it("Desfazer com o horário já ocupado explica e não cria nada", async () => {
    const port = createFixturePort();
    const slot = { starts_at: "2026-10-21T11:00:00-03:00", ends_at: "2026-10-21T11:20:00-03:00" };
    const made = await port.create({ customer_id: BRUNO, guest_ref: null, service_id: FX.services.barbaA, resource_id: FX.resources.A, slot, quote_id: null, mode: "confirm" }, "k-1");
    renderAt(`/app/agenda/atendimento/${made.id}`, null, port);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar atendimento" }, SLOW));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Remarcar" } });
    fireEvent.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    const next = await screen.findByRole("region", { name: "Atendimento cancelado" }, SLOW);
    // Outra pessoa marca o mesmo horário antes do Desfazer.
    await port.create({ customer_id: ANA, guest_ref: null, service_id: FX.services.barbaA, resource_id: FX.resources.A, slot, quote_id: null, mode: "confirm" }, "k-2");
    fireEvent.click(within(next).getByRole("button", { name: "Desfazer" }));
    expect(await within(next).findByText(/Outro atendimento já ocupou este horário/)).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Marcar outro horário" })).toHaveAttribute("href", "/app/agenda/novo?data=2026-10-21");
  });

  it("reserva provisória: prazo no fuso do negócio e Confirmar reserva congela o preço base", async () => {
    renderAt(`/app/agenda/atendimento/${HELD}`);
    expect(await screen.findByText("Vence às 09:10 se não for confirmada", undefined, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar atendimento" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    expect(await within(toaster()).findByText("Reserva confirmada por R$ 60,00.")).toBeInTheDocument();
    expect(await screen.findByText("Confirmado", undefined, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar reserva" })).not.toBeInTheDocument();
  });

  it("reserva provisória: Liberar horário pede confirmação com a consequência, sem motivo", async () => {
    renderAt(`/app/agenda/atendimento/${HELD}`);
    fireEvent.click(await screen.findByRole("button", { name: "Liberar horário" }, SLOW));
    expect(screen.getByText(/deixa de valer e o horário 10:45–11:15 volta a ficar livre/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Motivo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sim, liberar" }));
    expect(await within(toaster()).findByText("Horário liberado. O pedido deixou de valer.")).toBeInTheDocument();
    expect(await screen.findByText("Cancelado", undefined, SLOW)).toBeInTheDocument();
  });

  it("depois do início: Faltou registra na hora e Desfazer volta a confirmado", async () => {
    renderAt(`/app/agenda/atendimento/${FIRST}`);
    fireEvent.click(await screen.findByRole("button", { name: "Faltou" }, SLOW));
    expect(await within(toaster()).findByText(/Falta registrada/)).toBeInTheDocument();
    expect(await screen.findByText("Faltou", { selector: ".tn-sched-badge" })).toBeInTheDocument();
    fireEvent.click(within(toaster()).getByRole("button", { name: "Desfazer" }));
    expect(await within(toaster()).findByText("Falta desfeita. O atendimento voltou a ficar confirmado.")).toBeInTheDocument();
    expect(await screen.findByText("Confirmado", undefined, SLOW)).toBeInTheDocument();
  });

  it("depois do início: Atendido pede confirmação e conclui sem registrar pagamento", async () => {
    renderAt(`/app/agenda/atendimento/${FIRST}`);
    fireEvent.click(await screen.findByRole("button", { name: "Atendido" }, SLOW));
    expect(screen.getByText("Isso registra que o atendimento aconteceu. Não registra pagamento.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sim, foi atendido" }));
    expect(await within(toaster()).findByText(/O pagamento não foi registrado/)).toBeInTheDocument();
    expect(await screen.findByText("Concluído", undefined, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Faltou" })).not.toBeInTheDocument();
  });

  it("cartão do dia: Atendido e Faltou só nos atendimentos que já começaram", async () => {
    renderAt("/app/agenda");
    const list = await screen.findByRole("list", { name: /Linha do tempo/ }, SLOW);
    // Relógio da demonstração: 09:00. Só o das 09:00 começou.
    expect(within(list).getAllByRole("button", { name: /^Faltou/ })).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: "Faltou às 09:00" }));
    expect(await within(toaster()).findByText("Falta registrada às 09:00. O horário deixou de contar como atendimento.")).toBeInTheDocument();
    // A lista recarrega: o atendimento das 09:00 aparece como Faltou e sem os botões.
    await waitFor(() => expect(screen.getByRole("list", { name: /Linha do tempo/ })).toHaveTextContent(/09:00–09:30Corte.*Faltou/));
    expect(within(screen.getByRole("list", { name: /Linha do tempo/ })).queryByRole("button", { name: /^Faltou/ })).not.toBeInTheDocument();
  });

  it("novo agendamento sem cliente: erro embaixo do campo e foco nele, sem criar nada", async () => {
    const router = renderAt("/app/agenda/novo?data=2026-10-20");
    fireEvent.click(await screen.findByRole("button", { name: "15:45" }, SLOW));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar agendamento" }));
    const customer = screen.getByRole("group", { name: "Cliente" });
    expect(await within(customer).findByText("Escolha o cliente, cadastre um novo ou marque Sem cadastro.")).toBeInTheDocument();
    const first = within(customer).getAllByRole("radio")[0]!;
    expect(first).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(first).toHaveFocus());
    expect(router.state.location.pathname).toBe("/app/agenda/novo");
  });

  it("agenda: Dia/Semana é escolha única e as setas de data são botões de ícone com nome", async () => {
    renderAt("/app/agenda");
    await screen.findByRole("list", { name: /Linha do tempo/ }, SLOW);
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
    const form = await screen.findByRole("form", { name: "Novo bloqueio" }, SLOW);
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
    const monday = await screen.findByRole("group", { name: "Segunda" }, SLOW);
    // O dia abre fechado, como cartão-resumo; "Editar" mostra as faixas.
    expect(within(monday).getByText("09:00–12:00 e 13:00–19:00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar expediente" })).not.toBeInTheDocument();
    fireEvent.click(within(monday).getByRole("button", { name: "Editar Segunda" }));
    const end = within(monday).getAllByLabelText("Fim")[0]!;
    fireEvent.change(end, { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar expediente" }));
    expect(await within(monday).findByText("O fim deve ser depois do início.")).toBeInTheDocument();
    expect(end).toHaveFocus();
  });
});

describe("onda 3 da auditoria de UX (itens 19, 28, 29, 30, 32 e 34)", () => {
  it("avisos da tela numa linha, com a explicação em \"Como funciona\"; o fuso só aparece se o aparelho estiver noutro", async () => {
    const spy = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(180); // aparelho em -03:00
    renderAt("/app/agenda");
    await screen.findByRole("list", { name: /Linha do tempo/ }, SLOW);
    const line = screen.getByText(/As mudanças valem só nesta aba/);
    expect(line).toHaveTextContent("Dados de exemplo. As mudanças valem só nesta aba.");
    expect(screen.queryByText(/Horários de Brasília/)).not.toBeInTheDocument();
    expect(screen.getByText("Como funciona").closest("details")).not.toHaveAttribute("open");
    spy.mockRestore();
  });

  it("aparelho noutro fuso: \"Horários de Brasília\" na mesma linha", async () => {
    const spy = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540); // Tóquio
    renderAt("/app/agenda");
    await screen.findByRole("list", { name: /Linha do tempo/ }, SLOW);
    expect(screen.getByText(/As mudanças valem só nesta aba/)).toHaveTextContent("Horários de Brasília (UTC−03:00)");
    spy.mockRestore();
  });

  it("linha do dia: Confirmado sem selo; só as exceções (provisória) levam selo", async () => {
    renderAt("/app/agenda");
    const list = await screen.findByRole("list", { name: /Linha do tempo/ }, SLOW);
    expect(within(list).queryByText("Confirmado")).not.toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /10:45–11:15.*Corte.*Reserva provisória/ })).toBeInTheDocument();
  });

  it("semana: \"Ter 20\" com selo Hoje, contagem e seta; dia sem atendimento é Livre e domingo é Fechado", async () => {
    renderAt("/app/agenda?visao=semana");
    const today = await screen.findByRole("button", { name: /terça-feira, 20 de outubro/ }, SLOW);
    expect(today).toHaveAttribute("aria-current", "date");
    expect(within(today).getByText("Ter 20")).toBeInTheDocument();
    expect(within(today).getByText("Hoje")).toBeInTheDocument();
    expect(today).toHaveTextContent(/6 atendimentos · \d+% ocupado/);
    expect(today.querySelector(".tn-sched-weekday__chevron")).not.toBeNull();
    expect(screen.getByRole("button", { name: /sexta-feira, 23 de outubro/ })).toHaveTextContent("Livre");
    expect(screen.getByRole("button", { name: /domingo, 25 de outubro/ })).toHaveTextContent("Fechado");
  });

  it("novo agendamento: Cliente → Serviço → Horário, busca e barra \"Confirmar · Corte · 13:00 · R$ 51,00\"", async () => {
    renderAt("/app/agenda/novo?data=2026-10-20");
    const customer = await screen.findByRole("group", { name: "Cliente" }, SLOW);
    const service = screen.getByRole("group", { name: "Serviço" });
    const when = screen.getByRole("group", { name: "Dia e horário" });
    expect(customer.compareDocumentPosition(service) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(service.compareDocumentPosition(when) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(within(customer).getByLabelText("Buscar cliente"), { target: { value: "bru" } });
    expect(within(customer).getByRole("radio", { name: /Cliente Exemplo Bruno/ })).toBeInTheDocument();
    expect(within(customer).queryByRole("radio", { name: /Cliente Exemplo Ana/ })).not.toBeInTheDocument();
    expect(within(customer).getByRole("radio", { name: /Sem cadastro/ })).toBeInTheDocument();
    fireEvent.click(within(customer).getByRole("radio", { name: /Cliente Exemplo Bruno/ }));

    fireEvent.click(await screen.findByRole("button", { name: "13:00" }, SLOW));
    const bar = screen.getByRole("region", { name: "Resumo do agendamento" });
    await waitFor(() => expect(bar).toHaveTextContent(/Corte · 13:00 · R\$\s51,00/));
    expect(within(bar).getByRole("button", { name: "Confirmar agendamento" })).toBeInTheDocument();
  });

  it("sem cadastro: o atendimento é criado sem cliente vinculado", async () => {
    const port = createFixturePort();
    const router = renderAt("/app/agenda/novo?data=2026-10-20", null, port);
    fireEvent.click(await screen.findByRole("radio", { name: /Sem cadastro/ }, SLOW));
    fireEvent.click(await screen.findByRole("button", { name: "13:00" }, SLOW));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/agenda\/atendimento\//), SLOW);
    const id = router.state.location.pathname.split("/").pop()!;
    expect((await port.getBooking(id)).customer_id).toBeNull();
    expect(await screen.findByText("Sem cliente cadastrado", undefined, SLOW)).toBeInTheDocument();
  });

  it("+ Novo: cadastra nome e WhatsApp, já escolhe e agenda para o cliente novo", async () => {
    const port = createFixturePort();
    const create = vi.spyOn(port, "createCustomer");
    const router = renderAt("/app/agenda/novo?data=2026-10-20", null, port);
    const customer = await screen.findByRole("group", { name: "Cliente" }, SLOW);
    fireEvent.change(within(customer).getByLabelText("Buscar cliente"), { target: { value: "Carla Teste" } });
    expect(within(customer).getByText(/Nenhum cliente com “Carla Teste”/)).toBeInTheDocument();
    fireEvent.click(within(customer).getByRole("button", { name: "+ Novo cliente" }));
    const form = within(customer).getByRole("form", { name: "Novo cliente" });
    expect(within(form).getByLabelText("Nome")).toHaveValue("Carla Teste");
    fireEvent.change(within(form).getByLabelText("WhatsApp"), { target: { value: "123" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cadastrar e escolher" }));
    expect(await within(form).findByText(/WhatsApp inválido/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("WhatsApp"), { target: { value: "(11) 98888-7777" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cadastrar e escolher" }));
    expect(await within(customer).findByText("Carla Teste foi cadastrado e escolhido.", undefined, SLOW)).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith({ name: "Carla Teste", phone: "+5511988887777" }, expect.any(String));
    expect(within(customer).getByRole("radio", { name: /Carla Teste/ })).toBeChecked();

    fireEvent.click(await screen.findByRole("button", { name: "13:00" }, SLOW));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar agendamento" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/agenda\/atendimento\//), SLOW);
    expect(await screen.findByText("Carla Teste", undefined, SLOW)).toBeInTheDocument();
  });

  it("horário não escolhido: erro embaixo dos horários e foco no primeiro", async () => {
    renderAt("/app/agenda/novo?data=2026-10-20");
    fireEvent.click(await screen.findByRole("radio", { name: /Cliente Exemplo Ana/ }, SLOW));
    await screen.findByRole("button", { name: "13:00" }, SLOW);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar agendamento" }));
    expect(await screen.findByText("Escolha um horário.")).toBeInTheDocument();
    const slots = screen.getByRole("group", { name: "Horários livres" });
    await waitFor(() => expect(within(slots).getAllByRole("button")[0]).toHaveFocus());
  });
});

describe("horários: resumo por dia, copiar a segunda e aviso ao sair (item 28)", () => {
  it("copia a segunda para os dias úteis; Salvar só aparece com alteração e some depois de salvar", async () => {
    renderAt("/app/agenda/horarios");
    const monday = await screen.findByRole("group", { name: "Segunda" }, SLOW);
    fireEvent.click(within(monday).getByRole("button", { name: "Editar Segunda" }));
    fireEvent.change(within(monday).getAllByLabelText("Fim")[1]!, { target: { value: "17:00" } });
    expect(within(monday).getByText("09:00–12:00 e 13:00–17:00")).toBeInTheDocument();
    const bar = screen.getByRole("region", { name: "Alterações no expediente" });
    expect(bar).toHaveTextContent("Há alterações não salvas no expediente.");

    fireEvent.click(screen.getByRole("button", { name: "Usar o horário de segunda nos dias úteis" }));
    expect(bar).toHaveTextContent("Horário de segunda (09:00–12:00 e 13:00–17:00) copiado para terça a sexta.");
    for (const day of ["Terça", "Quarta", "Quinta", "Sexta"]) {
      expect(within(screen.getByRole("group", { name: day })).getByText("09:00–12:00 e 13:00–17:00")).toBeInTheDocument();
    }
    expect(within(screen.getByRole("group", { name: "Sábado" })).getByText("09:00–14:00")).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole("button", { name: "Salvar expediente" }));
    expect(await within(toaster()).findByText("Expediente salvo.", undefined, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Alterações no expediente" })).not.toBeInTheDocument());
    expect(await within(await screen.findByRole("group", { name: "Sexta" }, SLOW)).findByText("09:00–12:00 e 13:00–17:00")).toBeInTheDocument();
  });

  it("sair com alteração não salva pergunta antes; Continuar editando fica, Sair sem salvar sai", async () => {
    const router = renderAt("/app/agenda/horarios");
    const monday = await screen.findByRole("group", { name: "Segunda" }, SLOW);
    fireEvent.click(within(monday).getByRole("button", { name: "Editar Segunda" }));
    fireEvent.click(within(monday).getAllByRole("button", { name: /^Remover/ })[1]!);
    act(() => void router.navigate("/app/agenda"));
    const question = await screen.findByText("Sair sem salvar?");
    await waitFor(() => expect(question.closest("p")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
    expect(router.state.location.pathname).toBe("/app/agenda/horarios");
    expect(within(monday).getByText("09:00–12:00")).toBeInTheDocument();

    act(() => void router.navigate("/app/agenda"));
    fireEvent.click(await screen.findByRole("button", { name: "Sair sem salvar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/agenda"));
  });

  it("sem alteração, sair não pergunta nada", async () => {
    const router = renderAt("/app/agenda/horarios");
    await screen.findByRole("group", { name: "Segunda" }, SLOW);
    act(() => void router.navigate("/app/agenda"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/agenda"));
  });
});

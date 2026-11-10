// P48 · "Atendido" leva a receber: o mesmo atendimento atravessa a Agenda (ou a Hoje) e o Caixa da demonstração.
// Fica em src/app porque junta dois módulos (Agenda e Caixa), como a tela Hoje; cada módulo continua sem importar o outro.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast } from "../../components/ui/index.tsx";
import { getDemoPort as getFinanceDemoPort, resetDemoPort as resetFinanceDemoPort } from "../../features/finance/module.tsx";
import { pendingPeriod } from "../../features/finance/money.ts";
import { createFixturePort } from "../../features/scheduling/fixturePort.ts";
import { resetDemoPort } from "../../features/scheduling/SchedulingLayout.tsx";
import { completionEventId, provideDemoCollect, publishCompletedVisit, resetDemoJourney } from "../../lib/demo/journey.ts";
import { receivedPeriods } from "../../lib/time.ts";
import { routes } from "../router.tsx";
import { SessionProvider } from "../session.tsx";

const FIRST = "60000000-0000-4000-8000-000000000001"; // terça 09:00, Corte da Ana (R$ 60,00), já começou no relógio da demonstração
const SLOW = { timeout: 5000 };
const TZ = "America/Sao_Paulo";
const toaster = () => document.querySelector<HTMLElement>(".tn-toaster")!;

/** A Agenda da demonstração como a do app: a conclusão segue para o Caixa da aba (sem cobrança até o dono cobrar). */
function demoAgenda() {
  return createFixturePort({
    onCompleted: (b) =>
      publishCompletedVisit({
        booking_id: b.id, customer_id: b.customer_id, service_id: b.service_id, starts_at: b.starts_at, ends_at: b.ends_at,
        agreed_price_cents: b.agreed_price_cents, completed_event_id: completionEventId(b.id),
      }),
  });
}

function renderAt(path: string) {
  const agenda = demoAgenda();
  resetDemoPort(agenda);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SessionProvider client={null}>
      <RouterProvider router={router} />
    </SessionProvider>,
  );
  return { agenda, router };
}

beforeEach(() => {
  resetFinanceDemoPort();
  resetDemoJourney();
});
afterEach(() => {
  resetDemoPort();
  resetFinanceDemoPort();
  resetDemoJourney();
  provideDemoCollect(getFinanceDemoPort);
  act(() => dismissToast());
});

async function openExits() {
  fireEvent.click(await screen.findByRole("button", { name: "Atendido" }, SLOW));
  const group = screen.getByRole("group", { name: "Atendido. Como fica o pagamento?" });
  // O crédito do pacote chega depois da leitura do Caixa; espera a tela assentar.
  await within(group).findByRole("button", { name: /^Usar crédito do pacote/ }, SLOW);
  return within(group);
}

describe("Atendido → receber, no detalhe do atendimento (P48)", () => {
  it("Recebi R$ 60,00 no Pix: um toque conclui, cobra e registra o recebimento; o toque duplo não duplica", async () => {
    const fin = getFinanceDemoPort();
    const charge = vi.spyOn(fin, "chargeBooking");
    const pay = vi.spyOn(fin, "recordPayment");
    const { agenda } = renderAt(`/app/agenda/atendimento/${FIRST}`);
    const complete = vi.spyOn(agenda, "complete");
    const exits = await openExits();
    const receive = exits.getByRole("button", { name: /^Recebi R\$\s60,00 no Pix$/ });
    await act(async () => {
      fireEvent.click(receive);
      fireEvent.click(receive);
    });
    expect(await within(toaster()).findByText(/^Atendimento concluído e R\$\s60,00 recebido no Pix\. Registro manual no Caixa\.$/, undefined, SLOW)).toBeInTheDocument();
    // Concluir ≠ receber no servidor: três operações, cada uma uma vez e com chave.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({ booking_id: FIRST, expected_version: expect.any(Number) }, expect.any(String));
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith({ booking_id: FIRST }, expect.any(String));
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay.mock.calls[0]![0]).toMatchObject({ amount_cents: 6000, method: "pix" });
    expect(await screen.findByText("Concluído", undefined, SLOW)).toBeInTheDocument();
    // No Caixa da aba: não está mais sem cobrança e o recebido de hoje é R$ 60,00.
    const today = "2026-10-20";
    expect((await fin.uncharged(pendingPeriod(today, TZ))).some((b) => b.booking_id === FIRST)).toBe(false);
    expect((await fin.summary(receivedPeriods(today, TZ).day, TZ)).received_cents).toBe(6000);
  });

  it("▾ troca a forma antes do toque: Recebi R$ 60,00 em dinheiro", async () => {
    const pay = vi.spyOn(getFinanceDemoPort(), "recordPayment");
    renderAt(`/app/agenda/atendimento/${FIRST}`);
    const exits = await openExits();
    fireEvent.click(exits.getByRole("button", { name: "Outra forma de pagamento" }));
    fireEvent.click(exits.getByRole("radio", { name: "Dinheiro" }));
    await act(async () => { fireEvent.click(exits.getByRole("button", { name: /^Recebi R\$\s60,00 em dinheiro$/ })); });
    await waitFor(() => expect(pay).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 6000, method: "cash" }), expect.any(String)));
  });

  it("Cobrar depois: conclui e deixa a cobrança em \"A receber\", sem recebimento", async () => {
    const fin = getFinanceDemoPort();
    const pay = vi.spyOn(fin, "recordPayment");
    renderAt(`/app/agenda/atendimento/${FIRST}`);
    const exits = await openExits();
    await act(async () => { fireEvent.click(exits.getByRole("button", { name: "Cobrar depois" })); });
    expect(await within(toaster()).findByText(/Cobrança de R\$\s60,00 em "A receber"/, undefined, SLOW)).toBeInTheDocument();
    expect(pay).not.toHaveBeenCalled();
    const ledger = await fin.ledger(receivedPeriods("2026-10-20", TZ).month);
    expect(ledger.receivables.filter((r) => r.booking_id === FIRST && r.status === "open")).toHaveLength(1);
  });

  it("Usar crédito do pacote: conclui e debita uma sessão pelo evento de conclusão; nada entra no caixa", async () => {
    const fin = getFinanceDemoPort();
    const consume = vi.spyOn(fin, "consumePackage");
    const charge = vi.spyOn(fin, "chargeBooking");
    renderAt(`/app/agenda/atendimento/${FIRST}`);
    const exits = await openExits();
    await act(async () => { fireEvent.click(exits.getByRole("button", { name: "Usar crédito do pacote (4 restantes)" })); });
    expect(await within(toaster()).findByText(/Saldo: 3 sessões\. Nenhum valor novo entra no caixa\./, undefined, SLOW)).toBeInTheDocument();
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({ booking_id: FIRST, event_id: completionEventId(FIRST) }), expect.any(String));
    expect(charge).not.toHaveBeenCalled();
  });

  it("Caixa falhou depois de concluir: o aviso diz o que aconteceu e \"Abrir no Caixa\" leva ao atendimento, já com o recebimento aberto", async () => {
    vi.spyOn(getFinanceDemoPort(), "recordPayment").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    const { router } = renderAt(`/app/agenda/atendimento/${FIRST}`);
    const exits = await openExits();
    await act(async () => { fireEvent.click(exits.getByRole("button", { name: /^Recebi R\$\s60,00 no Pix$/ })); });
    const message = await within(toaster()).findByText(/^Atendimento concluído, mas o Caixa não registrou: Sem resposta do servidor\./, undefined, SLOW);
    expect(message).toBeInTheDocument();
    // O detalhe aponta o Caixa no próprio atendimento.
    expect(await screen.findByRole("link", { name: "Cobrar no Caixa" }, SLOW)).toHaveAttribute("href", `/app/caixa?atendimento=${FIRST}`);
    await act(async () => { fireEvent.click(within(toaster()).getByRole("button", { name: "Abrir no Caixa" })); });
    expect(router.state.location.pathname).toBe("/app/caixa");
    expect(router.state.location.search).toBe(`?atendimento=${FIRST}`);
    // A cobrança foi criada (o primeiro registro passou): o recebimento dela abre direto, com o foco no valor.
    const open = within(await screen.findByRole("region", { name: "A receber" }, SLOW));
    const item = open.getAllByRole("listitem").find((li) => li.getAttribute("data-focus") === "true")!;
    expect(item).toBeDefined();
    await waitFor(() => expect(within(item).getByLabelText("Valor recebido (R$)")).toHaveFocus());
  });

  it("sem acesso ao Caixa: volta à confirmação que só conclui, e o Caixa fica a um link", async () => {
    provideDemoCollect(null);
    renderAt(`/app/agenda/atendimento/${FIRST}`);
    fireEvent.click(await screen.findByRole("button", { name: "Atendido" }, SLOW));
    expect(screen.getByText("Isso registra que o atendimento aconteceu. Não registra pagamento.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Recebi/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sim, foi atendido" }));
    expect(await within(toaster()).findByText(/O pagamento não foi registrado/, undefined, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Cobrar no Caixa" }, SLOW)).toHaveAttribute("href", `/app/caixa?atendimento=${FIRST}`);
  });
});

describe("Atendido no cartão da Agenda e no \"Próximo\" da Hoje (P48)", () => {
  it("cartão do dia: as mesmas saídas, com o horário no nome de cada botão", async () => {
    renderAt("/app/agenda");
    const list = await screen.findByRole("list", { name: /Linha do tempo/ }, SLOW);
    fireEvent.click(within(list).getByRole("button", { name: "Atendido às 09:00" }));
    const group = within(list).getByRole("group", { name: "Atendido às 09:00. Como fica o pagamento?" });
    expect(within(group).getByRole("button", { name: /^Recebi R\$\s60,00 no Pix\s?· às 09:00$/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /^Cobrar depois\s?às 09:00$/ })).toBeInTheDocument();
  });

  it("Hoje: o Próximo que já começou tem Atendido e Faltou; Recebi conclui, registra e o Próximo passa ao seguinte", async () => {
    renderAt("/app");
    const next = await screen.findByRole("region", { name: /^Próximo:/ }, SLOW);
    expect(next).toHaveAccessibleName("Próximo: 09:00 · Cliente Exemplo Ana · agora");
    expect(within(next).getByRole("button", { name: "Faltou às 09:00" })).toBeInTheDocument();
    // Com as ações do atendimento à vista, "Abrir" deixa de ser o botão principal.
    expect(within(next).getByRole("link", { name: /^Abrir/ })).toHaveAttribute("data-variant", "secondary");
    fireEvent.click(within(next).getByRole("button", { name: "Atendido às 09:00" }));
    const receive = await within(next).findByRole("button", { name: /^Recebi R\$\s60,00 no Pix\s?· às 09:00$/ });
    await act(async () => { fireEvent.click(receive); });
    expect(await within(toaster()).findByText(/^Atendimento concluído e R\$\s60,00 recebido no Pix às 09:00\./, undefined, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Próximo:/ })).not.toHaveAccessibleName(/09:00/), SLOW);
    const week = within(screen.getByRole("group", { name: "Resumo" })).getByRole("link", { name: /^Recebido na semana/ });
    expect(week).toHaveTextContent(/no mês: R\$\s1\.800,00$/);
  });
});

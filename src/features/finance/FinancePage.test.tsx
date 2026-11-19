import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { FX } from "@contracts/fixtures.ts";
import { demoUncharged } from "../../lib/demo/dataset.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import { FinancePage, FinancePortProvider } from "./FinancePage.tsx";

afterEach(() => act(() => dismissToast()));

function renderPage(path = "/app/caixa") {
  const port = createDemoPort();
  render(
    <MemoryRouter initialEntries={[path]}>
      <FinancePortProvider value={port}>
        <FinancePage />
      </FinancePortProvider>
      <Toaster />
    </MemoryRouter>,
  );
  return port;
}

/** Relógio que anda a cada leitura, como no servidor: na demonstração ele é fixo e esconde o defeito. */
function tickingClock(port: ReturnType<typeof createDemoPort>) {
  const start = port.now().getTime();
  let ticks = 0;
  vi.spyOn(port, "now").mockImplementation(() => new Date(start + (ticks += 1) * 1000));
}

describe("Caixa: nova tentativa depois de falha de rede não grava em dobro", () => {
  it("recebimento de hoje: a segunda tentativa sai com a mesma chave e o mesmo corpo", async () => {
    const port = renderPage();
    tickingClock(port);
    const pay = vi.spyOn(port, "recordPayment").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    const open = within(await screen.findByRole("region", { name: "A receber" }));
    fireEvent.click(open.getAllByRole("button", { name: /^Registrar recebimento/ })[0]!);
    const submit = open.getByRole("button", { name: "Registrar pagamento" });
    await act(async () => { fireEvent.click(submit); });
    expect(open.getByText(/Tentar de novo é seguro/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(submit); });
    expect(pay).toHaveBeenCalledTimes(2);
    const [firstBody, firstKey] = pay.mock.calls[0]!;
    const [secondBody, secondKey] = pay.mock.calls[1]!;
    expect(secondKey).toBe(firstKey);
    expect(secondBody).toEqual(firstBody);
  });

  it("despesa de hoje: a segunda tentativa sai com a mesma chave e o mesmo corpo", async () => {
    const port = renderPage();
    tickingClock(port);
    const expense = vi.spyOn(port, "recordExpense").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Despesa" }));
    const form = within(await screen.findByRole("form", { name: "Nova despesa" }));
    fireEvent.change(form.getByLabelText("Valor da despesa (R$)"), { target: { value: "45,00" } });
    const submit = form.getByRole("button", { name: "Registrar despesa" });
    await act(async () => { fireEvent.click(submit); });
    expect(form.getByText(/Tentar de novo é seguro/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(submit); });
    expect(expense).toHaveBeenCalledTimes(2);
    expect(expense.mock.calls[1]![1]).toBe(expense.mock.calls[0]![1]);
    expect(expense.mock.calls[1]![0]).toEqual(expense.mock.calls[0]![0]);
  });

  it("valor diferente é outro pedido: chave nova", async () => {
    const port = renderPage();
    tickingClock(port);
    const pay = vi.spyOn(port, "recordPayment").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    const open = within(await screen.findByRole("region", { name: "A receber" }));
    fireEvent.click(open.getAllByRole("button", { name: /^Registrar recebimento/ })[0]!);
    const submit = open.getByRole("button", { name: "Registrar pagamento" });
    await act(async () => { fireEvent.click(submit); });
    fireEvent.change(open.getByLabelText("Valor recebido (R$)"), { target: { value: "1,00" } });
    await act(async () => { fireEvent.click(submit); });
    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[1]![1]).not.toBe(pay.mock.calls[0]![1]);
  });
});

describe("Caixa: validação no envio, confirmação e aviso", () => {
  it("cobrança sem descrição e valor: erros embaixo de cada campo e foco no primeiro", async () => {
    const port = renderPage();
    const create = vi.spyOn(port, "createReceivable");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    fireEvent.click(screen.getByRole("radio", { name: "A receber" }));
    const form = within(await screen.findByRole("form", { name: "Nova cobrança" }));
    const submit = form.getByRole("button", { name: "Criar cobrança" });
    expect(submit).toBeEnabled();
    await act(async () => { fireEvent.click(submit); });
    expect(form.getByText("Descreva a cobrança.")).toBeInTheDocument();
    expect(form.getByText("Informe o valor.")).toBeInTheDocument();
    expect(form.getByLabelText("Descrição")).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it("estorno não acontece sem confirmar; confirmado, o aviso aparece no Toast", async () => {
    const port = renderPage();
    const reverse = vi.spyOn(port, "reversePayment");
    const payments = within(await screen.findByRole("region", { name: "Recebimentos no mês" }));
    fireEvent.click(payments.getAllByRole("button", { name: /^Estornar recebimento/ })[0]!);
    const confirm = payments.getByRole("group", { name: /Estornar recebimento de .*\?/ });
    expect(confirm).toHaveTextContent("O registro original continua no histórico.");
    // Sem motivo, o botão explica e não estorna.
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Sim, estornar" })); });
    expect(reverse).not.toHaveBeenCalled();
    expect(confirm).toHaveTextContent("Escreva o motivo do estorno.");
    fireEvent.change(within(confirm).getByLabelText("Motivo do estorno"), { target: { value: "Pago em dobro" } });
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Sim, estornar" })); });
    expect(reverse).toHaveBeenCalledWith(expect.objectContaining({ reason: "Pago em dobro" }), expect.any(String));
    expect((await screen.findByText(/estornado\. O registro original continua no histórico\./)).closest(".tn-toaster")).not.toBeNull();
  });

  it("formulários fechados até tocar em Registrar; abre no lugar com foco no primeiro campo", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    expect(screen.queryByRole("form")).toBeNull();
    const open = screen.getByRole("button", { name: "Registrar" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    // P48: abre em "Recebi" (valor, forma, cliente opcional), antes de Despesa, A receber e Pacote.
    expect(within(screen.getByRole("group", { name: "O que registrar" })).getAllByRole("radio").map((r) => r.closest("label")?.textContent))
      .toEqual(["Recebi", "Despesa", "A receber", "Pacote"]);
    expect(screen.getByRole("radio", { name: "Recebi" })).toBeChecked();
    expect(within(screen.getByRole("form", { name: "Novo recebimento" })).getByLabelText("Valor recebido (R$)")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("atalho “Recebi R$ 40,00 no Pix ▾”: troca a forma e registra cobrança e recebimento num toque", async () => {
    const port = renderPage();
    const pay = vi.spyOn(port, "recordPayment");
    const pending = within(await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" }));
    const bruno = within(pending.getAllByRole("listitem").find((li) => li.textContent?.includes("Bruno"))!);
    expect(bruno.getByRole("button", { name: /^Recebi R\$\s?40,00 no Pix/ })).toBeInTheDocument();
    fireEvent.click(bruno.getByRole("button", { name: /Outra forma de pagamento/ }));
    fireEvent.click(bruno.getByRole("radio", { name: "Cartão" }));
    await act(async () => { fireEvent.click(bruno.getByRole("button", { name: /^Recebi R\$\s?40,00 no cartão/ })); });
    expect(pay).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 4000, method: "card" }), expect.any(String));
    expect(await screen.findByText(/Recebido R\$\s?40,00 \(Cartão\)/)).toBeInTheDocument();
  });
});

describe("Caixa: uma ação não desmonta a tela (revisão 10/11, fe-modulos-a-05)", () => {
  it("depois de 'Cobrar depois', 'Ver mais' continua aberto, o formulário aberto fica e o foco vai para o título da seção", async () => {
    renderPage();
    const pending = await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    // "Ver mais" aberto nos recebimentos do mês.
    const payments = within(screen.getByRole("region", { name: "Recebimentos no mês" }));
    fireEvent.click(payments.getByRole("button", { name: /^Ver mais \d+ recebimentos$/ }));
    expect(payments.queryByRole("button", { name: /^Ver mais/ })).toBeNull();
    // Um formulário de recebimento aberto, com valor digitado.
    const open = within(screen.getByRole("region", { name: "A receber" }));
    fireEvent.click(open.getAllByRole("button", { name: /^Registrar recebimento/ })[0]!);
    fireEvent.change(open.getByLabelText("Valor recebido (R$)"), { target: { value: "12,34" } });

    const bruno = within(pending).getAllByRole("listitem").find((li) => /Bruno/.test(li.textContent ?? "") && /19\/10\/2026/.test(li.textContent ?? ""))!;
    const later = within(bruno).getByRole("button", { name: /Cobrar depois/ });
    later.focus();
    await act(async () => { fireEvent.click(later); });
    expect(await screen.findByText(/Cobrança de R\$\s?40,00 criada/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Atendimentos concluídos sem cobrança" })).getAllByRole("listitem")).toHaveLength(2));
    // A mesma seção (não foi desmontada e montada de novo).
    expect(pending).toBeInTheDocument();

    expect(screen.queryByText("Carregando o mês…")).toBeNull();
    expect(payments.queryByRole("button", { name: /^Ver mais/ })).toBeNull();
    expect(open.getByLabelText("Valor recebido (R$)")).toHaveValue("12,34");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Atendimentos concluídos sem cobrança" }));
  });

  it("trocar de mês ainda mostra 'Carregando o mês…' até o mês novo chegar", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(screen.getByText("Carregando o mês…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Caixa registrado em setembro de 2026" })).toBeInTheDocument();
  });
});

describe("Caixa: pendência não tem mês (revisão 10/11, ux-nucleo-celular-03)", () => {
  it("o atendimento de setembro sem cobrança aparece em outubro, do mais novo ao mais antigo", async () => {
    renderPage();
    const pending = within(await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" }));
    const items = pending.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/19\/10\/2026.*40,00/);
    expect(items[1]).toMatch(/19\/10\/2026.*60,00/);
    expect(items[2]).toMatch(/Bruno.*28\/09\/2026.*60,00/);
  });

  it("trocar o mês muda o caixa registrado, não as pendências", async () => {
    const port = renderPage();
    const uncharged = vi.spyOn(port, "uncharged");
    await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" });
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(await screen.findByRole("heading", { name: "Caixa registrado em setembro de 2026" })).toBeInTheDocument();
    const pending = within(screen.getByRole("region", { name: "Atendimentos concluídos sem cobrança" }));
    expect(pending.getAllByRole("listitem")).toHaveLength(3);
    // O mesmo período aberto (um ano até o fim de hoje), seja qual for o mês escolhido.
    expect(uncharged).toHaveBeenLastCalledWith({ starts_at: "2025-10-20T03:00:00.000Z", ends_at: "2026-10-21T03:00:00.000Z" });
  });
});

describe("Caixa: Hoje · Semana · Mês e Recebi (P48)", () => {
  it("no topo, o recebido de hoje, da semana e do mês, cada um com o período escrito", async () => {
    const port = renderPage();
    const summary = vi.spyOn(port, "summary");
    const strip = within(await screen.findByRole("region", { name: "Recebido" }));
    await waitFor(() => expect(strip.queryByText("…")).toBeNull());
    const rows = strip.getAllByRole("term").map((dt) => `${dt.textContent} = ${dt.nextElementSibling?.textContent}`);
    // Demonstração: terça 20/10, 09:00. Semana desde segunda 19/10; o mês é o mesmo do resumo de outubro.
    expect(rows).toEqual([
      expect.stringMatching(/^Hoje20\/10 = R\$\s0,00$/),
      expect.stringMatching(/^Semana19\/10 a 20\/10 = R\$\s[\d.]+,\d\d$/),
      expect.stringMatching(/^MêsOutubro de 2026 = R\$\s1\.740,00$/),
    ]);
    // Três períodos, sem campo novo no contrato: a semana é uma chamada a mais de finance.summary.
    const periods = summary.mock.calls.map(([p]) => p);
    expect(periods).toEqual(expect.arrayContaining([
      { starts_at: "2026-10-20T00:00:00-03:00", ends_at: "2026-10-21T00:00:00-03:00" },
      { starts_at: "2026-10-19T00:00:00-03:00", ends_at: "2026-10-21T00:00:00-03:00" },
    ]));
  });

  it("Recebi registra cobrança e recebimento; o valor de hoje sobe; nova tentativa usa as mesmas chaves", async () => {
    const port = renderPage();
    tickingClock(port);
    const create = vi.spyOn(port, "createReceivable");
    const pay = vi.spyOn(port, "recordPayment").mockRejectedValueOnce({ code: "PROVIDER_UNAVAILABLE" });
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));
    const form = within(screen.getByRole("form", { name: "Novo recebimento" }));
    fireEvent.change(form.getByLabelText("Valor recebido (R$)"), { target: { value: "25" } });
    fireEvent.change(form.getByLabelText("Forma"), { target: { value: "cash" } });
    fireEvent.change(form.getByLabelText("Cliente (opcional)"), { target: { value: FX.customers.abInA } });
    const submit = form.getByRole("button", { name: "Salvar recebimento" });
    await act(async () => { fireEvent.click(submit); });
    expect(form.getByText(/Tentar de novo é seguro/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(submit); });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![1]).toBe(create.mock.calls[0]![1]);
    expect(create.mock.calls[0]![0]).toEqual({ description: "Recebimento avulso", amount_cents: 2500, customer_id: FX.customers.abInA });
    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[1]![1]).toBe(pay.mock.calls[0]![1]);
    expect(pay.mock.calls[1]![0]).toEqual(pay.mock.calls[0]![0]);
    expect(pay.mock.calls[1]![0]).toMatchObject({ amount_cents: 2500, method: "cash" });
    expect(await screen.findByText(/Recebimento de R\$\s?25,00 registrado \(Dinheiro, manual\)/)).toBeInTheDocument();
    const strip = within(screen.getByRole("region", { name: "Recebido" }));
    await waitFor(() => expect(strip.getAllByRole("definition")[0]).toHaveTextContent(/R\$\s25,00/));
  });

  it("?atendimento=<id> (vindo da Agenda): marca o atendimento sem cobrança e põe o foco em Recebi", async () => {
    const visit = demoUncharged().find((v) => v.starts_at.startsWith("2026-09"))!;
    renderPage(`/app/caixa?atendimento=${visit.id}`);
    const pending = within(await screen.findByRole("region", { name: "Atendimentos concluídos sem cobrança" }));
    const target = pending.getAllByRole("listitem").find((li) => li.getAttribute("data-focus") === "true");
    expect(target).toHaveTextContent("28/09/2026");
    await waitFor(() => expect(within(target!).getByRole("button", { name: /^Recebi R\$/ })).toHaveFocus());
  });
});

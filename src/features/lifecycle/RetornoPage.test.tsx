import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleStep } from "@contracts";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import type { LifecyclePort } from "./port.ts";
import { createDemoReturnSource, type ReturnBoard, type ReturnSource, summarizeWaitlist } from "./retorno.ts";
import { RetornoPage } from "./RetornoPage.tsx";

beforeEach(() => resetDemoState());
afterEach(() => dismissToast());

const renderPage = (port: LifecyclePort, source: ReturnSource) =>
  render(
    <MemoryRouter>
      <RetornoPage port={port} source={source} />
      <Toaster />
    </MemoryRouter>,
  );
const block = (name: string) => screen.getByRole("region", { name });
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function step(n: number, over: Partial<LifecycleStep> = {}): LifecycleStep {
  return {
    id: `f3000000-0000-4000-8000-${String(n).padStart(12, "0")}`, rule: "reminder", step_key: "v1-h24", aggregate_type: "booking",
    aggregate_id: `f1000000-0000-4000-8000-${String(n).padStart(12, "0")}`, customer_id: id(n), customer_name: `Pessoa ${n}`, campaign_id: null,
    due_at: "2026-10-20T12:00:00Z", status: "manual", skip_reason: null, template_code: "lembrete_agendamento", body: `Lembrete ${n}: Corte amanhã às 10:00.`,
    channel_message_id: null, message_status: null, resolved_at: null, created_at: "2026-10-19T12:00:00Z", version: 1, ...over,
  };
}
/** Porta mínima: só o que a aba Retorno lê e grava. */
function fakePort(steps: LifecycleStep[]): LifecyclePort {
  const demo = createDemoPort();
  return { ...demo, kind: "server", steps: vi.fn(async () => ({ steps, counts: { manual: steps.length } })), markShared: vi.fn(async () => steps[0]!) };
}
function fakeSource(over: Partial<ReturnBoard> = {}): ReturnSource {
  return {
    kind: "server",
    board: vi.fn(async () => ({
      timezone: "America/Sao_Paulo",
      now: "2026-10-20T12:00:00Z",
      business: "Barbearia Teste",
      customers: [],
      visits: { since: "2026-04-23T00:00:00Z", complete: true, byCustomer: {} },
      waitlist: { waiting: 0, openSlots: 0 },
      ...over,
    })),
  };
}

describe("aba Retorno (P49, D2 b)", () => {
  it("três blocos nesta ordem: lembretes a mandar, quem não volta, lista de espera", async () => {
    renderPage(createDemoPort(), createDemoReturnSource());
    expect(await screen.findByRole("heading", { name: "Retorno", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Lembretes a mandar", "Quem não volta", "Lista de espera"]);
    expect(screen.getByText(/Demonstração\./)).toBeInTheDocument();
  });

  it("demonstração: a confirmação do Carlos com o texto pronto e o WhatsApp; orçamento parado fica fora", async () => {
    renderPage(createDemoPort(), createDemoReturnSource());
    const list = await within(block("Lembretes a mandar")).findByRole("list", { name: "Lembretes a mandar" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    const item = within(items[0]!);
    expect(item.getByRole("heading", { level: 3 })).toHaveTextContent("Confirmação · Carlos (exemplo)");
    const body = "Olá, Carlos (exemplo)! Seu horário de Barba está confirmado para";
    expect(items[0]).toHaveTextContent(body);
    expect(items[0]).toHaveTextContent("Para você compartilhar");
    const link = item.getByRole("link", { name: "Mandar no WhatsApp para Carlos (exemplo)" });
    // Sem telefone no cadastro: o WhatsApp abre com o texto e pede o contato.
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=Ol%C3%A1%2C%20Carlos/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(items[0]).toHaveTextContent("Sem WhatsApp no cadastro");
    expect(block("Lembretes a mandar")).not.toHaveTextContent("orçamento");
    // "Enviado" só aparece negado ("nada é enviado"); o bloco fala em compartilhar.
    expect(block("Lembretes a mandar")).not.toHaveTextContent(/enviad[oa]/i);
  });

  it("abrir o WhatsApp marca como compartilhado (sem dizer enviado) e o bloco fica com a frase de vazio", async () => {
    const port = createDemoPort();
    const markShared = vi.spyOn(port, "markShared");
    renderPage(port, createDemoReturnSource());
    const link = await screen.findByRole("link", { name: "Mandar no WhatsApp para Carlos (exemplo)" });
    await act(async () => { fireEvent.click(link); });
    expect(markShared).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Marcado como compartilhado por você; compartilhar não confirma que chegou/)).toBeInTheDocument();
    expect(await within(block("Lembretes a mandar")).findByText(/Nenhum lembrete esperando você/)).toBeInTheDocument();
    expect((await port.steps("shared")).steps.map((s) => s.customer_name)).toEqual(["Carlos (exemplo)"]);
  });

  it("demonstração: Rita não volta desde 25/08; quem tem horário marcado não entra", async () => {
    renderPage(createDemoPort(), createDemoReturnSource());
    const list = await within(block("Quem não volta")).findByRole("list", { name: "Quem não volta" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Rita (exemplo)");
    expect(items[0]).toHaveTextContent("Última visita há 56 dias · 25/08/2026");
    expect(within(items[0]!).getByRole("link", { name: "Rita (exemplo)" })).toHaveAttribute("href", "/app/clientes/30000000-0000-4000-8000-0000000000a5");
    expect(items[0]).toHaveTextContent("Sem WhatsApp no cadastro");
    expect(block("Quem não volta")).not.toHaveTextContent("Carlos");
    // Lista de espera de outro módulo não é lida na demonstração: o bloco dá o caminho.
    expect(within(block("Lista de espera")).getByRole("link", { name: "Abrir a lista de espera" })).toHaveAttribute("href", "/app/lista-de-espera");
  });

  it("com telefone: lembrete abre a conversa com o texto e quem não volta tem “Chamar no WhatsApp”, quem sumiu há menos tempo primeiro", async () => {
    const people = [1, 2, 3].map((n) => ({ id: id(n), name: `Pessoa ${n}`, phone: n === 3 ? null : `+551199999000${n}` }));
    const source = fakeSource({
      customers: people,
      visits: {
        since: "2026-04-23T00:00:00Z", complete: true,
        byCustomer: {
          [id(1)]: { last_visit_at: "2026-08-01T13:00:00Z", next_at: null },
          [id(2)]: { last_visit_at: "2026-09-15T13:00:00Z", next_at: null },
          [id(3)]: { last_visit_at: "2026-10-10T13:00:00Z", next_at: null },
        },
      },
      waitlist: { waiting: 2, openSlots: 1 },
    });
    renderPage(fakePort([step(1)]), source);
    const reminder = await screen.findByRole("link", { name: "Mandar no WhatsApp para Pessoa 1" });
    expect(reminder).toHaveAttribute("href", `https://wa.me/5511999990001?text=${encodeURIComponent("Lembrete 1: Corte amanhã às 10:00.")}`);
    const lapsed = within(await within(block("Quem não volta")).findByRole("list", { name: "Quem não volta" })).getAllByRole("listitem");
    expect(lapsed.map((li) => within(li).getAllByRole("link")[0]!.textContent)).toEqual(["Pessoa 2", "Pessoa 1"]);
    expect(lapsed[0]).toHaveTextContent("Última visita há 35 dias");
    expect(within(lapsed[1]!).getByRole("link", { name: "Chamar Pessoa 1 no WhatsApp" })).toHaveAttribute("href", "https://wa.me/5511999990001");
    expect(within(block("Lista de espera")).getByText("2 pessoas esperando vaga · 1 vaga liberada para oferecer")).toBeInTheDocument();
  });

  it("cada bloco vazio tem uma frase", async () => {
    renderPage(fakePort([]), fakeSource());
    expect(await within(block("Lembretes a mandar")).findByText(/Nenhum lembrete esperando você/)).toBeInTheDocument();
    expect(await within(block("Quem não volta")).findByText(/Ninguém sumido/)).toBeInTheDocument();
    expect(within(block("Lista de espera")).getByText("Ninguém na lista de espera agora.")).toBeInTheDocument();
  });

  it("mais de cinco: mostra cinco e “Ver todos” leva a Clientes já filtrado", async () => {
    const people = [1, 2, 3, 4, 5, 6].map((n) => ({ id: id(n), name: `Pessoa ${n}`, phone: null }));
    const byCustomer = Object.fromEntries(people.map((p, i) => [p.id, { last_visit_at: `2026-08-0${i + 1}T13:00:00Z`, next_at: null }]));
    renderPage(fakePort([1, 2, 3, 4, 5, 6].map((n) => step(n))), fakeSource({ customers: people, visits: { since: "2026-04-23T00:00:00Z", complete: true, byCustomer } }));
    const lapsed = await within(block("Quem não volta")).findByRole("list", { name: "Quem não volta" });
    expect(within(lapsed).getAllByRole("listitem")).toHaveLength(5);
    expect(within(block("Quem não volta")).getByRole("link", { name: "Ver todos (6)" })).toHaveAttribute("href", "/app/clientes?filtro=sem-voltar");
    expect(within(block("Lembretes a mandar")).getAllByRole("listitem")).toHaveLength(5);
    expect(within(block("Lembretes a mandar")).getByRole("link", { name: "Ver todos (6)" })).toHaveAttribute("href", "/app/relacionamento");
  });

  it("falha na leitura da agenda não derruba os lembretes", async () => {
    const source: ReturnSource = { kind: "server", board: vi.fn(async () => Promise.reject(new Error("fora"))) };
    renderPage(fakePort([step(1)]), source);
    expect(await screen.findByRole("link", { name: "Mandar no WhatsApp para Pessoa 1" })).toBeInTheDocument();
    await waitFor(() => expect(block("Quem não volta")).toHaveTextContent("Não deu para ler a agenda agora."));
    expect(within(block("Lista de espera")).getByRole("link", { name: "Abrir a lista de espera" })).toBeInTheDocument();
  });

  it("resumo da lista de espera conta quem espera e as vagas ainda não oferecidas", () => {
    const entry = (status: "active" | "offered" | "fulfilled" | "withdrawn" | "expired") => ({ id: id(1), tenant_id: id(9), customer_id: id(2), service_id: id(3), status, joined_at: "2026-10-01T12:00:00Z", valid_until: "2026-11-01T12:00:00Z" });
    const slot = { starts_at: "2026-10-21T13:00:00Z", ends_at: "2026-10-21T13:30:00Z" };
    expect(summarizeWaitlist({
      entries: [entry("active"), entry("offered"), entry("fulfilled"), entry("withdrawn")],
      candidates: [{ id: id(4), entry_id: id(1), slot, status: "open" }, { id: id(5), entry_id: id(1), slot, status: "stale" }],
      offers: [],
    })).toEqual({ waiting: 2, openSlots: 1 });
  });
});

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { readDemoSetup } from "../../../supabase/functions/_shared/domain/setup/demo.ts";
import { describeBusiness } from "../../../supabase/functions/_shared/domain/setup/describe.ts";
import { resetDemoJourney } from "../../lib/demo/journey.ts";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import type { SetupPort } from "./port.ts";
import { SetupPage } from "./SetupPage.tsx";

beforeEach(() => {
  resetDemoState();
  resetDemoJourney();
});
afterEach(() => act(() => dismissToast()));

const renderPage = (port: SetupPort, hash = "") =>
  render(<MemoryRouter initialEntries={[`/app/configurar${hash}`]}><SetupPage port={port} /><Toaster /></MemoryRouter>);
const click = async (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("Configuração: passos, frase do negócio e modelos", () => {
  it("lista os 8 passos com por quê e link; opcional dispensa e volta; obrigatório não tem 'Agora não'", async () => {
    const port = createDemoPort();
    renderPage(port);
    const list = within(await screen.findByRole("list", { name: "Passos da configuração" }));
    const items = list.getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[3]).toHaveTextContent("Publicar seu perfil e mandar o link");
    expect(within(items[3]!).getByRole("link", { name: /Publicar perfil/ })).toHaveAttribute("href", "/app/perfil");
    expect(within(items[3]!).queryByRole("button", { name: "Agora não" })).not.toBeInTheDocument();
    expect(items[0]).toHaveTextContent("(feito)");
    await click(within(items[6]!).getByRole("button", { name: "Agora não" }));
    expect(await screen.findByText("Passo dispensado. Ele continua aqui, sem destaque.")).toBeInTheDocument();
    expect(items[6]).toHaveTextContent("dispensado");
    await click(within(items[6]!).getByRole("button", { name: "Voltar a mostrar" }));
    expect(items[6]).not.toHaveTextContent("dispensado");
  });

  it("frase → rascunho revisável; nada é salvo antes da confirmação; a confirmação resume o que vai ser gravado", async () => {
    const port = createDemoPort();
    const apply = vi.spyOn(port, "applyDraft");
    renderPage(port, "#descrever");
    await screen.findByRole("list", { name: "Passos da configuração" });
    type(screen.getByLabelText("Sua frase"), "Sou cabeleireira, sozinha, de terça a sábado das 9 às 18 com almoço das 12 às 13. Faço corte e escova.");
    await click(screen.getByRole("button", { name: "Montar rascunho" }));
    const form = within(screen.getByRole("form", { name: "Rascunho do seu negócio" }));
    expect(form.getByLabelText("Profissão")).toHaveValue("hairdresser");
    expect(form.getByRole("checkbox", { name: "Terça" })).toBeChecked();
    expect(form.getByRole("checkbox", { name: "Segunda" })).not.toBeChecked();
    // A pausa do almoço vira dois períodos no mesmo dia.
    expect(form.getByLabelText("Início")).toHaveValue("09:00");
    expect(form.getByLabelText("Fim")).toHaveValue("12:00");
    expect(form.getByLabelText("Início do 2º período")).toHaveValue("13:00");
    expect(form.getByLabelText("Fim do 2º período")).toHaveValue("18:00");
    // Serviços com a duração do modelo da profissão e a faixa como dica; o preço continua vazio (é do dono).
    expect(form.getByLabelText("Serviço 1")).toHaveValue("Corte");
    expect(form.getByLabelText("Serviço 2")).toHaveValue("Escova");
    expect(form.getAllByLabelText("Minutos").map((el) => (el as HTMLInputElement).value)).toEqual(["45", "40"]);
    expect(form.getAllByLabelText("Preço (R$)").map((el) => (el as HTMLInputElement).value)).toEqual(["", ""]);
    expect(form.getByText("Faixa de partida: R$ 40,00 a R$ 100,00.")).toBeInTheDocument();
    // A barbearia de exemplo já tem "Corte": o campo avisa, e ele não entra na gravação.
    expect(await form.findByText("Já no catálogo: não será criado de novo.")).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    // Sem preço, o botão explica embaixo do campo, com o nome do serviço, e nada é confirmado.
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    expect(form.getByText("Escova: informe a duração (entre 5 e 1440 minutos) e o preço em reais (ex.: 35,00).")).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    // O dono revisa: tira a Escova, muda o nome do corte e põe o preço.
    await click(form.getByRole("button", { name: "Tirar Escova" }));
    type(form.getByLabelText("Serviço 1"), "Corte feminino");
    type(form.getByLabelText("Preço (R$)"), "80,00");
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    const confirm = screen.getByRole("group", { name: "Salvar o rascunho?" });
    expect(confirm).toHaveTextContent("Profissão: Cabeleireira(o).");
    // Sem a Agenda da demonstração ligada, a confirmação não promete que a Agenda muda.
    expect(confirm).toHaveTextContent("Expediente: terça a sábado, 09:00 às 12:00 e 13:00 às 18:00 (na demonstração, fica só nesta tela: a Agenda de exemplo não muda).");
    expect(confirm).toHaveTextContent("Serviços: Corte feminino (45 min, R$ 80,00). Na demonstração, os serviços ficam só nesta tela.");
    expect(apply).not.toHaveBeenCalled();
    await click(within(confirm).getByRole("button", { name: "Salvar" }));
    expect(apply).toHaveBeenCalledWith({
      profession: "hairdresser",
      hours: [2, 3, 4, 5, 6].flatMap((weekday) => [{ weekday, local_start: "09:00", local_end: "12:00" }, { weekday, local_start: "13:00", local_end: "18:00" }]),
      services: [{ template_code: null, name: "Corte feminino", duration_min: 45, base_price_cents: 8000 }],
    }, expect.any(String));
    expect(await screen.findByText("Salvo: expediente de 5 dias e 1 serviço criado.")).toBeInTheDocument();
  });

  it("frase sem profissão nem horário: pede o que falta e não monta expediente", async () => {
    renderPage(createDemoPort());
    await screen.findByRole("list", { name: "Passos da configuração" });
    type(screen.getByLabelText("Sua frase"), "faço unhas em casa, dois dias por semana");
    await click(screen.getByRole("button", { name: "Montar rascunho" }));
    expect(screen.getByText("Não entendi a profissão, os dias, o horário. O motivo está em cada campo; complete abaixo.")).toBeInTheDocument();
    const form = within(screen.getByRole("form", { name: "Rascunho do seu negócio" }));
    // Cada recusa diz o campo e o motivo.
    expect(within(form.getByRole("list", { name: "Avisos de profissão" })).getByText("Não encontrei a profissão na frase. Escolha abaixo.")).toBeInTheDocument();
    expect(within(form.getByRole("list", { name: "Avisos de dias" })).getByText("Não encontrei os dias de atendimento na frase. Marque abaixo.")).toBeInTheDocument();
    expect(within(form.getByRole("list", { name: "Avisos de horário" })).getByText("Não encontrei um horário com início e fim na frase. Informe abaixo.")).toBeInTheDocument();
    expect(form.getByLabelText("Profissão")).toHaveValue("");
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    expect(form.getByText("Escolha a profissão.")).toBeInTheDocument();
  });

  it("P50 · personal com dois turnos e a domicílio: dois períodos por dia, aviso para conferir e grava os dois blocos", async () => {
    const port = createDemoPort();
    const apply = vi.spyOn(port, "applyDraft");
    renderPage(port);
    await screen.findByRole("list", { name: "Passos da configuração" });
    type(screen.getByLabelText("Sua frase"), "Sou personal trainer, atendo a domicílio de segunda a sexta das 6 às 12 e das 17 às 21");
    await click(screen.getByRole("button", { name: "Montar rascunho" }));
    const form = within(screen.getByRole("form", { name: "Rascunho do seu negócio" }));
    expect(form.getByLabelText("Início")).toHaveValue("06:00");
    expect(form.getByLabelText("Fim")).toHaveValue("12:00");
    expect(form.getByLabelText("Início do 2º período")).toHaveValue("17:00");
    expect(form.getByLabelText("Fim do 2º período")).toHaveValue("21:00");
    expect(form.getByText("Li dois períodos por dia: 06:00 às 12:00 e 17:00 às 21:00. Confira.")).toBeInTheDocument();
    expect(form.getByRole("link", { name: "Domicílio" })).toHaveAttribute("href", "/app/domicilio");
    // A frase não cita serviços: os modelos da profissão vêm como sugestão, com a duração do modelo.
    expect(form.queryByLabelText("Serviço 1")).not.toBeInTheDocument();
    await click(form.getByRole("button", { name: "Adicionar Sessão individual (60 min)" }));
    expect(form.getByLabelText("Minutos")).toHaveValue("60");
    expect(form.getByText("Faixa de partida: R$ 80,00 a R$ 200,00.")).toBeInTheDocument();
    type(form.getByLabelText("Preço (R$)"), "120");
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    const confirm = screen.getByRole("group", { name: "Salvar o rascunho?" });
    expect(confirm).toHaveTextContent("Expediente: segunda a sexta, 06:00 às 12:00 e 17:00 às 21:00");
    await click(within(confirm).getByRole("button", { name: "Salvar" }));
    expect(apply).toHaveBeenCalledWith({
      profession: "personal_trainer",
      hours: [1, 2, 3, 4, 5].flatMap((weekday) => [{ weekday, local_start: "06:00", local_end: "12:00" }, { weekday, local_start: "17:00", local_end: "21:00" }]),
      services: [{ template_code: "pt_sessao", name: "Sessão individual", duration_min: 60, base_price_cents: 12000 }],
    }, expect.any(String));
  });

  it("P50 · dias com horários diferentes viram grupos; negação aparece como aviso; serviço já no catálogo é marcado e fica de fora", async () => {
    const port = createDemoPort();
    const apply = vi.spyOn(port, "applyDraft");
    renderPage(port);
    await screen.findByRole("list", { name: "Passos da configuração" });
    type(screen.getByLabelText("Sua frase"), "Barbeiro, não atendo domingo e segunda, terça a sexta 10 às 20 e sábado 8 às 16. Faço corte e sobrancelha.");
    await click(screen.getByRole("button", { name: "Montar rascunho" }));
    const form = within(screen.getByRole("form", { name: "Rascunho do seu negócio" }));
    expect(form.getByLabelText("Início")).toHaveValue("10:00");
    expect(form.getByLabelText("Início (grupo 2)")).toHaveValue("08:00");
    expect(form.getByLabelText("Fim (grupo 2)")).toHaveValue("16:00");
    expect(form.getByText("Horários diferentes por dia: sábado, 08:00 às 16:00. Confira.")).toBeInTheDocument();
    // "Corte" já existe na barbearia de exemplo: o rascunho diz isso no próprio campo, em vez de recusar tudo ao salvar.
    expect(await form.findByText("Já no catálogo: não será criado de novo.")).toBeInTheDocument();
    type(form.getAllByLabelText("Minutos")[1]!, "15");
    type(form.getAllByLabelText("Preço (R$)")[1]!, "25,00");
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    const confirm = screen.getByRole("group", { name: "Salvar o rascunho?" });
    expect(confirm).toHaveTextContent("Expediente: terça a sexta, 10:00 às 20:00; sábado, 08:00 às 16:00");
    expect(confirm).toHaveTextContent("Serviços: Sobrancelha (15 min, R$ 25,00)");
    expect(confirm).toHaveTextContent("Já no catálogo, não entram de novo: Corte.");
    await click(within(confirm).getByRole("button", { name: "Salvar" }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      hours: [...[2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "10:00", local_end: "20:00" })), { weekday: 6, local_start: "08:00", local_end: "16:00" }],
      services: [{ template_code: null, name: "Sobrancelha", duration_min: 15, base_price_cents: 2500 }],
    }), expect.any(String));
    expect(await screen.findByText("Salvo: expediente de 5 dias e 1 serviço criado.")).toBeInTheDocument();
  });

  it("P50 · demonstração com a Agenda ligada: a confirmação diz que substitui o expediente e a Agenda recebe os blocos", async () => {
    const received = vi.fn();
    const off = readDemoSetup("hours", received);
    try {
      renderPage(createDemoPort());
      await screen.findByRole("list", { name: "Passos da configuração" });
      type(screen.getByLabelText("Sua frase"), "Sou barbeiro, sozinho, de terça a sábado das 9 às 19");
      await click(screen.getByRole("button", { name: "Montar rascunho" }));
      const form = within(screen.getByRole("form", { name: "Rascunho do seu negócio" }));
      await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
      const confirm = screen.getByRole("group", { name: "Salvar o rascunho?" });
      expect(confirm).toHaveTextContent("Expediente: terça a sábado, 09:00 às 19:00 (substitui o atual da agenda principal).");
      await click(within(confirm).getByRole("button", { name: "Salvar" }));
      expect(received).toHaveBeenCalledWith([2, 3, 4, 5, 6].map((weekday) => ({ weekday, local_start: "09:00", local_end: "19:00" })));
    } finally {
      off();
    }
  });

  it("P50 · campo preenchido pelo assistente leva o selo; o que veio das regras não", async () => {
    const rules = describeBusiness("atendo de terça a sábado das 9 às 19");
    const port: SetupPort = { ...createDemoPort(), kind: "server", describe: async () => ({
      ...rules, profession: "hairdresser", unknown: [], notes: [], sources: { ...rules.sources, profession: "assistant" }, assistant: true,
    }) };
    renderPage(port);
    await screen.findByRole("list", { name: "Passos da configuração" });
    type(screen.getByLabelText("Sua frase"), "atendo de terça a sábado das 9 às 19");
    await click(screen.getByRole("button", { name: "Montar rascunho" }));
    const form = within(await screen.findByRole("form", { name: "Rascunho do seu negócio" }));
    expect(form.getByText(/O assistente completou o que não deu para ler pelas regras/)).toBeInTheDocument();
    expect(form.getAllByText("preenchido pelo assistente")).toHaveLength(1);
    expect(form.getByLabelText("Profissão")).toHaveValue("hairdresser");
  });

  it("P50 · âncoras #modelos e #descrever rolam e focam só depois que os passos e os modelos carregaram", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this.id); };
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const demo = createDemoPort();
      const port: SetupPort = { ...demo, templates: async () => { await gate; return demo.templates(); } };
      const first = renderPage(port, "#modelos");
      await screen.findByRole("list", { name: "Passos da configuração" });
      // Os modelos ainda não chegaram: o título não existe e nada rolou.
      expect(scrolled).toEqual([]);
      await act(async () => { release(); await gate; });
      expect(await screen.findByRole("heading", { name: /Modelos de serviço · Barbearia/ })).toHaveFocus();
      expect(scrolled).toEqual(["setup-templates-title"]);
      first.unmount();
      renderPage(createDemoPort(), "#descrever");
      await screen.findByRole("heading", { name: /Modelos de serviço · Barbearia/ });
      expect(screen.getByRole("heading", { name: "Descreva seu negócio em uma frase" })).toHaveFocus();
      expect(scrolled).toEqual(["setup-templates-title", "setup-describe-title"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("modelos: já no catálogo desabilitado; marcar pede preço; confirmação lista nome e preço; criar passa pela porta", async () => {
    const port = createDemoPort();
    const apply = vi.spyOn(port, "applyServices");
    renderPage(port, "#modelos");
    await screen.findByRole("heading", { name: /Modelos de serviço · Barbearia/ });
    const form = within(screen.getByRole("form", { name: "Modelos de serviço" }));
    expect(form.getByRole("checkbox", { name: /Corte · já no catálogo/ })).toBeDisabled();
    const combo = form.getByRole("checkbox", { name: /Corte e barba/ });
    expect(combo).toBeEnabled();
    expect(form.getByText("50 min · faixa R$ 55,00 a R$ 110,00")).toBeInTheDocument();
    // Sem marcar nada: explica e não abre a confirmação.
    await click(form.getByRole("button", { name: "Criar serviços" }));
    expect(form.getByText("Marque pelo menos um modelo.")).toBeInTheDocument();
    await click(combo);
    const price = form.getByLabelText("Preço de Corte e barba (R$)");
    expect(price).toHaveValue("55,00");
    type(price, "70");
    await click(form.getByRole("button", { name: "Criar 1 serviço" }));
    const confirm = screen.getByRole("group", { name: "Criar os serviços marcados?" });
    expect(confirm).toHaveTextContent("Corte e barba (50 min, R$ 70,00)");
    expect(apply).not.toHaveBeenCalled();
    await click(within(confirm).getByRole("button", { name: "Criar" }));
    expect(apply).toHaveBeenCalledWith([{ template_code: "barber_corte_barba", name: "Corte e barba", duration_min: 50, base_price_cents: 7000 }], expect.any(String));
    expect(await screen.findByText("1 serviço criado: Corte e barba.")).toBeInTheDocument();
    expect(await form.findByRole("checkbox", { name: /Corte e barba · já no catálogo/ })).toBeDisabled();
  });
});

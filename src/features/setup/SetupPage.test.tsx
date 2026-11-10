import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
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
    expect(form.getByLabelText("Início")).toHaveValue("09:00");
    expect(form.getByLabelText("Fim")).toHaveValue("18:00");
    expect(form.getByLabelText("Pausa: de (opcional)")).toHaveValue("12:00");
    expect(form.getByLabelText("Serviço 1")).toHaveValue("Corte");
    expect(form.getByLabelText("Serviço 2")).toHaveValue("Escova");
    expect(apply).not.toHaveBeenCalled();
    // Sem duração e preço, o botão explica embaixo do campo e nada é confirmado.
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    expect(form.getByText(/Cada serviço precisa de duração/)).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    // O dono revisa: tira a Escova, põe duração e preço no Corte.
    await click(form.getByRole("button", { name: "Tirar Escova" }));
    type(form.getByLabelText("Serviço 1"), "Corte feminino");
    type(form.getByLabelText("Minutos"), "45");
    type(form.getByLabelText("Preço (R$)"), "80,00");
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    const confirm = screen.getByRole("group", { name: "Salvar o rascunho?" });
    expect(confirm).toHaveTextContent("Profissão: Cabeleireira(o).");
    expect(confirm).toHaveTextContent("Expediente: terça a sábado, 09:00 às 12:00 e 13:00 às 18:00 (substitui o atual da agenda principal).");
    expect(confirm).toHaveTextContent("Serviços: Corte feminino (45 min, R$ 80,00).");
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
    expect(screen.getByText("Não entendi a profissão, os dias, o horário. Complete abaixo.")).toBeInTheDocument();
    const form = within(screen.getByRole("form", { name: "Rascunho do seu negócio" }));
    expect(form.getByLabelText("Profissão")).toHaveValue("");
    await click(form.getByRole("button", { name: "Salvar expediente e serviços" }));
    expect(form.getByText("Escolha a profissão.")).toBeInTheDocument();
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

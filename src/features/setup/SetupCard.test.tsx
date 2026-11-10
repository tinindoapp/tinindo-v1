import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { resetDemoJourney, setPublishedSlug } from "../../lib/demo/journey.ts";
import { createDemoPort, resetDemoState } from "./demoPort.ts";
import { newKey, type SetupPort } from "./port.ts";
import { SetupCard } from "./SetupCard.tsx";

beforeEach(() => {
  resetDemoState();
  resetDemoJourney();
});
afterEach(() => act(() => dismissToast()));

const renderCard = (port: SetupPort) => render(<MemoryRouter><SetupCard port={port} /><Toaster /></MemoryRouter>);

describe("cartão 'Deixe seu negócio pronto' (Home)", () => {
  it("mostra N de 8, o próximo passo obrigatório em destaque com por quê e o botão para a tela que resolve", async () => {
    renderCard(createDemoPort());
    const card = await screen.findByRole("region", { name: /Deixe seu negócio pronto/ });
    expect(card).toHaveTextContent("5 de 8");
    expect(within(card).getByRole("progressbar", { name: "Passos feitos" })).toHaveAttribute("aria-valuenow", "5");
    expect(card).toHaveTextContent("Próximo: Publicar seu perfil e mandar o link");
    expect(card).toHaveTextContent("O link público é como o cliente reserva com você.");
    expect(within(card).getByRole("link", { name: "Publicar perfil" })).toHaveAttribute("href", "/app/perfil");
    expect(within(card).getByRole("link", { name: "Ver os 8 passos" })).toHaveAttribute("href", "/app/configurar");
    // Passo obrigatório não tem "Agora não"; e a frase do negócio só aparece quando faltam horários ou serviços.
    expect(within(card).queryByRole("button", { name: "Agora não" })).not.toBeInTheDocument();
    expect(within(card).queryByText(/descreva seu negócio/)).not.toBeInTheDocument();
  });

  it("perfil publicado: pronto para reservas, próximo passo opcional com 'Agora não' e Desfazer", async () => {
    setPublishedSlug("barbearia-exemplo-a");
    const port = createDemoPort();
    const dismiss = vi.spyOn(port, "dismiss");
    renderCard(port);
    const card = await screen.findByRole("region", { name: /Deixe seu negócio pronto/ });
    expect(card).toHaveTextContent("6 de 8");
    expect(card).toHaveTextContent("Seu link público já recebe reservas.");
    expect(card).toHaveTextContent("Próximo (opcional): Pôr foto e WhatsApp no perfil");
    await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Agora não" })); });
    expect(dismiss).toHaveBeenCalledWith("photo_whatsapp", true, expect.any(String));
    expect(await screen.findByText(/fica para depois/)).toBeInTheDocument();
    expect(card).toHaveTextContent("Próximo (opcional): Conectar e verificar seu número");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
    expect(dismiss).toHaveBeenLastCalledWith("photo_whatsapp", false, expect.any(String));
    expect(card).toHaveTextContent("Próximo (opcional): Pôr foto e WhatsApp no perfil");
  });

  it("some quando os 8 estão feitos ou dispensados; falha na leitura não quebra a Home", async () => {
    setPublishedSlug("x");
    const port = createDemoPort();
    await port.dismiss("photo_whatsapp", true, newKey());
    await port.dismiss("channel", true, newKey());
    const { container } = renderCard(port);
    await act(async () => { await port.progress(); });
    expect(container.querySelector(".tn-setup-card")).toBeNull();
    const broken: SetupPort = { ...createDemoPort(), progress: async () => { throw new Error("offline"); } };
    const r2 = renderCard(broken);
    await act(async () => { await Promise.resolve(); });
    expect(r2.container.querySelector(".tn-setup-card")).toBeNull();
  });

  it("sem horários ou serviços, oferece 'descreva seu negócio em uma frase'", async () => {
    const port: SetupPort = { ...createDemoPort(), progress: async () => {
      const p = await createDemoPort().progress();
      return { ...p, done_count: 3, resolved_count: 3, next: "hours", ready: false, steps: p.steps.map((s) => (s.step === "hours" || s.step === "service" ? { ...s, done: false, done_at: null, why: "x" } : s)) };
    } };
    renderCard(port);
    const card = await screen.findByRole("region", { name: /Deixe seu negócio pronto/ });
    expect(within(card).getByRole("link", { name: "Definir horários" })).toHaveAttribute("href", "/app/agenda/horarios");
    expect(within(card).getByRole("link", { name: "descreva seu negócio em uma frase" })).toHaveAttribute("href", "/app/configurar#descrever");
  });
});

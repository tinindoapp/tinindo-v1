import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AgentPage, AgentPortProvider } from "./AgentPage.tsx";
import { SetupProgressOutput } from "@contracts";
import { FX } from "@contracts/fixtures.ts";
import { createApiClient } from "../../lib/api/client.ts";
import { SETUP_STEPS } from "../../lib/setup/steps.ts";
import { createDemoPort } from "./demoPort.ts";
import { createServerPort } from "./serverPort.ts";
import type { AgentPort } from "./port.ts";

function page(over: Partial<AgentPort> = {}, initialDraft?: { kind?: "message" | "bio" | "campaign"; text?: string }) {
  const port: AgentPort = { ...createDemoPort(), ...over };
  render(<MemoryRouter><AgentPortProvider value={port}><AgentPage initialDraft={initialDraft} /></AgentPortProvider></MemoryRouter>);
  return port;
}

describe("Me ajuda a configurar (P46 + setup.progress do P44)", () => {
  it("mostra quantos passos estão prontos e conduz um passo por vez, com o porquê e o link da tela", async () => {
    page();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Me ajuda a configurar" })); });
    // Mesmos fatos da tela de Configuração na demonstração: 5 de 8, falta publicar o perfil.
    expect(await screen.findByText(/5 de 8/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Publicar seu perfil e mandar o link" })).toBeInTheDocument();
    expect(screen.getByText(/O link público é como o cliente reserva com você/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Publicar perfil" })).toHaveAttribute("href", "/app/perfil");
    // Passo obrigatório não tem "Pular".
    expect(screen.queryByRole("button", { name: "Pular por agora" })).toBeNull();
  });

  it("'Já fiz, conferir' lê o progresso de novo e avança; passo opcional pode ser pulado", async () => {
    const base = (await createDemoPort().setupProgress())!;
    let calls = 0;
    const setupProgress = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return base;
      // Depois da primeira leitura, o perfil fica publicado (o dono resolveu na tela Perfil).
      const steps = base.steps.map((s) => (s.step === "profile" ? { ...s, done: true, why: null, done_at: "2026-10-20T12:00:00Z" } : s));
      return { ...base, steps, done_count: base.done_count + 1, resolved_count: base.resolved_count + 1, next: "photo_whatsapp" as const, ready: true };
    });
    page({ setupProgress });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Me ajuda a configurar" })); });
    await screen.findByText(/5 de 8/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Já fiz, conferir" })); });
    expect(await screen.findByText(/6 de 8/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Pôr foto e WhatsApp no perfil/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pular por agora" })); });
    expect(screen.getByRole("heading", { name: /Conectar e verificar seu número/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pular por agora" })); });
    expect(screen.getByText(/Tudo pronto/)).toBeInTheDocument();
  });

  it("com servidor: aceita a resposta de setup.progress no formato do contrato e mostra o passo pelo catálogo", async () => {
    // Resposta como a função `setup` devolve (contrato v1): `step`, `why` nulo nos feitos, `link`, `dismissed`.
    const steps = SETUP_STEPS.map((s, i) => ({
      step: s.step, required: s.required, title: `título do servidor ${i}`,
      why: i < 2 ? null : `porquê do servidor ${i}`, link: s.link,
      done: i < 2, done_at: i < 2 ? "2026-10-01T12:00:00Z" : null, dismissed: s.step === "channel",
    }));
    const progress = SetupProgressOutput.parse({
      business_name: "Barbearia Exemplo A", profession: "barber", created_at: "2026-09-29T12:00:00Z",
      steps, done_count: 2, resolved_count: 3, total: 8, next: "cancellation_policy", ready: false, ready_at: null, ready_in_24h: false,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: progress, meta: { request_id: "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10", as_of: "2026-10-20T12:00:00Z", schema_version: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const call = createApiClient({ baseUrl: "https://exemplo.supabase.co", publishableKey: "sb_publishable_exemplo", getAccessToken: async () => "jwt", fetch: fetchMock as unknown as typeof fetch });
    const server = createServerPort(call, FX.tenants.A);
    expect(await server.setupProgress()).toEqual(progress);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://exemplo.supabase.co/functions/v1/setup/setup.progress");

    page({ setupProgress: server.setupProgress });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Me ajuda a configurar" })); });
    expect(await screen.findByText(/2 de 8/)).toBeInTheDocument();
    // Rótulo, porquê e link vêm do catálogo comum (o mesmo da tela de Configuração), não do texto livre da resposta.
    expect(screen.getByRole("heading", { name: "Definir a antecedência para cancelar" })).toBeInTheDocument();
    expect(screen.getByText(/A política aparece para o cliente antes de reservar/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Definir antecedência" })).toHaveAttribute("href", "/app/conta");
    expect(screen.queryByText(/do servidor/)).toBeNull();
  });

  it("passo opcional dispensado no servidor não volta no guia", async () => {
    const base = (await createDemoPort().setupProgress())!;
    const steps = base.steps.map((s) => (s.step === "profile" ? { ...s, done: true } : s.step === "photo_whatsapp" ? { ...s, dismissed: true } : s));
    page({ setupProgress: async () => ({ ...base, steps, done_count: 6, resolved_count: 7 }) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Me ajuda a configurar" })); });
    expect(await screen.findByRole("heading", { name: /Conectar e verificar seu número/ })).toBeInTheDocument();
  });

  it("sem setup.progress no servidor (P44 fora): avisa e não inventa passos", async () => {
    page({ setupProgress: async () => null });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Me ajuda a configurar" })); });
    expect(await screen.findByText(/configuração guiada ainda não está disponível/)).toBeInTheDocument();
  });
});

describe("Redigir um texto (P46)", () => {
  it("sem provedor (demonstração): avisa que está desligado e mantém o rascunho", async () => {
    page();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Redigir um texto" })); });
    fireEvent.change(screen.getByLabelText("Seu rascunho"), { target: { value: "Oi, seu horário é quinta às 10h." } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reescrever no tom escolhido" })); });
    expect(screen.getByText(/redação pelo assistente está desligada/)).toBeInTheDocument();
    expect(screen.getByLabelText("Seu rascunho")).toHaveValue("Oi, seu horário é quinta às 10h.");
    expect(screen.queryByLabelText("Sugestão (edite antes de usar)")).toBeNull();
  });

  it("com provedor: sugestão editável, enviada com tipo e tom; nada é salvo", async () => {
    const draft = vi.fn(async () => ({ available: true, suggestion: "Olá! Te espero quinta às 10h." }));
    page({ draft }, { kind: "message", text: "Oi, seu horário é quinta às 10h." });
    // Chegou de outra tela: o painel abre já preenchido.
    expect(screen.getByLabelText("Seu rascunho")).toHaveValue("Oi, seu horário é quinta às 10h.");
    fireEvent.change(screen.getByLabelText("Tom"), { target: { value: "formal" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reescrever no tom escolhido" })); });
    expect(draft).toHaveBeenCalledWith({ kind: "message", tone: "formal", text: "Oi, seu horário é quinta às 10h." }, expect.any(String));
    const out = screen.getByLabelText("Sugestão (edite antes de usar)");
    expect(out).toHaveValue("Olá! Te espero quinta às 10h.");
    fireEvent.change(out, { target: { value: "Olá! Te espero quinta às 10h. Até lá!" } });
    expect(out).toHaveValue("Olá! Te espero quinta às 10h. Até lá!");
    expect(screen.getByText(/Nada foi salvo nem enviado/)).toBeInTheDocument();
  });

  it("sugestão descartada pelo servidor (inventaria dado): diz isso e segue com o rascunho", async () => {
    page({ draft: async () => ({ available: true, suggestion: null }) }, { kind: "campaign", text: "Volta pra cortar com a gente." });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reescrever no tom escolhido" })); });
    expect(screen.getByText(/mantenha os mesmos dados/)).toBeInTheDocument();
  });
});

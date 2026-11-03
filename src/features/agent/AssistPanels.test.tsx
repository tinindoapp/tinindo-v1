import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AgentPage, AgentPortProvider } from "./AgentPage.tsx";
import { createDemoPort } from "./demoPort.ts";
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
    expect(await screen.findByText(/4 de 8/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Política de cancelamento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir política de cancelamento" })).toHaveAttribute("href", "/app/conta");
    // Passo obrigatório não tem "Pular".
    expect(screen.queryByRole("button", { name: "Pular por agora" })).toBeNull();
  });

  it("'Já fiz, conferir' lê o progresso de novo e avança; passo opcional pode ser pulado", async () => {
    const steps = createDemoPort();
    const base = await steps.setupProgress();
    let calls = 0;
    const setupProgress = vi.fn(async () => {
      calls += 1;
      // Depois da primeira leitura, cancelamento e perfil ficam prontos (o dono resolveu nas telas).
      return calls === 1 ? base : { steps: base!.steps.map((s) => (["cancellation", "public_profile"].includes(s.code) ? { ...s, done: true } : s)) };
    });
    page({ setupProgress });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Me ajuda a configurar" })); });
    await screen.findByText(/4 de 8/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Já fiz, conferir" })); });
    expect(await screen.findByText(/6 de 8/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Foto e WhatsApp no perfil/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pular por agora" })); });
    expect(screen.getByRole("heading", { name: /Canal de mensagens verificado/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pular por agora" })); });
    expect(screen.getByText(/Tudo pronto/)).toBeInTheDocument();
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

// "Faz comigo" e "Usar este texto" (revisão 06/11, T4 e T5) e o componente AssistHint (src/components/ui/assist.tsx).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AssistBadge, AssistHint, useAssistFields } from "../../components/ui/assist.tsx";
import { formatCents } from "../../lib/money.ts";
import { AgentPage, AgentPortProvider, type InitialDraft } from "./AgentPage.tsx";
import { createDemoPort } from "./demoPort.ts";
import { describeDraft } from "./FormAssist.tsx";
import type { AgentPort, FormDraftResult } from "./port.ts";

function Landing() {
  const state = useLocation().state as unknown;
  return <pre data-testid="state">{JSON.stringify(state)}</pre>;
}

function page(over: Partial<AgentPort> = {}, initialDraft?: InitialDraft) {
  const port: AgentPort = { ...createDemoPort(), ...over };
  render(
    <MemoryRouter initialEntries={["/app/assistente"]}>
      <Routes>
        <Route path="/app/assistente" element={<AgentPortProvider value={port}><AgentPage initialDraft={initialDraft} /></AgentPortProvider>} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
  return port;
}

async function openFazComigo(text: string) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Faz comigo" })); });
  fireEvent.click(screen.getAllByRole("button", { name: "Faz comigo" }).at(-1)!);
  fireEvent.change(screen.getByLabelText("Diga do seu jeito"), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher para eu conferir" })); });
}

describe("Faz comigo no Assistente", () => {
  it("demonstração (sem provedor): diz que o assistente não está ligado e não preenche nada", async () => {
    page();
    await openFazComigo("lembrete no dia anterior");
    expect(await screen.findByText(/O assistente não está ligado neste negócio/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preencher o formulário" })).toBeNull();
  });

  it("com rascunho: mostra o que vai ficar e abre a tela com o rascunho no estado da navegação (nada salvo)", async () => {
    const draft: FormDraftResult = {
      available: true, form: "lifecycle.settings", draft: { reminder_hours: [24, 2], reactivation_days: 60 },
      filled: ["reminder_hours", "reactivation_days"], notes: [{ field: "daily_budget", text: "Deixei este campo para você preencher." }],
    };
    const formDraft = vi.fn(async () => draft);
    page({ formDraft });
    await openFazComigo("lembrete no dia anterior e duas horas antes, e chama de volta quem sumiu há dois meses");
    expect(formDraft).toHaveBeenCalledWith("lifecycle.settings", "lembrete no dia anterior e duas horas antes, e chama de volta quem sumiu há dois meses", expect.any(String));
    expect(await screen.findByText("Lembretes: 24 h e 2 h antes")).toBeInTheDocument();
    expect(screen.getByText("Chamar de volta quem não volta há 60 dias")).toBeInTheDocument();
    expect(screen.getByText("Deixei este campo para você preencher.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher o formulário" })); });
    expect(JSON.parse(screen.getByTestId("state").textContent!)).toEqual({ assistDraft: { form: "lifecycle.settings", draft: draft.draft, filled: draft.filled } });
  });

  it("formulário escolhido vai junto no pedido", async () => {
    const formDraft = vi.fn(async (form: FormDraftResult["form"]) => ({ available: true, form, draft: null, filled: [], notes: [] }) as FormDraftResult);
    page({ formDraft });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Faz comigo" })); });
    fireEvent.change(screen.getByLabelText("O que você quer configurar"), { target: { value: "schedule.rules" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Faz comigo" }).at(-1)!);
    fireEvent.change(screen.getByLabelText("Diga do seu jeito"), { target: { value: "terça a sábado das 9 às 19" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher para eu conferir" })); });
    expect(formDraft.mock.calls[0]![0]).toBe("schedule.rules");
    expect(await screen.findByText(/Não entendi o que preencher/)).toBeInTheDocument();
  });
});

describe("rascunho em palavras", () => {
  it("horários por dia, preço em reais e ciclo por nome", () => {
    expect(describeDraft({ days: [0, 2], rules: [{ weekday: 2, local_start: "09:00", local_end: "12:00" }, { weekday: 2, local_start: "13:00", local_end: "19:00" }] }))
      .toEqual(["domingo: fechado", "terça: 09:00 às 12:00 e 13:00 às 19:00"]);
    expect(describeDraft({ name: "Plano 8", sessions_per_cycle: 8, cycle_days: 30, price_cents: 64000 }))
      .toEqual(["Nome: Plano 8", "Sessões por ciclo: 8", "Ciclo: mensal", `Preço: ${formatCents(64000)}`]);
  });
});

describe("Usar este texto (T5) e limite do destino (T6)", () => {
  const suggest = { draft: vi.fn(async () => ({ available: true, suggestion: "Corte clássico e degradê no centro" })) };

  it("com origem, a sugestão volta para a tela de onde veio, no campo certo", async () => {
    page(suggest, { kind: "bio", text: "corte classico e degrade", returnTo: "/app/site", field: "headline", max: 90 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reescrever no tom escolhido" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Usar este texto" })); });
    expect(JSON.parse(screen.getByTestId("state").textContent!)).toEqual({ assistText: { field: "headline", text: "Corte clássico e degradê no centro" } });
  });

  it("acima do limite do destino o botão espera o dono encurtar", async () => {
    page({ draft: vi.fn(async () => ({ available: true, suggestion: "x".repeat(120) })) }, { kind: "bio", text: "base", returnTo: "/app/site", field: "headline", max: 90 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reescrever no tom escolhido" })); });
    expect(await screen.findByRole("button", { name: "Usar este texto" })).toBeDisabled();
    expect(screen.getByText(/aceita até 90 caracteres/)).toBeInTheDocument();
  });

  it("sem origem, fica só o Copiar", async () => {
    page(suggest, { kind: "message", text: "oi" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reescrever no tom escolhido" })); });
    expect(await screen.findByRole("button", { name: "Copiar texto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar este texto" })).toBeNull();
  });
});

describe("AssistHint", () => {
  function Form({ request, onEvent }: { request(t: string): Promise<FormDraftResult>; onEvent?: Parameters<typeof AssistHint>[0]["onEvent"] }) {
    const fields = useAssistFields();
    const [hours, setHours] = useState("");
    return (
      <>
        <AssistHint<{ reminder_hours?: number[] }> hint="Dica fixa da tela." example="exemplo" onRequest={request} onEvent={onEvent} onDismiss={() => undefined}
          onApply={(d, filled) => { setHours((d.reminder_hours ?? []).join(",")); fields.mark(filled); }} />
        <label htmlFor="h">Lembretes {fields.has("reminder_hours") ? <AssistBadge /> : null}</label>
        <input id="h" value={hours} onChange={(e) => { setHours(e.target.value); fields.touch("reminder_hours"); }} />
      </>
    );
  }
  const ok = async (): Promise<FormDraftResult> => ({ available: true, form: "lifecycle.settings", draft: { reminder_hours: [24] }, filled: ["reminder_hours"], notes: [] });

  it("sem pedir nada mostra só a dica fixa; aplicar preenche e marca o campo; mexer à mão tira o selo", async () => {
    render(<Form request={ok} />);
    expect(screen.getByText("Dica fixa da tela.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Faz comigo" }));
    fireEvent.change(screen.getByLabelText("Diga do seu jeito"), { target: { value: "no dia anterior" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher para eu conferir" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher o formulário" })); });
    expect(screen.getByLabelText(/Lembretes/)).toHaveValue("24");
    expect(screen.getByText("preenchido pelo assistente")).toBeInTheDocument();
    expect(screen.getByText(/nada foi salvo ainda/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Lembretes/), { target: { value: "12" } });
    expect(screen.queryByText("preenchido pelo assistente")).toBeNull();
  });

  it("falha de rede: aviso e a tela como estava", async () => {
    render(<Form request={() => Promise.reject(new Error("rede"))} />);
    fireEvent.click(screen.getByRole("button", { name: "Faz comigo" }));
    fireEvent.change(screen.getByLabelText("Diga do seu jeito"), { target: { value: "no dia anterior" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher para eu conferir" })); });
    expect(screen.getByText(/Não foi possível ler agora/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Lembretes/)).toHaveValue("");
  });

  it("eventos sem conteúdo: shown, applied (com a contagem de campos) e dismissed", async () => {
    const onEvent = vi.fn();
    render(<Form request={ok} onEvent={onEvent} />);
    fireEvent.click(screen.getByRole("button", { name: "Faz comigo" }));
    fireEvent.change(screen.getByLabelText("Diga do seu jeito"), { target: { value: "no dia anterior" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher para eu conferir" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preencher o formulário" })); });
    expect(onEvent.mock.calls).toEqual([["shown", { filled: 0 }], ["applied", { filled: 1 }]]);
    expect(JSON.stringify(onEvent.mock.calls)).not.toMatch(/dia anterior|24/);
  });
});

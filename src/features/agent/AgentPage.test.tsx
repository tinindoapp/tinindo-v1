import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentPage, AgentPortProvider } from "./AgentPage.tsx";
import type { AgentPort, Answer, Approval, Proposal, Receipt } from "./port.ts";

const proposal: Proposal = {
  proposal_id: "10000000-0000-4000-8000-000000000001", tenant_id: "10000000-0000-4000-8000-000000000002", tool: "booking.create",
  payload: {}, payload_hash: "a".repeat(64), policy_version: 1, version: 1, expires_at: "2026-10-20T12:30:00Z", approval_state: "pending",
  summary: "Agendar Corte para Maria Exemplo Silva na quinta, às 10:00 (30 min), por R$ 60,00. Nada é gravado antes da sua aprovação.",
};
const answer: Answer = { state: "pending_approval", text: "Preparei a proposta abaixo. Confira e aprove.", sources: [], proposal };
const approval: Approval = {
  approval_id: "10000000-0000-4000-8000-000000000003", proposal_id: proposal.proposal_id, approver_user_id: "10000000-0000-4000-8000-000000000004",
  approved_at: "2026-10-20T12:01:00Z", expires_at: "2026-10-20T12:16:00Z",
};
const receipt: Receipt = { approval_id: approval.approval_id, status: "executed", result_ref: null, executed_at: "2026-10-20T12:01:01Z" };

function setup(execute: AgentPort["execute"]) {
  const port: AgentPort = {
    kind: "server",
    ask: vi.fn(async () => answer),
    approve: vi.fn(async () => approval),
    execute: vi.fn(execute),
    draft: vi.fn(async () => ({ available: false, suggestion: null })),
    setupProgress: vi.fn(async () => null),
  };
  render(<AgentPortProvider value={port}><AgentPage /></AgentPortProvider>);
  return port;
}

async function askAndPropose() {
  fireEvent.change(screen.getByLabelText("Pergunte ao assistente"), { target: { value: "marca um corte" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Perguntar" })); });
  return within(await screen.findByRole("region", { name: "Proposta: Agendamento" }));
}

describe("Assistente: um passo para aprovar e executar (item 57)", () => {
  it("o toque aprova o código e a versão mostrados e só depois executa", async () => {
    const port = setup(async () => receipt);
    const card = await askAndPropose();
    expect(port.approve).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(card.getByRole("button", { name: "Aprovar e agendar · R$ 60,00" })); });
    expect(port.approve).toHaveBeenCalledWith(proposal, expect.any(String));
    expect(port.execute).toHaveBeenCalledWith(approval.approval_id, expect.any(String));
    expect(vi.mocked(port.approve).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(port.execute).mock.invocationCallOrder[0]!);
    expect(card.getByText(/Executado\./)).toBeInTheDocument();
  });

  it("se a execução falhar, a aprovação fica e repetir não aprova de novo (mesma chave de execução)", async () => {
    let first = true;
    const port = setup(async () => {
      if (first) { first = false; throw { code: "PROVIDER_UNAVAILABLE" }; }
      return receipt;
    });
    const card = await askAndPropose();
    await act(async () => { fireEvent.click(card.getByRole("button", { name: /^Aprovar e agendar/ })); });
    expect(card.getByText(/indisponível agora/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(card.getByRole("button", { name: "Tentar executar de novo" })); });
    expect(port.approve).toHaveBeenCalledTimes(1);
    const keys = vi.mocked(port.execute).mock.calls.map((c) => c[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(card.getByText(/Executado\./)).toBeInTheDocument();
  });

  it("resposta com valor em destaque e ressalvas em Detalhes", async () => {
    const port = setup(async () => receipt);
    vi.mocked(port.ask).mockResolvedValueOnce({ state: "consulted", sources: [], proposal: null,
      text: "De 01/10 a 20/10: você recebeu R$ 1.740,00 em 29 pagamentos registrados. Só considera o que foi registrado na Tinindo. Atualizado às 09:00." });
    fireEvent.change(screen.getByLabelText("Pergunte ao assistente"), { target: { value: "quanto recebi?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Perguntar" })); });
    const log = screen.getByRole("region", { name: "Conversa" });
    expect(log.querySelector(".tn-ag-value")).toHaveTextContent("R$ 1.740,00");
    const details = log.querySelector("details.tn-ag-details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("Só considera o que foi registrado na Tinindo.");
  });
});

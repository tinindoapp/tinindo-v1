// Saúde da operação (P58): estado do alerta com os motivos em texto, fila, rotinas, erros e versão; recusa de quem não
// é da equipe; resposta fora do formato não vira tela quebrada.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createDemoHealthPort, createServerHealthPort, HealthError, type OpsHealth } from "./health.ts";
import { HealthPage } from "./HealthPage.tsx";

const T = new Date("2026-11-21T13:00:00Z");
const show = (port: Parameters<typeof HealthPage>[0]["port"]) => render(<MemoryRouter><HealthPage port={port} /></MemoryRouter>);

async function attention(): Promise<OpsHealth> {
  const h = await createDemoHealthPort(() => T).health();
  return {
    ...h,
    attention: true,
    reasons: [
      { code: "queue_late", minutes: 22, limit: 15 },
      { code: "tick_failing", ticks: ["referrals"], limit: 3 },
      { code: "errors_over_ceiling", count: 31, limit: 20 },
      { code: "watch_stale", minutes: 7 },
    ],
    ticks: h.ticks.map((t) => (t.name === "referrals" ? { ...t, consecutive_failures: 3, last_error: "relation x does not exist", last_failed_at: T.toISOString() } : t)),
    release: { environment: "homolog", kind: "revert", sha: "abcdef1234567890abcdef1234567890abcdef12", migrations_until: "20261121034614_p58_operacao", functions: 29, published_at: T.toISOString() },
  };
}

describe("Saúde da operação", () => {
  it("tudo certo: diz que está tudo certo e mostra fila, rotinas, erros e versão", async () => {
    show(createDemoHealthPort(() => T));
    expect(await screen.findByText("Tudo certo.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fila de eventos" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Rotinas com falha" })).toHaveTextContent("insights");
    expect(screen.getByRole("list", { name: "Erros por origem" })).toHaveTextContent("scheduling");
    expect(screen.getByRole("heading", { name: "Versão publicada" })).toBeInTheDocument();
  });

  it("precisa de atenção: cada motivo em texto, a rotina que falhou e o caminho do runbook", async () => {
    const h = await attention();
    show({ kind: "server", health: async () => h });
    expect(await screen.findByText("Precisa de atenção.")).toBeInTheDocument();
    expect(screen.getByText(/o mais antigo vencido espera há 22 min \(limite 15 min\)/)).toBeInTheDocument();
    expect(screen.getByText(/Rotina com 3 ou mais falhas seguidas: referrals/)).toBeInTheDocument();
    expect(screen.getByText(/Erros 5xx das funções na última hora: 31 \(teto 20\)/)).toBeInTheDocument();
    expect(screen.getByText(/não roda há 7 min/)).toBeInTheDocument();
    expect(screen.getAllByText("release/RUNBOOK.md").length).toBeGreaterThan(0);
    const rotinas = screen.getByRole("list", { name: "Rotinas com falha" });
    expect(within(rotinas).getByText("3 seguidas")).toBeInTheDocument();
    expect(screen.getByText("Revertido para")).toBeInTheDocument();
  });

  it("Atualizar lê de novo", async () => {
    const port = createDemoHealthPort(() => T);
    const spy = vi.spyOn(port, "health");
    show(port);
    await screen.findByText("Tudo certo.");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("quem não é da equipe vê o aviso; falha vira mensagem, não tela quebrada", async () => {
    const { unmount } = show({ kind: "server", health: async () => { throw new HealthError(true); } });
    expect(await screen.findByText("Só a equipe Tinindo acessa esta tela.")).toBeInTheDocument();
    unmount();
    show({ kind: "server", health: async () => { throw new Error("rede"); } });
    expect(await screen.findByText(/Não foi possível ler a saúde da operação/)).toBeInTheDocument();
  });

  it("porta do servidor: FORBIDDEN do banco e resposta fora do formato", async () => {
    await expect(createServerHealthPort({ rpc: async () => ({ data: null, error: { message: "FORBIDDEN", code: "PT403" } }) }).health())
      .rejects.toMatchObject({ forbidden: true });
    await expect(createServerHealthPort({ rpc: async () => ({ data: { attention: "sim" }, error: null }) }).health())
      .rejects.toMatchObject({ forbidden: false });
    const h = await createDemoHealthPort(() => T).health();
    const rpc = vi.fn(async () => ({ data: h, error: null }));
    expect((await createServerHealthPort({ rpc }).health()).attention).toBe(false);
    expect(rpc).toHaveBeenCalledWith("ops_health");
  });
});

import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { CostPage } from "./CostPage.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { CostPort } from "./port.ts";
import { coverageAction, ResultPage } from "./ResultPage.tsx";

afterEach(() => act(() => dismissToast()));

function renderPage() {
  render(
    <MemoryRouter>
      <ResultPage port={createDemoPort()} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe("Resultado: dinheiro no topo, sem dados agrupados e lacunas com atalho", () => {
  it("faixa Recebido, Gasto e Sobrou antes dos indicadores, sem repetir o dinheiro nos cartões", async () => {
    renderPage();
    const strip = await screen.findByRole("group", { name: "Recebido, gasto e o que sobrou" });
    expect(strip).toHaveTextContent("Recebido");
    expect(strip).toHaveTextContent("Gasto");
    expect(strip).toHaveTextContent(/Sobrou|Faltou/);
    const metrics = screen.getByRole("region", { name: "Indicadores" });
    expect(strip.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(metrics).queryByRole("heading", { name: "Recebimentos registrados" })).toBeNull();
    // Indicador interno da Tinindo fora da tela do profissional.
    expect(document.body).not.toHaveTextContent("Minutos da equipe Tinindo");
  });

  it("indicadores sem dado ficam juntos numa lista, não como cartões vazios", async () => {
    renderPage();
    const missing = await screen.findByRole("region", { name: "Ainda sem dados suficientes" });
    expect(missing).toHaveTextContent("Ofertas de vaga aceitas · Dados insuficientes");
    const cards = document.querySelectorAll(".tn-an-metric");
    for (const c of cards) expect(c).not.toHaveTextContent("Dados insuficientes");
  });

  it("um aviso só no topo e a ressalva da comparação em “Como funciona”", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Indicadores" });
    const intro = document.querySelector(".tn-page-intro")!;
    expect(intro.querySelectorAll(".tn-banner")).toHaveLength(0);
    const help = intro.querySelector("details.tn-help")!;
    expect(help).not.toHaveAttribute("open");
    expect(help).toHaveTextContent("Comparar antes e depois não prova");
  });

  it("lacuna de cobrança leva ao Caixa com o texto do que fazer", async () => {
    renderPage();
    const gaps = await screen.findByRole("region", { name: "O que falta nos dados" });
    const link = within(gaps).getByRole("link", { name: /^Cobrar \d+ atendimentos? →$/ });
    expect(link).toHaveAttribute("href", "/app/caixa");
    expect(coverageAction("uncharged", 1)?.label).toBe("Cobrar 1 atendimento");
    expect(coverageAction("uncharged", 5)?.label).toBe("Cobrar 5 atendimentos");
    expect(coverageAction("pending_outcome", 3)).toEqual({ to: "/app/agenda", label: "Marcar “Atendido” ou “Faltou” em 3 atendimentos" });
    expect(coverageAction("future", null)).toBeNull();
  });
});

describe("Custo por cliente: tela da equipe Tinindo", () => {
  it("sem acesso, mostra só o aviso, sem formulário nem números", async () => {
    const port: CostPort = { kind: "server", costToServe: () => Promise.reject({ code: "FORBIDDEN" }) };
    render(<CostPage port={port} now={() => new Date("2026-10-20T12:00:00Z")} />);
    expect(await screen.findByText("Só a equipe Tinindo acessa esta tela.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Custo-hora (R$)")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

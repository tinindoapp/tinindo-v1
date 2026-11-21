import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cell, CSV_HEADER, pilotCsv } from "./csv.ts";
import { createDemoPilotPort, demoPanel } from "./demoPort.ts";
import { duration, neverOpened, PilotPage } from "./PilotPage.tsx";
import type { PilotPort } from "./port.ts";

const MENU = [{ path: "agenda", label: "Agenda" }, { path: "caixa", label: "Caixa" }, { path: "metas", label: "Metas" }];

describe("painel do piloto · regras", () => {
  it("telas do menu nunca abertas: compara pelo caminho do módulo", () => {
    expect(neverOpened(MENU, ["/app/agenda/atendimento/:id", "/app/caixa"])).toEqual(["Metas"]);
  });
  it("duração legível", () => {
    expect(duration(null)).toBe("—");
    expect(duration(35)).toBe("35 min");
    expect(duration(95)).toBe("1 h 35 min");
    expect(duration(4320)).toBe("3 dias");
  });
  it("CSV: célula com fórmula vira texto e aspas são dobradas", () => {
    expect(cell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(cell("-1")).toBe("\"'-1\"");
    expect(cell(null)).toBe("\"\"");
  });
  it("CSV: uma linha por negócio, só números e datas, sem contato nem valor", () => {
    const rows = demoPanel(new Date("2026-10-20T12:00:00Z"));
    const csv = pilotCsv(rows);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines[0]!.split(",")).toHaveLength(CSV_HEADER.length);
    expect(csv).not.toMatch(/@|\+55|R\$/);
  });
});

describe("painel do piloto · tela", () => {
  it("mostra o funil com tempos, erros e recusas e as telas nunca abertas; exporta CSV", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return "blob:csv"; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    render(<PilotPage port={createDemoPilotPort()} menu={MENU} />);
    const list = await screen.findByRole("list", { name: "Negócios do piloto" });
    const a = within(list).getAllByRole("listitem").find((li) => li.textContent?.includes("Barbearia Exemplo A"))!;
    expect(within(a).getByRole("list", { name: "Funil de Barbearia Exemplo A" })).toHaveTextContent("Primeiro atendimento");
    expect(a).toHaveTextContent("funil 7 de 7");
    expect(a).toHaveTextContent("SLOT_CONFLICT");
    expect(a).toHaveTextContent("Metas");
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(created).toHaveLength(1);
    expect(await created[0]!.text()).toContain("Barbearia Exemplo A");
  });
  it("quem não é da equipe recebe o aviso, sem dado", async () => {
    const port: PilotPort = { kind: "server", now: () => new Date(), panel: async () => { throw Object.assign(new Error("x"), { code: "FORBIDDEN" }); } };
    render(<PilotPage port={port} menu={MENU} />);
    expect(await screen.findByText("Só a equipe Tinindo acessa esta tela.")).toBeInTheDocument();
  });
});

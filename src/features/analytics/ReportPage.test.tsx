import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { ReportPage, shiftRef } from "./ReportPage.tsx";
import { createDemoReportPort } from "./reportPort.ts";
import { reportShareText } from "./reportText.ts";

afterEach(() => {
  act(() => dismissToast());
  vi.unstubAllGlobals();
});

const row = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement!;

describe("relatório ao profissional", () => {
  it("navega entre semanas e meses; não vai além de hoje", () => {
    expect(shiftRef("week", "2026-10-20", -1)).toBe("2026-10-13");
    expect(shiftRef("month", "2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftRef("month", "2026-12-15", 1)).toBe("2027-01-01");
  });

  it("mostra período, número com base e 'dados insuficientes' quando não há base", async () => {
    render(<><ReportPage port={createDemoReportPort()} business="Barbearia" /><Toaster /></>);
    expect(await screen.findByText("19/10/2026 a 20/10/2026 (até agora)")).toBeInTheDocument();
    expect(within(row("Atendimentos feitos")).getByText("2 de 3 atendimentos que já começaram")).toBeInTheDocument();
    expect(within(row("Horário mais cheio")).getByText("dados insuficientes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Semana seguinte" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Semana anterior" }));
    expect(await screen.findByText("12/10/2026 a 18/10/2026")).toBeInTheDocument();
    expect(within(row("Recebido")).getByText("R$ 640,00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Seu mês" }));
    expect(await screen.findByText("01/10/2026 a 20/10/2026 (até agora)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Seu mês" })).toBeInTheDocument();
  });

  it("o texto compartilhado traz só números, período e base; sem nome de cliente", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    render(<><ReportPage port={createDemoReportPort()} business="Barbearia" /><Toaster /></>);
    await screen.findByText("19/10/2026 a 20/10/2026 (até agora)");
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar como texto" }));
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    const text = share.mock.calls[0]![0].text as string;
    expect(text).toContain("Sua semana");
    expect(text).toContain("19/10/2026 a 20/10/2026");
    expect(text).toContain("dados insuficientes");
    const report = await createDemoReportPort().report("week", "2026-10-20");
    expect(text).toBe(reportShareText(report, "Barbearia"));
    expect(text).not.toMatch(/@|\(\d{2}\)\s?\d/);
  });

  it("sem compartilhar nativo, copia o texto e avisa", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    render(<><ReportPage port={createDemoReportPort()} business={null} /><Toaster /></>);
    await screen.findByText("19/10/2026 a 20/10/2026 (até agora)");
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar como texto" }));
    expect(await screen.findByText("Texto copiado. Cole onde quiser enviar.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("erro do servidor vira aviso, não número", async () => {
    const port = { ...createDemoReportPort(), report: vi.fn().mockRejectedValue(new Error("x")) };
    render(<ReportPage port={port} business={null} />);
    expect(await screen.findByText(/Não foi possível montar o relatório agora/)).toBeInTheDocument();
  });
});

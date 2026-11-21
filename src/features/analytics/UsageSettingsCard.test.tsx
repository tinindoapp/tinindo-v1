import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toaster } from "../../components/ui/index.tsx";
import { UsageSettingsCard } from "./UsageSettingsCard.tsx";
import { createDemoUsagePort, resetDemoUsage } from "./usagePort.ts";

afterEach(() => {
  resetDemoUsage();
  act(() => dismissToast());
});

describe("medição de uso", () => {
  it("diz o que anota e o que nunca anota; desligar pede confirmação e avisa que apaga", async () => {
    const port = createDemoUsagePort();
    const set = vi.spyOn(port, "set");
    render(<><UsageSettingsCard port={port} /><Toaster /></>);
    expect(await screen.findByText("Ligada.")).toBeInTheDocument();
    expect(screen.getByText(/Nunca anota nome, telefone, valor nem o que você digita/)).toBeInTheDocument();
    expect(screen.getByText(/Fica guardado por 30 dias/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desligar a medição" }));
    expect(screen.getByText(/apaga o que já foi anotado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(set).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Desligar a medição" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, desligar" }));
    expect(await screen.findByText(/Nada do uso deste negócio é anotado/)).toBeInTheDocument();
    expect(set).toHaveBeenCalledWith(false, 0, expect.any(String));
    fireEvent.click(screen.getByRole("button", { name: "Ligar a medição" }));
    expect(await screen.findByText("Ligada.")).toBeInTheDocument();
  });
});

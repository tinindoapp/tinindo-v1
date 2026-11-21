import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDemoPushPort } from "../../app/pwa/push-client.ts";
import type { PushEnv } from "../../app/pwa/PushSettings.tsx";
import { CalendarPage } from "./CalendarPage.tsx";

const env: PushEnv = { support: "ok", current: vi.fn(async () => null), subscribe: vi.fn(async () => null), permission: () => "default", userAgent: "x" };

describe("Calendário e avisos", () => {
  it("demonstração: título e avisos explicados, sem pedir permissão", async () => {
    render(<CalendarPage push={createDemoPushPort()} pushEnv={env} />);
    expect(screen.getByRole("heading", { level: 1, name: "Calendário e avisos" })).toBeInTheDocument();
    expect(await screen.findByText(/Na demonstração os avisos não são enviados/)).toBeInTheDocument();
    expect(env.subscribe).not.toHaveBeenCalled();
  });

  it("sem negócio selecionado: pede para escolher", () => {
    render(<CalendarPage push={null} pushEnv={env} />);
    expect(screen.getByText(/Selecione um negócio/)).toBeInTheDocument();
  });
});

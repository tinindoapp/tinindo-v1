// Ponte da demonstração (recado #115): o expediente confirmado na Configuração vale para a Agenda de exemplo.
// Arquivo próprio: o expediente da ponte fica no módulo e mudaria as outras emulações do mesmo arquivo.
import { describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { demoSetupReach, publishDemoSetup } from "../../lib/demo/setup.ts";
import { createFixturePort } from "./fixturePort.ts";

const window = { starts_at: "2026-10-21T00:00:00-03:00", ends_at: "2026-10-22T00:00:00-03:00" };
const rules = [
  { weekday: 3, local_start: "14:00", local_end: "16:00" },
  { weekday: 3, local_start: "08:00", local_end: "10:00" },
];

describe("Agenda de exemplo lê o expediente da Configuração", () => {
  it("leitor ligado ao carregar o módulo: a Configuração pode prometer que a agenda principal muda", () => {
    expect(demoSetupReach("hours")).toBe(true);
  });

  it("agenda já aberta troca o expediente inteiro e sobe a versão; agenda criada depois começa com ele", async () => {
    const open = createFixturePort();
    const before = await open.settings();
    publishDemoSetup("hours", rules);

    const after = await open.settings();
    expect(after.rules).toEqual([
      { weekday: 3, local_start: "08:00", local_end: "10:00" },
      { weekday: 3, local_start: "14:00", local_end: "16:00" },
    ]);
    expect(after.resource_version).toBe(before.resource_version + 1);

    const later = await createFixturePort().settings();
    expect(later.rules).toEqual(after.rules);

    // Quarta-feira (21/10): só os dois turnos confirmados oferecem horário.
    const { slots } = await createFixturePort().availability({ resource_id: FX.resources.A, service_id: FX.services.corteA, window });
    const times = slots.map((s) => s.starts_at.slice(11, 16));
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((t) => (t >= "08:00" && t < "10:00") || (t >= "14:00" && t < "16:00"))).toBe(true);
  });
});

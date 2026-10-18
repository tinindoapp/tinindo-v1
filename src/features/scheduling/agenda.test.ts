import { describe, expect, it } from "vitest";
import { bookingsA, services } from "@contracts/fixtures.ts";
import type { Booking } from "@contracts";
import { canComplete, dayTimeline, type DayPlan, formatCents, occupancy } from "./agenda.ts";
import { explainError } from "./errors.ts";

const plan: DayPlan = {
  date: "2026-10-20",
  open: [
    { starts_at: "2026-10-20T09:00:00-03:00", ends_at: "2026-10-20T12:00:00-03:00" },
    { starts_at: "2026-10-20T13:00:00-03:00", ends_at: "2026-10-20T19:00:00-03:00" },
  ],
  pauses: [{ starts_at: "2026-10-20T12:00:00-03:00", ends_at: "2026-10-20T13:00:00-03:00" }],
  blocks: [{ range: { starts_at: "2026-10-20T17:00:00-03:00", ends_at: "2026-10-20T18:00:00-03:00" }, label: "Pessoal" }],
};

describe("ocupação", () => {
  it("minutos confirmados / minutos vendáveis; hold, falta e cancelamento à parte", () => {
    const extra: Booking[] = [
      { ...bookingsA[0]!, id: "60000000-0000-4000-8000-000000000990", status: "cancelled" },
      { ...bookingsA[0]!, id: "60000000-0000-4000-8000-000000000991", status: "no_show" },
    ];
    const o = occupancy([plan], [...bookingsA, ...extra]);
    // 540 min de expediente − 60 de bloqueio; confirmados: 30+30+20+30+30.
    expect(o).toEqual({
      confirmedMinutes: 140,
      sellableMinutes: 480,
      percent: 29,
      blockedMinutes: 60,
      holds: 1,
      noShows: 1,
      cancellations: 1,
    });
  });

  it("sem expediente não inventa porcentagem", () => {
    expect(occupancy([{ ...plan, open: [], blocks: [] }], []).percent).toBeNull();
  });
});

describe("linha do tempo", () => {
  it("intercala atendimentos, pausa, bloqueio e lacunas livres (com intervalos do serviço)", () => {
    const items = dayTimeline(plan, bookingsA, 20, services);
    const kinds = items.map((i) => `${i.kind}@${i.range.starts_at.slice(11, 16)}`);
    expect(kinds).toEqual([
      "booking@09:00", "booking@09:40", "booking@10:20", "booking@10:45", "booking@11:25",
      "pause@12:00", "free@13:00", "booking@15:00", "free@15:40", "block@17:00", "free@18:00",
    ]);
    const free = items.find((i) => i.kind === "free");
    expect(free?.range).toEqual({ starts_at: "2026-10-20T13:00:00-03:00", ends_at: "2026-10-20T15:00:00-03:00" });
  });

  it("concluir só após o início e só se confirmado", () => {
    expect(canComplete(bookingsA[0]!, new Date("2026-10-20T12:00:00Z"))).toBe(true);
    expect(canComplete(bookingsA[5]!, new Date("2026-10-20T12:00:00Z"))).toBe(false);
    expect(canComplete(bookingsA[3]!, new Date("2026-10-20T15:00:00Z"))).toBe(false);
  });

  it("formata centavos inteiros em reais", () => {
    expect(formatCents(5100).replace(/\s/g, " ")).toBe("R$ 51,00");
  });
});

describe("explicação de erros", () => {
  it("409 de horário diz que nada foi criado e pede outro horário", () => {
    const e = explainError({ code: "SLOT_CONFLICT" }, "create");
    expect(e.body).toMatch(/Nenhum agendamento foi criado/);
    expect(e.action).toBe("choose_another_slot");
    expect(explainError({ code: "SLOT_CONFLICT" }, "reschedule").body).toMatch(/continua no horário antigo/);
  });

  it("409 de versão não sobrescreve e pede recarga", () => {
    expect(explainError({ code: "STALE_VERSION" }, "cancel")).toMatchObject({ action: "reload" });
  });

  it("falha transitória em comando avisa que repetir não duplica", () => {
    expect(explainError({ code: "PROVIDER_UNAVAILABLE" }, "create").body).toMatch(/não duplica/);
  });

  it("leitura não conectada é identificada", () => {
    expect(explainError({ notConnected: true, what: "A lista", dependsOn: "P03" }, "load").title).toMatch(/não conectado/);
  });
});

import { describe, expect, it } from "vitest";
import { bookingsA, services } from "@contracts/fixtures.ts";
import type { Booking } from "@contracts";
import { canComplete, cancelNoticeText, dayTimeline, type DayPlan, formatCents, occupancy, STATUS_LABEL, waitlistMatches, whatsAppDigits } from "./agenda.ts";
import type { WaitlistEntry } from "@contracts";
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

describe("depois do cancelamento", () => {
  const entry = (over: Partial<WaitlistEntry>): WaitlistEntry => ({
    id: "71000000-0000-4000-8000-000000000001", tenant_id: bookingsA[0]!.tenant_id, customer_id: bookingsA[0]!.customer_id!,
    service_id: bookingsA[0]!.service_id, status: "active", joined_at: "2026-10-18T13:00:00Z", valid_until: "2026-11-18T13:00:00Z",
    acceptable_windows: [{ weekday: 3, local_start: "09:00", local_end: "19:00" }], version: 1, ...over,
  });
  const tz = "America/Sao_Paulo";

  it("lista de espera: conta quem aceita o início do horário (dia da semana, faixa, validade, ativo)", () => {
    const wed11 = "2026-10-21T11:00:00-03:00";
    expect(waitlistMatches([entry({})], wed11, tz)).toBe(1);
    expect(waitlistMatches([entry({})], "2026-10-20T11:00:00-03:00", tz)).toBe(0); // terça
    expect(waitlistMatches([entry({})], "2026-10-21T19:00:00-03:00", tz)).toBe(0); // fim da faixa é aberto
    expect(waitlistMatches([entry({ status: "offered" })], wed11, tz)).toBe(0);
    expect(waitlistMatches([entry({ valid_until: "2026-10-21T10:00:00-03:00" })], wed11, tz)).toBe(0);
    expect(waitlistMatches([entry({}), entry({ id: "71000000-0000-4000-8000-000000000002" })], wed11, tz)).toBe(2);
  });

  it("aviso no WhatsApp: texto pronto sem o motivo e só com telefone válido", () => {
    const text = cancelNoticeText({ name: "Ana", service: "Corte", day: "quarta-feira, 21 de outubro", time: "11:00", business: "Barbearia Exemplo A" });
    expect(text).toBe("Olá, Ana! Seu horário de Corte em quarta-feira, 21 de outubro, às 11:00, na Barbearia Exemplo A, foi cancelado. Se quiser marcar outro horário, é só responder esta mensagem.");
    expect(whatsAppDigits("+5511977774343")).toBe("5511977774343");
    expect(whatsAppDigits(null)).toBeNull();
    expect(whatsAppDigits("+55")).toBeNull();
  });

  it("estado de falta se chama Faltou", () => {
    expect(STATUS_LABEL.no_show).toBe("Faltou");
  });
});


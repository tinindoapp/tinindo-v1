import { describe, expect, it } from "vitest";
import { SetupDescribeDraft } from "../../contracts/setup.ts";
import { describeBusiness, draftToWeeklyWindows } from "./describe.ts";

describe("descreva seu negócio em uma frase (analisador por regras)", () => {
  it("frase do docs/12: barbeiro, sozinho, terça a sábado das 9 às 19", () => {
    const d = describeBusiness("Sou barbeiro, sozinho, de terça a sábado das 9 às 19");
    expect(SetupDescribeDraft.parse(d)).toEqual({
      profession: "barber", team_size: 1, weekdays: [2, 3, 4, 5, 6], start: "09:00", end: "19:00", pause: null, services: [], unknown: [],
    });
  });

  it("cabeleireira com equipe, dias úteis, horário com minutos e almoço, serviços citados", () => {
    const d = describeBusiness("Cabeleireira, somos 3 no salão, dias úteis das 8:30 às 18h com almoço das 12 às 13. Faço corte, escova e coloração.");
    expect(d.profession).toBe("hairdresser");
    expect(d.team_size).toBe(3);
    expect(d.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect([d.start, d.end]).toEqual(["08:30", "18:00"]);
    expect(d.pause).toEqual({ start: "12:00", end: "13:00" });
    expect(d.services).toEqual(["Corte", "Escova", "Coloração"]);
    expect(draftToWeeklyWindows(d)).toEqual([1, 2, 3, 4, 5].flatMap((weekday) => [
      { weekday, local_start: "08:30", local_end: "12:00" }, { weekday, local_start: "13:00", local_end: "18:00" },
    ]));
  });

  it("personal: 'eu e mais um', dias soltos, horário da manhã e da noite", () => {
    const d = describeBusiness("personal trainer, eu e mais um, segunda, quarta e sexta das 6 da manhã às 9 da noite, treino e avaliação");
    expect(d.profession).toBe("personal_trainer");
    expect(d.team_size).toBe(2);
    expect(d.weekdays).toEqual([1, 3, 5]);
    expect([d.start, d.end]).toEqual(["06:00", "21:00"]);
    expect(d.services).toEqual(["Avaliação física", "Sessão individual"]);
    expect(d.unknown).toEqual([]);
  });

  it("fim menor que o início sem 'da noite' é da tarde; abreviações e hífen; todo dia", () => {
    expect(describeBusiness("barbearia seg-sab 9h-7h").weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(describeBusiness("barbearia seg-sab 9h-7h")).toMatchObject({ start: "09:00", end: "19:00" });
    expect(describeBusiness("atendo todo dia das 10 às 22").weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(describeBusiness("sábado e domingo das 8 às 12").weekdays).toEqual([0, 6]);
    expect(describeBusiness("fim de semana das 8 às 12").weekdays).toEqual([0, 6]);
  });

  it("o que não entendeu volta em unknown, nunca inventa", () => {
    const d = describeBusiness("faço unhas em casa");
    expect(d).toMatchObject({ profession: null, team_size: null, weekdays: [], start: null, end: null, pause: null, services: [] });
    expect(d.unknown).toEqual(["profession", "weekdays", "hours"]);
    expect(describeBusiness("")).toMatchObject({ unknown: ["profession", "weekdays", "hours"] });
    // Horário invertido sem pista de período: não vira expediente.
    expect(describeBusiness("barbeiro das 19 às 19")).toMatchObject({ start: null, end: null });
    expect(draftToWeeklyWindows({ weekdays: [1], start: null, end: null, pause: null })).toEqual([]);
  });

  it("pausa fora do expediente é ignorada ao montar as janelas; profissão é a primeira citada", () => {
    const d = describeBusiness("Sou barbeiro e cabeleireiro, de segunda a sexta das 9 às 12 com pausa das 12 às 13");
    expect(d.profession).toBe("barber");
    expect(draftToWeeklyWindows(d)).toEqual([1, 2, 3, 4, 5].map((weekday) => ({ weekday, local_start: "09:00", local_end: "12:00" })));
  });
});

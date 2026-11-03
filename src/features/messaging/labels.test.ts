import { describe, expect, it } from "vitest";
import { renderTemplate, templateInfo } from "./labels.ts";

describe("modelos com nome legível (item 41)", () => {
  it("código conhecido traz o nome e o nome de cada campo", () => {
    expect(templateInfo("lembrete_agendamento", 2)).toMatchObject({ name: "Lembrete de horário", fields: ["Serviço", "Dia e hora"] });
  });
  it("código desconhecido vira texto legível, sem “Campo 1”", () => {
    expect(templateInfo("aviso_de_feriado", 1)).toEqual({ name: "Aviso de feriado", fields: ["Informação 1"] });
  });
  it("prévia troca {{n}} pelo valor ou pelo nome do campo entre colchetes", () => {
    expect(renderTemplate("Oi, {{1}}! {{2}}", ["Ana", " "], ["Nome", "Serviço"])).toBe("Oi, Ana! [Serviço]");
  });
});

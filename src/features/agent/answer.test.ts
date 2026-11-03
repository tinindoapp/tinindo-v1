import { describe, expect, it } from "vitest";
import { approveLabel, splitAnswer } from "./answer.ts";

describe("resposta do assistente em camadas (item 57)", () => {
  it("valor da frase principal em destaque e ressalvas em Detalhes", () => {
    const p = splitAnswer("De 01/10 a 20/10: você recebeu R$ 1.740,00 em 29 pagamentos registrados. Só considera o que foi registrado na Tinindo (31 registros no período); não inclui valores a receber nem saldo do banco. Atualizado às 09:00.");
    expect(p.value).toBe("R$ 1.740,00");
    expect(p.lead).toBe("De 01/10 a 20/10: você recebeu R$ 1.740,00 em 29 pagamentos registrados.");
    expect(p.details).toEqual([
      "Só considera o que foi registrado na Tinindo (31 registros no período); não inclui valores a receber nem saldo do banco.",
      "Atualizado às 09:00.",
    ]);
    expect(p.items).toEqual([]);
  });

  it("agenda: as linhas ficam à vista, a nota de cobertura vai para Detalhes", () => {
    const p = splitAnswer("Hoje (terça, 20/10) você tem 2 atendimentos confirmados, somando R$ 100,00 em valores combinados:\n• 09:00 Corte — Ana · R$ 60,00\n• 10:00 Barba — Bruno · R$ 40,00\nConsidera só os registros lançados na Tinindo. Atualizado às 09:00.");
    expect(p.value).toBe("R$ 100,00");
    expect(p.items).toEqual(["09:00 Corte — Ana · R$ 60,00", "10:00 Barba — Bruno · R$ 40,00"]);
    expect(p.details).toEqual(["Considera só os registros lançados na Tinindo.", "Atualizado às 09:00."]);
  });

  it("sem valor: só a frase; nada se perde", () => {
    const text = "Não executo SQL nem comandos no banco de dados, e não tenho acesso direto a ele. Posso consultar sua agenda.";
    const p = splitAnswer(text);
    expect(p.value).toBeNull();
    expect([p.lead, ...p.details].join(" ")).toBe(text);
  });

  it("porcentagem também vira destaque", () => {
    expect(splitAnswer("Hoje a ocupação está em 45% do expediente. Atualizado às 09:00.").value).toBe("45%");
  });

  it("botão de um passo com verbo e valor", () => {
    expect(approveLabel("booking.create", "Agendar Corte para Maria na quinta, às 10:00 (30 min), por R$ 60,00. Nada é gravado antes da sua aprovação.")).toBe("Aprovar e agendar · R$ 60,00");
    expect(approveLabel("booking.cancel", "Cancelar o atendimento de amanhã às 10:00.")).toBe("Aprovar e cancelar");
  });
});

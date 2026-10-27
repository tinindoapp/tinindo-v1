import { describe, expect, it } from "vitest";
import { actionLabel, evidenceText, formatEvidence, RULE_LABEL } from "./labels.ts";
import { createDemoPort } from "./demoPort.ts";

describe("evidência das sugestões em frases simples", () => {
  it("as chaves da demonstração viram frases sem nome de campo", async () => {
    const { suggestions } = await createDemoPort().advice();
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      const text = evidenceText(s.evidence);
      expect(text).not.toMatch(/[_=]/);
      for (const k of Object.keys(s.evidence)) expect(text).not.toContain(k);
      expect(actionLabel(s.rule_code, s.route)).not.toMatch(/Ir para a tela/);
      expect(RULE_LABEL[s.rule_code]).toBeTruthy();
    }
  });
  it("frases esperadas, com números marcados", () => {
    expect(evidenceText({ no_show: 0.15, no_show_n: 40, reminders: 0.5 })).toBe("Faltas: 15% (6 de 40 atendimentos) · Lembrete enviado: 50%");
    expect(evidenceText({ occupancy: 0.4, sellable_minutes: 7200, audience: 6 })).toBe("Agenda ocupada: 40% de 120 h · 6 clientes que aceitam mensagem");
    expect(evidenceText({ charge_coverage: 0.82, completed: 34 })).toBe("Atendimentos com cobrança: 82% de 34");
    const nums = formatEvidence({ charge_coverage: 0.82, completed: 34 })[0]!.filter((c) => c.num).map((c) => c.text);
    expect(nums).toEqual(["82%", "34"]);
  });
  it("chave desconhecida tem rótulo genérico legível, nunca o nome cru", () => {
    const text = evidenceText({ some_new_key: 12, other_flag: true });
    expect(text).toBe("Outro dado: 12 · Outro dado: sim");
    expect(text).not.toMatch(/some_new_key|other_flag|[_=]/);
    expect(actionLabel("regra_nova", "/app/qualquer")).toBe("Abrir a tela da sugestão");
  });
});

// "na terça às 10h" dito numa terça depois das 10h é a terça seguinte, não hoje no passado.
// Relógio fixo: o mesmo pedido, sem esta regra, fazia tests/integration/20_f2_jornada falhar
// toda quarta depois das 11h (revisão de 10/11, linha S).
import { describe, expect, it } from "vitest";
import { runAgent } from "../../../supabase/functions/_shared/domain/agent/engine.ts";
import { World } from "./world.ts";

async function ask(now: string, text: string) {
  const world = new World({ now });
  const gate = world.gate("ownerA", "A");
  if (!gate.ok) throw new Error("ownerA deveria ter acesso ao negócio A");
  return runAgent(text, world.context("A", gate.role), world.data("A", gate.role));
}

describe("assistente · dia da semana com a hora já passada", () => {
  const TUESDAY_16H = "2026-10-20T19:00:00Z"; // terça, 16:00 em São Paulo

  it("agendar: propõe a terça seguinte no horário pedido", async () => {
    const r = await ask(TUESDAY_16H, "agende um corte para Cliente AB na terça às 10h");
    expect(r.state).toBe("pending_approval");
    expect(r.draft?.tool).toBe("booking.create");
    expect((r.draft?.payload as { starts_at: string }).starts_at).toBe("2026-10-27T13:00:00Z");
  });

  it("agendar: a hora ainda não passou, vale hoje", async () => {
    const r = await ask(TUESDAY_16H, "agende um corte para Cliente AB na terça às 17h");
    expect(r.state).toBe("pending_approval");
    expect((r.draft?.payload as { starts_at: string }).starts_at).toBe("2026-10-20T20:00:00Z");
  });

  it("agendar: 'hoje' com a hora passada continua sendo hoje, e a resposta diz que não dá", async () => {
    const r = await ask(TUESDAY_16H, "agende um corte para Cliente AB hoje às 10h");
    expect(r.state).toBe("recommendation");
    expect(r.draft).toBeNull();
  });
});

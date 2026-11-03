import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsText, icsUtc } from "./ics.ts";

describe(".ics da reserva (E10)", () => {
  it("horários em UTC com Z, a partir do horário com fuso", () => {
    expect(icsUtc("2026-10-20T12:00:00-03:00")).toBe("20261020T150000Z");
    expect(icsUtc("2026-10-20T15:30:00.000Z")).toBe("20261020T153000Z");
  });

  it("escapa vírgula, ponto e vírgula, barra e quebra de linha", () => {
    expect(icsText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
  });

  it("dobra linhas acima de 75 bytes sem cortar acento", () => {
    const line = `SUMMARY:${"ção ".repeat(30)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    const enc = new TextEncoder();
    expect(enc.encode(parts[0]).length).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) {
      expect(p.startsWith(" ")).toBe(true);
      expect(enc.encode(p).length).toBeLessThanOrEqual(75);
    }
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });

  it("evento completo com CRLF e só os campos dados", () => {
    const ics = buildIcs({
      uid: "abc@tinindo",
      starts_at: "2026-10-20T12:00:00-03:00",
      ends_at: "2026-10-20T12:30:00-03:00",
      summary: "Corte · Barbearia Exemplo A",
      url: "https://exemplo.test/p/barbearia",
      now: new Date("2026-10-19T10:00:00Z"),
    });
    expect(ics).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Tinindo//Reserva pelo link//PT-BR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:abc@tinindo",
        "DTSTAMP:20261019T100000Z",
        "DTSTART:20261020T150000Z",
        "DTEND:20261020T153000Z",
        "SUMMARY:Corte · Barbearia Exemplo A",
        "URL:https://exemplo.test/p/barbearia",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });
});

// "Adicionar à agenda" da reserva pelo link (auditoria de UX, E10): um arquivo .ics gerado no navegador.
// Horários em UTC (DTSTART/DTEND com Z), sem dados de terceiros: só o serviço, o nome público do profissional e o
// endereço do perfil. O telefone e o nome de quem reservou não entram no arquivo.

export interface CalendarEvent {
  uid: string;
  starts_at: string;
  ends_at: string;
  summary: string;
  description?: string;
  url?: string;
  /** Carimbo de criação (DTSTAMP); padrão: agora. */
  now?: Date;
}

/** 2026-10-20T10:00:00-03:00 → 20261020T130000Z */
export function icsUtc(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Texto de propriedade (RFC 5545, 3.3.11): barra, ponto e vírgula, vírgula e quebra de linha escapados. */
export function icsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Dobra linhas com mais de 75 bytes (RFC 5545, 3.1): continuação começa com um espaço. Não corta caractere ao meio. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(e: CalendarEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tinindo//Reserva pelo link//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsUtc(e.now ?? new Date())}`,
    `DTSTART:${icsUtc(e.starts_at)}`,
    `DTEND:${icsUtc(e.ends_at)}`,
    `SUMMARY:${icsText(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

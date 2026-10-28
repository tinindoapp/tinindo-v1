// Horários livres APENAS para a demonstração offline, a partir das fixtures do dia fixo.
// A regra real de disponibilidade é do motor de agenda (P03); isto não a substitui.
import type { Booking, ProviderService } from "@contracts";

const OFFSET = "-03:00"; // America/Sao_Paulo sem horário de verão (fixtures do piloto).
const DAY = "2026-10-20";
const OPEN = 9 * 60;
const CLOSE = 18 * 60;
const STEP = 30;

const at = (day: string, minutes: number) => {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${day}T${hh}:${mm}:00${OFFSET}`;
};

/** Horários livres de um dia ("2026-10-20"); sem dia, o dia fixo das fixtures. */
export function demoSlots(bookings: readonly Booking[], service: ProviderService, nowIso: string, day: string = DAY) {
  const busy = bookings
    .filter((b) => b.status === "held" || b.status === "confirmed")
    .map((b) => [Date.parse(b.starts_at), Date.parse(b.ends_at)] as const);
  const now = Date.parse(nowIso);
  const slots: { starts_at: string; ends_at: string }[] = [];
  for (let start = OPEN; start + service.duration_min <= CLOSE; start += STEP) {
    const s = Date.parse(at(day, start));
    const e = Date.parse(at(day, start + service.duration_min));
    const blockStart = s - service.buffer_before_min * 60_000;
    const blockEnd = e + service.buffer_after_min * 60_000;
    if (s < now) continue;
    if (busy.some(([bs, be]) => blockStart < be && bs < blockEnd)) continue;
    slots.push({ starts_at: at(day, start), ends_at: at(day, start + service.duration_min) });
  }
  return slots;
}

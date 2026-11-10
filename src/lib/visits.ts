// Última visita e próximo horário de cada cliente, lidos da agenda (P49: Clientes e a aba Retorno).
// O contrato `customer.list` não traz a última visita e `lifecycle.audience` só traz quem deu consentimento de
// marketing. Por isso a conta é feita aqui, sobre `booking.list` (janelas de até 62 dias), olhando LOOKBACK_DAYS para
// trás e AHEAD_DAYS para a frente. Visita mais antiga que a janela não aparece: a tela diz "nos últimos 6 meses".
import { type Booking, BookingListOutput } from "@contracts";
import type { createApiClient } from "./api/client.ts";
import { addDays, localParts } from "./time.ts";

/** Sem visita há este número de dias ou mais: "não volta" (filtro de Clientes e bloco da aba Retorno). */
export const LAPSED_DAYS = 30;
/** Quanto da agenda é lido para trás. */
export const LOOKBACK_DAYS = 180;
/** Quanto da agenda é lido para a frente (próximo horário marcado). */
export const AHEAD_DAYS = 60;
const WINDOW_DAYS = 60;
const MAX_PAGES = 10;
const DAY_MS = 86_400_000;

export interface VisitInfo {
  /** Início do atendimento concluído mais recente (antes de agora). */
  last_visit_at: string | null;
  /** Início do próximo atendimento marcado (confirmado ou reservado). */
  next_at: string | null;
}
export interface VisitSummary {
  /** Começo do período lido: visita anterior a isso não entra na conta. */
  since: string;
  /** false quando alguma janela parou no teto de páginas (há atendimentos que não vieram). */
  complete: boolean;
  byCustomer: Record<string, VisitInfo>;
}

type VisitLike = Pick<Booking, "customer_id" | "starts_at" | "status">;

/** Monta o resumo por cliente. Visita = atendimento concluído; próximo = confirmado ou reservado, a partir de agora. */
export function summarizeVisits(bookings: readonly VisitLike[], now: Date, since: string, complete = true): VisitSummary {
  const byCustomer: Record<string, VisitInfo> = {};
  const nowMs = now.getTime();
  for (const b of bookings) {
    if (!b.customer_id) continue;
    const at = Date.parse(b.starts_at);
    const info = (byCustomer[b.customer_id] ??= { last_visit_at: null, next_at: null });
    if (b.status === "completed" && at < nowMs) {
      if (!info.last_visit_at || at > Date.parse(info.last_visit_at)) info.last_visit_at = b.starts_at;
    } else if ((b.status === "confirmed" || b.status === "held") && at >= nowMs) {
      if (!info.next_at || at < Date.parse(info.next_at)) info.next_at = b.starts_at;
    }
  }
  return { since, complete, byCustomer };
}

/** Dias corridos entre a data local da visita e a de hoje, no fuso do negócio (ontem = 1). */
export function daysSince(iso: string, now: Date, timeZone: string): number {
  const a = Date.parse(`${localParts(iso, timeZone).date}T12:00:00Z`);
  const b = Date.parse(`${localParts(now, timeZone).date}T12:00:00Z`);
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/** Não volta: veio pelo menos uma vez no período lido, a última há LAPSED_DAYS ou mais, e não tem horário marcado. */
export function isLapsed(info: VisitInfo | undefined, now: Date, timeZone: string): boolean {
  return !!info?.last_visit_at && !info.next_at && daysSince(info.last_visit_at, now, timeZone) >= LAPSED_DAYS;
}

/** "há 1 dia", "há 12 dias", "hoje". */
export function agoText(days: number): string {
  return days === 0 ? "hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`;
}

/** Janelas de leitura: de LOOKBACK_DAYS atrás até AHEAD_DAYS à frente, em pedaços de WINDOW_DAYS. */
export function visitWindows(now: Date, timeZone: string): { starts_at: string; ends_at: string }[] {
  const today = localParts(now, timeZone).date;
  const out = [];
  for (let start = -LOOKBACK_DAYS; start < AHEAD_DAYS; start += WINDOW_DAYS) {
    const from = addDays(today, start);
    const to = addDays(today, Math.min(start + WINDOW_DAYS, AHEAD_DAYS));
    out.push({ starts_at: `${from}T00:00:00Z`, ends_at: `${to}T00:00:00Z` });
  }
  return out;
}

/** Lê a agenda pelo servidor (booking.list) e resume. O fuso só decide onde começam os dias. */
export async function readVisitSummary(call: ReturnType<typeof createApiClient>, tenantId: string, timeZone: string, now = new Date()): Promise<VisitSummary> {
  const windows = visitWindows(now, timeZone);
  let complete = true;
  const pages = await Promise.all(
    windows.map(async (window) => {
      const out: VisitLike[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data } = await call("/scheduling/booking.list", BookingListOutput, { method: "POST", tenantId, body: { window, cursor, limit: 100 } });
        out.push(...data.bookings);
        if (!data.next_cursor) return out;
        cursor = data.next_cursor;
      }
      complete = false;
      return out;
    }),
  );
  return summarizeVisits(pages.flat(), now, windows[0]!.starts_at, complete);
}

/** Demonstração offline: a mesma conta sobre a base de exemplo única (carregada só quando pedida). */
export async function demoVisitSummary(): Promise<VisitSummary> {
  const { demoNow, demoVisits } = await import("./demo/dataset.ts");
  const now = demoNow();
  return summarizeVisits(demoVisits(), now, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString());
}

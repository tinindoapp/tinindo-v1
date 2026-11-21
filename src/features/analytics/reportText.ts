// P32 bloco 4 · o relatório em frases: a mesma lista na tela, no texto para compartilhar e na imagem.
// Sem nome de cliente: só números, com o período e o denominador; sem base, "dados insuficientes".
import { formatDate } from "../../lib/time.ts";
import { formatCents } from "./format.ts";
import type { ReportMetric, ReportOutput } from "./reportPort.ts";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const INSUFFICIENT = "dados insuficientes";

export interface ReportLine { key: string; label: string; value: string; detail: string }

const of = (m: ReportMetric, unit: string, base: string) =>
  m.status === "insufficient" || m.value === null ? { value: INSUFFICIENT, detail: `${base}: ${m.denominator}` } : { value: `${m.value}`, detail: `${m.value} de ${m.denominator} ${unit}` };

export function periodText(r: ReportOutput): string {
  const end = new Date(Date.parse(r.in_progress ? r.until : r.period.ends_at) - (r.in_progress ? 0 : 1000));
  return `${formatDate(r.period.starts_at, r.timezone)} a ${formatDate(end, r.timezone)}${r.in_progress ? " (até agora)" : ""}`;
}

export function reportLines(r: ReportOutput): ReportLine[] {
  const done = of(r.services_done, "atendimentos que já começaram", "Atendimentos que já começaram");
  const noShow = of(r.no_shows, "atendimentos com desfecho", "Atendimentos com desfecho");
  const back = of(r.returned, "clientes atendidos", "Clientes atendidos");
  const gone = of(r.not_returned, "clientes do período anterior", "Clientes do período anterior");
  const slot = (s: ReportOutput["busiest"]) => (s ? `${WEEKDAY[s.weekday]}, ${String(s.hour).padStart(2, "0")}h (${s.count})` : r.hours_status === "no_hours" ? "sem expediente cadastrado" : INSUFFICIENT);
  return [
    { key: "done", label: "Atendimentos feitos", ...done },
    { key: "received", label: "Recebido", value: formatCents(r.received_cents.value), detail: "Recebimentos registrados no período, sem estornos" },
    { key: "open", label: "A receber", value: formatCents(r.to_receive_cents.value), detail: `${r.to_receive_cents.denominator ?? 0} cobranças em aberto agora` },
    { key: "noshow", label: "Faltas", ...noShow },
    { key: "back", label: "Clientes que voltaram", ...back },
    { key: "gone", label: "Clientes que não voltaram", ...gone },
    { key: "busy", label: "Horário mais cheio", value: slot(r.busiest), detail: r.hours_status === "insufficient" ? `Base: ${r.hours_denominator} atendimentos (precisa de pelo menos 5)` : `Base: ${r.hours_denominator} atendimentos no expediente` },
    { key: "quiet", label: "Horário mais vazio", value: slot(r.quietest), detail: `Hora do expediente com menos atendimentos, entre ${r.hours_denominator}` },
  ];
}

export function reportTitle(r: ReportOutput): string {
  return r.kind === "week" ? "Sua semana" : "Seu mês";
}

/** Texto para compartilhar (WhatsApp, e-mail): título, período e uma linha por número. */
export function reportShareText(r: ReportOutput, business: string | null): string {
  const head = `${reportTitle(r)}${business ? ` · ${business}` : ""}\n${periodText(r)}`;
  return [head, ...reportLines(r).map((l) => `${l.label}: ${l.value}`), "Feito na Tinindo."].join("\n");
}

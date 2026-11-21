// P32 · CSV do painel do piloto: uma linha por negócio, só números, datas e nomes de tela/operação.
import type { PilotBusiness } from "./port.ts";

const STEP_COLS = ["configured", "link_published", "first_booking", "first_service", "first_payment"] as const;
export const CSV_HEADER = [
  "negocio", "profissao", "medicao_ligada", "conta_criada_em", "passos_feitos", "passos_total",
  ...STEP_COLS.map((k) => `min_ate_${k}`), "voltou_no_dia_seguinte",
  "dias_com_uso", "telas_abertas", "comandos_ok", "comandos_recusados", "comandos_com_erro",
  "assistente_usd", "assistente_chamadas", "mensagens_modelo", "mensagens_texto", "mensagens_falharam",
  "agendamentos_criados", "atendimentos_feitos", "faltas", "cancelados", "recebimentos",
];

/** Aspas sempre, aspas internas dobradas; fórmula no começo (=, +, -, @) vira texto, para planilha não executar. */
export function cell(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function pilotCsv(rows: PilotBusiness[]): string {
  const lines = rows.map((b) => {
    const step = (k: string) => b.funnel.steps.find((s) => s.key === k);
    const sum = (f: "ok" | "refused" | "error") => b.usage.commands.reduce((n, c) => n + c[f], 0);
    return [
      b.name, b.profession, b.usage_enabled, b.funnel.signup_at, b.funnel.done, b.funnel.total,
      ...STEP_COLS.map((k) => step(k)?.minutes_since_signup ?? null), step("returned")?.done ?? false,
      b.usage.active_days, b.usage.screens.reduce((n, s) => n + s.count, 0), sum("ok"), sum("refused"), sum("error"),
      b.cost.assistant_usd, b.cost.assistant_calls, b.cost.messages_template, b.cost.messages_text, b.cost.messages_failed,
      b.counts.bookings_created, b.counts.services_done, b.counts.no_shows, b.counts.cancelled, b.counts.payments,
    ].map(cell).join(",");
  });
  return [CSV_HEADER.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}

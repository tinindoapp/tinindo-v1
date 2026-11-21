// Aviso por e-mail do "precisa de atenção" (P58). DESLIGADO por padrão: só liga com OPS_ALERT_EMAIL=on, o destinatário
// em OPS_ALERT_EMAIL_TO e a chave do Resend em OPS_ALERT_RESEND_KEY (segredos da função, nunca no repositório).
// A rotina ops_watch (job_ticks) diz quando avisar: notify = true só na passagem de ok para atenção, uma vez.
// O e-mail leva só os motivos e o link do painel; nenhum dado de negócio ou de cliente.

export interface WatchResult {
  state: "ok" | "attention";
  reasons: string[];
  notify: boolean;
}

const REASON_TEXT: Record<string, string> = {
  queue_late: "a fila de eventos está atrasada",
  tick_failing: "uma rotina do worker falhou 3 vezes seguidas",
  errors_over_ceiling: "os erros 5xx das funções passaram do teto da última hora",
};

/** O que o jobs_run devolveu em `ops_watch`, conferido; qualquer outra coisa = nada a avisar. */
export function watchOf(data: unknown): WatchResult | null {
  const w = (data as { ops_watch?: unknown } | null)?.ops_watch as Partial<WatchResult> | null | undefined;
  if (!w || typeof w !== "object" || (w.state !== "ok" && w.state !== "attention")) return null;
  const reasons = Array.isArray(w.reasons) ? w.reasons.filter((r): r is string => typeof r === "string" && /^[a-z_]{1,40}$/.test(r)) : [];
  return { state: w.state, reasons, notify: w.notify === true };
}

export function alertEmail(w: WatchResult, appUrl: string, envName: string): { subject: string; text: string } {
  const lines = w.reasons.map((r) => `- ${REASON_TEXT[r] ?? r}`);
  const panel = `${appUrl.replace(/\/$/, "")}/app/servicos-tinindo/operacao/saude`;
  return {
    subject: `Tinindo (${envName}): precisa de atenção`,
    text: [`A operação da Tinindo (${envName}) precisa de atenção:`, ...lines, "", `Painel: ${panel}`,
      "O que fazer, em passos: release/RUNBOOK.md, seção \"Quando o alerta acende\"."].join("\n"),
  };
}

export type AlertSender = (w: WatchResult) => Promise<void>;

/** Remetente pelo Resend, ou null quando o aviso por e-mail está desligado ou incompleto. */
export function resendSender(env: (k: string) => string | undefined, doFetch: typeof fetch = fetch): AlertSender | null {
  if (env("OPS_ALERT_EMAIL") !== "on") return null;
  const to = env("OPS_ALERT_EMAIL_TO");
  const key = env("OPS_ALERT_RESEND_KEY");
  if (!to || !key) return null;
  const from = env("OPS_ALERT_EMAIL_FROM") ?? "Tinindo <nao-responda@mail.tinindoapp.com.br>";
  const appUrl = env("PUBLIC_APP_URL") ?? "";
  const envName = env("OPS_ENV_NAME") ?? (appUrl.replace(/^https?:\/\//, "") || "ambiente");
  return async (w) => {
    const { subject, text } = alertEmail(w, appUrl, envName);
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: to.split(",").map((t) => t.trim()).filter(Boolean), subject, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
  };
}

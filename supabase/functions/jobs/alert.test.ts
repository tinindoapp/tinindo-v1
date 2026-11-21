import { describe, expect, it } from "vitest";
import { alertEmail, resendSender, watchOf } from "./alert.ts";
import { createJobsHandler } from "./handler.ts";

const SECRET = "s".repeat(40);
const post = () => new Request("http://edge/jobs", { method: "POST", headers: { "X-Tinindo-Jobs-Secret": SECRET } });

describe("alerta da operação na função jobs (P58)", () => {
  it("lê só o formato esperado de ops_watch", () => {
    expect(watchOf({ ops_watch: { state: "attention", reasons: ["queue_late", "x y", 3], notify: true } }))
      .toEqual({ state: "attention", reasons: ["queue_late"], notify: true });
    expect(watchOf({ ops_watch: { state: "quebrado" } })).toBeNull();
    expect(watchOf(null)).toBeNull();
  });

  it("e-mail desligado por padrão e sem destinatário ou chave", () => {
    const env = (m: Record<string, string>) => (k: string) => m[k];
    expect(resendSender(env({}))).toBeNull();
    expect(resendSender(env({ OPS_ALERT_EMAIL_TO: "a@b", OPS_ALERT_RESEND_KEY: "k" }))).toBeNull();
    expect(resendSender(env({ OPS_ALERT_EMAIL: "on", OPS_ALERT_EMAIL_TO: "a@b" }))).toBeNull();
    expect(resendSender(env({ OPS_ALERT_EMAIL: "on", OPS_ALERT_EMAIL_TO: "a@b", OPS_ALERT_RESEND_KEY: "k" }))).not.toBeNull();
  });

  it("e-mail leva os motivos e o link do painel, nada mais", () => {
    const m = alertEmail({ state: "attention", reasons: ["tick_failing", "errors_over_ceiling"], notify: true }, "https://homolog.tinindoapp.com.br/", "homologação");
    expect(m.subject).toBe("Tinindo (homologação): precisa de atenção");
    expect(m.text).toContain("uma rotina do worker falhou 3 vezes seguidas");
    expect(m.text).toContain("https://homolog.tinindoapp.com.br/app/servicos-tinindo/operacao/saude");
  });

  it("avisa uma vez na passagem; não avisa sem notify; falha do envio não muda a resposta", async () => {
    const sent: string[] = [];
    const logs: Record<string, unknown>[] = [];
    let notify = true;
    let fails = false;
    const handler = createJobsHandler({
      secret: SECRET,
      runJobs: async () => ({ data: { done: 0, tick_errors: {}, ops_watch: { state: "attention", reasons: ["queue_late"], notify } }, error: null }),
      alert: async (w) => {
        if (fails) throw new Error("resend 500");
        sent.push(w.reasons.join(","));
      },
      log: (e) => logs.push(e),
    });
    expect((await handler(post())).status).toBe(200);
    notify = false;
    expect((await handler(post())).status).toBe(200);
    notify = true;
    fails = true;
    expect((await handler(post())).status).toBe(200);
    expect(sent).toEqual(["queue_late"]);
    expect(logs.filter((l) => l.ops_attention)).toHaveLength(3);
    expect(logs.some((l) => l.ops_alert === "failed" && l.level === "error")).toBe(true);
  });

  it("o Resend recebe remetente, destinatários e texto", async () => {
    const calls: RequestInit[] = [];
    const send = resendSender((k) => ({ OPS_ALERT_EMAIL: "on", OPS_ALERT_EMAIL_TO: "ops@exemplo.test, outro@exemplo.test", OPS_ALERT_RESEND_KEY: "re_x", PUBLIC_APP_URL: "https://app.test" })[k],
      (async (_u: string, init: RequestInit) => { calls.push(init); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch)!;
    await send({ state: "attention", reasons: ["queue_late"], notify: true });
    const body = JSON.parse(String(calls[0].body)) as { to: string[]; subject: string };
    expect(body.to).toEqual(["ops@exemplo.test", "outro@exemplo.test"]);
    expect(body.subject).toBe("Tinindo (app.test): precisa de atenção");
    expect((calls[0].headers as Record<string, string>).Authorization).toBe("Bearer re_x");
  });
});

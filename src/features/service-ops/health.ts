// Saúde da operação (P58): leitura única de public.ops_health() para a equipe Tinindo. O banco decide quem lê (operador
// ativo); a tela só mostra. A resposta é conferida aqui: JSON do servidor não é confiável.
import { z } from "zod";

const Ts = z.string().nullable();
const Count = z.coerce.number().int().nonnegative();

export const OpsReason = z.object({
  code: z.string(),
  minutes: z.number().optional(),
  limit: z.number().optional(),
  count: z.number().optional(),
  ticks: z.array(z.string()).optional(),
});

export const OpsHealth = z.object({
  as_of: z.string(),
  attention: z.boolean(),
  reasons: z.array(OpsReason),
  outbox: z.object({
    pending: Count,
    processing: Count,
    due: Count,
    oldest_due_at: Ts,
    late_minutes: Count,
    oldest_pending_at: Ts,
    dead: Count,
    dead_24h: Count,
  }),
  dead_by_type: z.array(z.object({ event_type: z.string(), count: Count })),
  ticks: z.array(z.object({
    name: z.string(),
    enabled: z.boolean(),
    consecutive_failures: Count,
    last_error: z.string().nullable(),
    last_failed_at: Ts,
  })),
  errors: z.object({
    window_minutes: z.number(),
    functions: z.array(z.object({ fn: z.string(), count: Count })),
    function_total: Count,
    front: z.array(z.object({ kind: z.string(), count: Count })),
    front_total: Count,
  }),
  release: z.object({
    environment: z.string(),
    kind: z.enum(["publish", "revert"]),
    sha: z.string(),
    migrations_until: z.string().nullable(),
    functions: z.number().nullable(),
    published_at: z.string(),
  }).nullable(),
  watch: z.object({ state: z.enum(["ok", "attention"]), since: Ts, checked_at: Ts, notified_at: Ts, stale: z.boolean() }),
  limits: z.object({ queue_late_minutes: z.number(), tick_failures: z.number(), function_errors_per_hour: z.number() }),
});
export type OpsHealth = z.infer<typeof OpsHealth>;
export type OpsReason = z.infer<typeof OpsReason>;

export interface OpsHealthPort {
  readonly kind: "demo" | "server";
  health(): Promise<OpsHealth>;
}

/** Erro da leitura: FORBIDDEN (não é da equipe) ou falha qualquer. */
export class HealthError extends Error {
  constructor(readonly forbidden: boolean) {
    super(forbidden ? "FORBIDDEN" : "HEALTH_UNAVAILABLE");
  }
}

type RpcClient = { rpc(fn: string): PromiseLike<{ data: unknown; error: { message?: string | null; code?: string | null } | null }> };

export function createServerHealthPort(client: RpcClient): OpsHealthPort {
  return {
    kind: "server",
    async health() {
      const { data, error } = await client.rpc("ops_health");
      if (error) throw new HealthError(error.message === "FORBIDDEN" || error.code === "PT403");
      const parsed = OpsHealth.safeParse(data);
      if (!parsed.success) throw new HealthError(false);
      return parsed.data;
    },
  };
}

/** Demonstração: uma operação saudável com uma rotina que falhou uma vez, para a tela ter o que mostrar. */
export function createDemoHealthPort(now: () => Date): OpsHealthPort {
  return {
    kind: "demo",
    async health() {
      const t = now();
      const ago = (min: number) => new Date(t.getTime() - min * 60_000).toISOString();
      const ticks = ["expired_offers", "expired_holds", "recurrence", "referrals", "campaigns", "advice", "lifecycle", "insights", "retention", "privacy_erasure", "ops_watch"];
      return OpsHealth.parse({
        as_of: t.toISOString(),
        attention: false,
        reasons: [],
        outbox: { pending: 3, processing: 0, due: 1, oldest_due_at: ago(0), late_minutes: 0, oldest_pending_at: ago(2), dead: 1, dead_24h: 0 },
        dead_by_type: [{ event_type: "messaging.message.queued.v1", count: 1 }],
        ticks: ticks.map((name) => ({
          name, enabled: true, consecutive_failures: name === "insights" ? 1 : 0,
          last_error: name === "insights" ? "tempo esgotado ao ler as métricas (exemplo)" : null,
          last_failed_at: name === "insights" ? ago(1) : null,
        })),
        errors: { window_minutes: 60, functions: [{ fn: "scheduling", count: 2 }], function_total: 2, front: [{ kind: "call", count: 1 }], front_total: 1 },
        release: { environment: "demonstração", kind: "publish", sha: "0".repeat(40), migrations_until: null, functions: 29, published_at: ago(180) },
        watch: { state: "ok", since: null, checked_at: ago(0), notified_at: null, stale: false },
        limits: { queue_late_minutes: 15, tick_failures: 3, function_errors_per_hour: 20 },
      });
    },
  };
}

/** Frase de cada motivo, para a tela e para o smoke dizerem a mesma coisa. */
export function reasonText(r: OpsReason): string {
  switch (r.code) {
    case "queue_late":
      return `Fila de eventos atrasada: o mais antigo vencido espera há ${r.minutes ?? "?"} min (limite ${r.limit ?? "?"} min).`;
    case "tick_failing":
      return `Rotina com ${r.limit ?? 3} ou mais falhas seguidas: ${(r.ticks ?? []).join(", ")}.`;
    case "errors_over_ceiling":
      return `Erros 5xx das funções na última hora: ${r.count ?? "?"} (teto ${r.limit ?? "?"}).`;
    case "watch_stale":
      return `A rotina do alerta não roda há ${r.minutes ?? "?"} min: o worker (cron do jobs) pode ter parado.`;
    default:
      return `Motivo: ${r.code}.`;
  }
}

// EMULAÇÃO do painel do piloto para a demonstração: três negócios de exemplo, com o mesmo formato do servidor.
// Só números, datas e nomes de tela/operação (nada de cliente, contato ou valor), como no banco.
import { FIXED_NOW } from "@contracts/fixtures.ts";
import type { PilotBusiness, PilotPort } from "./port.ts";

const at = (minutes: number, base: string) => new Date(Date.parse(base) + minutes * 60_000).toISOString();
const step = (key: PilotBusiness["funnel"]["steps"][number]["key"], base: string, sinceSignup: number | null, prev: number | null) => ({
  key, done: sinceSignup !== null || (key === "returned" && prev === -1),
  at: sinceSignup === null || key === "returned" ? null : at(sinceSignup, base),
  minutes_since_signup: key === "returned" ? null : sinceSignup,
  minutes_since_previous: key === "returned" || key === "signup" ? null : prev,
});

function business(id: string, name: string, profession: string, signup: string, mins: (number | null)[], returned: boolean,
  usage: PilotBusiness["usage"], counts: PilotBusiness["counts"], cost: Partial<PilotBusiness["cost"]> = {}): PilotBusiness {
  const keys = ["signup", "configured", "link_published", "first_booking", "first_service", "first_payment"] as const;
  let prev = 0;
  const steps = keys.map((k, i) => {
    const m = mins[i] ?? null;
    const s = step(k, signup, m, m === null ? null : m - prev);
    if (m !== null) prev = m;
    return s;
  });
  steps.push({ ...step("returned", signup, null, returned ? -1 : null), done: returned });
  return {
    tenant_id: id, name, profession, usage_enabled: true,
    funnel: { tenant_id: id, signup_at: signup, timezone: "America/Sao_Paulo", steps, done: steps.filter((s) => s.done).length, total: 7 },
    usage, counts,
    cost: { assistant_usd: 0, assistant_calls: 0, assistant_months: "Assistente por mês inteiro (o uso é guardado por mês): os meses que tocam o período.",
      messages_template: 0, messages_text: 0, messages_failed: 0, ...cost },
  };
}

export function demoPanel(now: Date) {
  const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  return [
    business("10000000-0000-4000-8000-00000000000a", "Barbearia Exemplo A", "barber", day(20), [0, 35, 50, 95, 1460, 1475], true,
      { active_days: 6, screens: [{ name: "/app/agenda", count: 41 }, { name: "/app/caixa", count: 12 }, { name: "/app/clientes", count: 9 }],
        commands: [{ name: "scheduling/booking.create", ok: 14, refused: 2, error: 0 }, { name: "finance/payment.record", ok: 11, refused: 0, error: 1 }],
        problems: [{ name: "scheduling/booking.create", outcome: "refused", code: "SLOT_CONFLICT", count: 2, last_at: day(1) },
          { name: "finance/payment.record", outcome: "error", code: "INTERNAL_ERROR", count: 1, last_at: day(2) }],
        opened_30d: ["/app/agenda", "/app/caixa", "/app/clientes", "/app/inicio"] },
      { bookings_created: 16, services_done: 13, no_shows: 1, cancelled: 2, payments: 11 }, { assistant_usd: 0.0412, assistant_calls: 37, messages_template: 9, messages_text: 4 }),
    business("10000000-0000-4000-8000-00000000000b", "Studio Exemplo B", "personal_trainer", day(9), [0, 80, null, 300, null, null], false,
      { active_days: 2, screens: [{ name: "/app/agenda", count: 5 }, { name: "/app/configurar", count: 4 }],
        commands: [{ name: "setup/setup.apply_draft", ok: 1, refused: 1, error: 0 }],
        problems: [{ name: "setup/setup.apply_draft", outcome: "refused", code: "VALIDATION_ERROR", count: 1, last_at: day(8) }],
        opened_30d: ["/app/agenda", "/app/configurar"] },
      { bookings_created: 1, services_done: 0, no_shows: 0, cancelled: 0, payments: 0 }),
    business("10000000-0000-4000-8000-00000000000c", "Salão Exemplo C", "hairdresser", day(1), [0, null, null, null, null, null], false,
      { active_days: 1, screens: [{ name: "/app/configurar", count: 2 }], commands: [], problems: [], opened_30d: ["/app/configurar"] },
      { bookings_created: 0, services_done: 0, no_shows: 0, cancelled: 0, payments: 0 }),
  ];
}

export function createDemoPilotPort(): PilotPort {
  const now = () => new Date(FIXED_NOW);
  return {
    kind: "demo",
    now,
    async panel(period) {
      return { period, as_of: now().toISOString(), businesses: structuredClone(demoPanel(now())), truncated: { businesses: false } };
    },
  };
}

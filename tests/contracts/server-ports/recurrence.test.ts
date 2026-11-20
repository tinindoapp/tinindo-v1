// Porta de servidor de Assinaturas contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { CustomerListOutput } from "@contracts";
import { createServerPort } from "../../../src/features/recurrence/serverPort.ts";
import type { RecurrenceSubscription } from "../../../src/features/recurrence/port.ts";
import { exercisePort, sampleOf, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const sub = { id: ID, version: 5 } as RecurrenceSubscription;

/** Duas páginas de clientes: a primeira devolve cursor, a segunda encerra. */
function customerPages() {
  let page = 0;
  return () => ({ ...(sampleOf(CustomerListOutput, "customer.list") as object), next_cursor: (page += 1) === 1 ? "pagina-2" : null });
}

describe("recurrence · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("recurrence", (call) => createServerPort(call, TENANT), {
      base: (p) => p.base(),
      plans: (p) => p.plans(),
      savePlan: (p, key) => p.savePlan({ service_id: ID, name: "Barba semanal", sessions_per_cycle: 4, cycle_days: 30, price_cents: 12000 }, key),
      subscriptions: (p) => p.subscriptions(),
      subscribe: (p, key) => p.subscribe(ID, OTHER, key),
      cancel: (p, key) => p.cancel(sub, false, "Mudou de cidade", key),
      resume: (p, key) => p.resume(sub, key),
      cycles: (p) => p.cycles(ID),
    }, { alsoReads: ["crm"], responses: { "customer.list": customerPages() } });

    expect(calls.base!.map((c) => c.path)).toEqual(["/context", "/crm/services?limit=100", "/crm/customers?limit=100", "/crm/customers?limit=100&cursor=pagina-2"]);
    expect(calls.subscribe![0]!.body).toEqual({ plan_id: ID, customer_id: OTHER });
    expect(calls.cancel![0]!.body).toEqual({ subscription_id: ID, expected_version: 5, at_period_end: false, reason: "Mudou de cidade" });
    expect(calls.resume![0]!.body).toEqual({ subscription_id: ID, expected_version: 5 });
    expect(unusedOperations("recurrence", calls)).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { AnalyticsMetricsOutput } from "@contracts";
import { demoCounts } from "../../lib/demo/dataset.ts";
import { createDemoPort, resetDemoState } from "./demoPort.ts";

const past = { starts_at: "2026-09-22T03:00:00Z", ends_at: "2026-10-20T03:00:00Z" };

describe("demonstração do Resultado", () => {
  beforeEach(() => resetDemoState());
  it("respeita o contrato: sem dado não é zero, causalidade não estabelecida", async () => {
    const out = AnalyticsMetricsOutput.parse(await createDemoPort().metrics(past, null));
    // Base de exemplo única: os números saem das mesmas contagens que o Caixa e as Metas usam.
    const c = demoCounts(past);
    const reminders = out.metrics.find((m) => m.key === "reminders")!;
    expect([reminders.numerator, reminders.denominator]).toEqual([c.reminders, c.withCustomer]); // P13: medido
    expect(out.metrics.find((m) => m.key === "received")?.value).toBe(c.received);
    expect(out.metrics.find((m) => m.key === "waitlist_acceptance")?.status).toBe("insufficient");
    expect(out.causality).toBe("not_established");
  });
  it("baseline só com período encerrado; repetição devolve a mesma; comparação com diferença", async () => {
    const port = createDemoPort();
    await expect(port.createBaseline("Futuro", { starts_at: past.starts_at, ends_at: "2026-10-25T03:00:00Z" }, "k0")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const b = await port.createBaseline("Antes", past, "k1");
    expect((await port.createBaseline("Antes", past, "k1")).id).toBe(b.id);
    const cmp = await port.metrics({ starts_at: "2026-10-13T03:00:00Z", ends_at: "2026-10-20T03:00:00Z" }, b.id);
    const rem = cmp.comparison?.find((c) => c.key === "reminders");
    expect(rem?.delta).toBeCloseTo(rem!.current_value! - rem!.baseline_value!, 4);
    expect(cmp.comparison?.find((c) => c.key === "occupancy")?.delta).not.toBeNull();
  });
});

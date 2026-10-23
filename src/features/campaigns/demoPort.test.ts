import { beforeEach, describe, expect, it } from "vitest";
import { CampaignOutput, CampaignPreviewOutput } from "@contracts";
import { createDemoPort, resetDemoState } from "./demoPort.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);

describe("demonstração de Campanhas (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());

  it("público só autorizado; hash velho não aprova; controle sorteado; tetos aplicados; quem entrou sai do público", async () => {
    const port = createDemoPort();
    const p = CampaignPreviewOutput.parse(await port.preview({ kind: "marketing_all" }));
    expect(p.audience_count).toBe(8); // 10 clientes: 1 sem consentimento, 1 com atendimento futuro
    expect(await code(port.approve({ name: "x", segment: { kind: "marketing_all" }, audience_hash: "0".repeat(64), max_sends: 10 }, "a0"))).toBe("STALE_VERSION/audience_hash");
    expect(await code(port.approve({ name: "x", segment: { kind: "marketing_all" }, audience_hash: p.audience_hash, max_sends: 10, offer: { kind: "discount_pct", pct: 90 } }, "a1"))).toBe("VALIDATION_ERROR/offer.pct");
    const c = CampaignOutput.parse({ campaign: await port.approve({ name: "Volta", segment: { kind: "marketing_all" }, audience_hash: p.audience_hash, control_pct: 50, max_sends: 3, spend_cap_cents: 1200,
      offer: { kind: "discount_pct", pct: 10, service_id: (await port.services())[0]!.id } }, "a2") }).campaign;
    expect(c).toMatchObject({ control_count: 4, treatment_count: 2, estimated_cost_cents: 1200, status: "running", result: { design: "randomized_control", verdict: "inconclusive" } });
    expect((await port.preview({ kind: "marketing_all" })).audience_count).toBe(2);
    expect((await port.get(c.id)).members.filter((m) => m.arm === "treatment" && m.step_status === "manual")).toHaveLength(2);
    expect(await code(port.approve({ name: "Volta", segment: { kind: "marketing_all" }, audience_hash: p.audience_hash, control_pct: 50, max_sends: 3 }, "a3"))).toBe("STALE_VERSION/audience_hash");
  });

  it("resultado por braço com intervalo; sem controle = observação; cancelar para o pendente; medição fecha", async () => {
    const port = createDemoPort();
    const p = await port.preview({ kind: "inactive_days", days: 30 });
    const obs = await port.approve({ name: "Obs", segment: { kind: "inactive_days", days: 30 }, audience_hash: p.audience_hash, control_pct: 0, max_sends: 2 }, "b0");
    expect(obs.result.verdict).toBe("observation_only");
    const cancelled = await port.cancel(obs, "b1");
    expect(cancelled).toMatchObject({ status: "cancelled", result: { final: true } });
    expect((await port.get(obs.id)).members.every((m) => m.step_status === "cancelled")).toBe(true);
    expect(await code(port.cancel(cancelled, "b2"))).toBe("POLICY_REJECTED/status");
    const p2 = await port.preview({ kind: "marketing_all" });
    const exp = await port.approve({ name: "Exp", segment: { kind: "marketing_all" }, audience_hash: p2.audience_hash, control_pct: 50, max_sends: 10 }, "b3");
    expect(exp.control_count + exp.treatment_count).toBe(8);
    const closed = await port.simulate!(exp.id);
    expect(closed.status).toBe("closed");
    expect(closed.result.final).toBe(true);
    expect(closed.result.arms.treatment.converted).toBe(3);
    expect(closed.result.arms.control.converted).toBe(1);
    expect(closed.result.arms.treatment.ci[0]).toBeLessThanOrEqual(closed.result.arms.treatment.rate!);
    expect(["difference_detected", "no_difference_detected", "inconclusive"]).toContain(closed.result.verdict);
    expect(JSON.stringify(closed.result)).not.toMatch(/caus|efeito/);
  });
});

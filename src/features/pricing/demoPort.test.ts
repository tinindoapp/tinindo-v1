import { describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { createDemoPort } from "./demoPort.ts";

const input = {
  service_id: FX.services.corteA, discount_bps: 2000, max_discount_bps: 1000, target_margin_bps: 0,
  windows: [{ weekday: 3, local_start: "09:00", local_end: "12:00" }],
  valid: { starts_at: "2026-10-20T12:00:00Z", ends_at: "2027-01-01T03:00:00Z" },
};

describe("emulação de preços", () => {
  it("prévia respeita o teto, aprovação vale só para o mesmo conteúdo e uma vez", async () => {
    const port = createDemoPort();
    const p = await port.propose(input, "chave-preco-0000000001");
    expect(p.preview).toMatchObject({ example_final_cents: 5400, effective_discount_bps: 1000 });
    await expect(port.approve({ proposal_id: p.proposal_id, payload_hash: "0".repeat(64), expected_version: 1 }, "chave-preco-0000000002"))
      .rejects.toMatchObject({ code: "POLICY_REJECTED" });
    const a = await port.approve({ proposal_id: p.proposal_id, payload_hash: p.payload_hash!, expected_version: 1 }, "chave-preco-0000000003");
    const rule = await port.publish({ proposal_id: p.proposal_id, approval_id: a.approval_id, expected_version: 1 }, "chave-preco-0000000004");
    expect(rule).toMatchObject({ rule_version: 4, active: true });
    await expect(port.publish({ proposal_id: p.proposal_id, approval_id: a.approval_id, expected_version: 2 }, "chave-preco-0000000005"))
      .rejects.toMatchObject({ code: "POLICY_REJECTED" });
    expect((await port.list()).rules.filter((r) => r.active)).toHaveLength(1);
  });

  it("piso acima da base bloqueia a proposta", async () => {
    const port = createDemoPort();
    await expect(port.propose({ ...input, target_margin_bps: 8000 }, "chave-preco-0000000006"))
      .rejects.toMatchObject({ code: "POLICY_REJECTED", field: "floor" });
  });
});

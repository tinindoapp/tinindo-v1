// Porta de servidor de Preços contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/pricing/serverPort.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const HASH = "a".repeat(64);
const rule = {
  service_id: ID,
  windows: [{ weekday: 2, local_start: "14:00", local_end: "17:00" }],
  discount_bps: 1500,
  max_discount_bps: 2000,
  valid: { starts_at: "2026-11-01T03:00:00Z", ends_at: "2026-12-01T03:00:00Z" },
};
// Regra publicada à mão: o gerador não acerta a janela semanal (fim depois do início).
const published = {
  rule_id: OTHER, service_id: ID, rule_version: 1, windows: rule.windows, discount_bps: 1500, max_discount_bps: 2000,
  target_margin_bps: 0, valid: rule.valid, active: true, published_at: "2026-10-20T12:00:00Z", version: 3,
};

describe("pricing · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("pricing", (call) => createServerPort(call, TENANT), {
      now: (p) => p.now(),
      timezone: (p) => p.timezone(),
      services: (p) => p.services(),
      list: (p) => p.list(),
      propose: (p, key) => p.propose(rule, key),
      approve: (p, key) => p.approve({ proposal_id: ID, payload_hash: HASH, expected_version: 1 }, key),
      publish: (p, key) => p.publish({ proposal_id: ID, approval_id: OTHER, expected_version: 1 }, key),
      deactivate: (p, key) => p.deactivate({ rule_id: ID, expected_version: 3 }, key),
    }, {
      alsoReads: ["crm"],
      responses: {
        "pricing.list_rules": { rules: [published], proposals: [] },
        "pricing.publish_rule": { rule: published },
        "pricing.deactivate_rule": { rule: published },
      },
    });

    expect(calls.now).toEqual([]);
    expect(calls.services![0]!.path).toBe("/crm/services?limit=100");
    // A proposta vai como a tela montou; a aprovação cita o hash e a versão vistos.
    expect(calls.propose![0]!.body).toEqual(rule);
    expect(calls.approve![0]!.body).toEqual({ proposal_id: ID, payload_hash: HASH, expected_version: 1 });
    expect(calls.publish![0]!.body).toEqual({ proposal_id: ID, approval_id: OTHER, expected_version: 1 });
    // A cotação é chamada pela Lista de espera e pela agenda, não pela tela de Preços.
    expect(unusedOperations("pricing", calls)).toEqual(["pricing.quote"]);
  });
});

// Porta de servidor de Campanhas contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/campaigns/serverPort.ts";
import type { ApproveInput, Campaign, CampaignSegment } from "../../../src/features/campaigns/port.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const segment: CampaignSegment = { kind: "inactive_days", days: 60 };
const approval: ApproveInput = {
  name: "Volta de quem sumiu",
  segment,
  audience_hash: "a".repeat(64),
  control_pct: 20,
  max_sends: 100,
  spend_cap_cents: null,
  window_days: 14,
  offer: { kind: "discount_pct", pct: 10, service_id: ID },
};
const campaign = { id: ID, version: 4 } as Campaign;

describe("campaigns · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("campaigns", (call) => createServerPort(call, TENANT), {
      services: (p) => p.services(),
      preview: (p) => p.preview(segment),
      approve: (p, key) => p.approve(approval, key),
      list: (p) => p.list(),
      get: (p) => p.get(ID),
      cancel: (p, key) => p.cancel(campaign, key),
    }, { alsoReads: ["crm"] });

    // Os serviços da oferta vêm do CRM, por GET.
    expect(calls.services![0]).toMatchObject({ path: "/crm/services?limit=100", method: "GET", operation: "service.list" });
    expect(calls.preview![0]!.body).toEqual({ segment });
    // A aprovação vai como a tela montou, sem campo a mais nem a menos.
    expect(calls.approve![0]!.body).toEqual(approval);
    expect(calls.cancel![0]!.body).toEqual({ campaign_id: ID, expected_version: 4 });
    // A tela de Campanhas alcança todo o módulo.
    expect(unusedOperations("campaigns", calls)).toEqual([]);
  });
});

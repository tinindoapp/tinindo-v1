// Portas de servidor do Relacionamento (réguas e aba Retorno) contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { BookingListOutput, ContextResponse, CustomerListOutput } from "@contracts";
import { createServerReturnSource } from "../../../src/features/lifecycle/retorno.ts";
import { createServerPort } from "../../../src/features/lifecycle/serverPort.ts";
import { exercisePort, sampleOf, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const HASH = "b".repeat(64);

// As janelas da agenda usam o fuso do contexto: o exemplo gerado ("x") não é um fuso de verdade.
const context = { ...(sampleOf(ContextResponse, "context") as object), timezone: "America/Sao_Paulo" };
/** Duas páginas de clientes: a primeira devolve cursor, a segunda encerra. */
function customerPages() {
  let page = 0;
  return () => ({ ...(sampleOf(CustomerListOutput, "customer.list") as object), next_cursor: (page += 1) === 1 ? "pagina-2" : null });
}
/** Agenda em duas páginas por janela: sem cursor devolve um; com cursor encerra. */
const bookingPages = (body: unknown) => ({
  ...(sampleOf(BookingListOutput, "booking.list") as object),
  next_cursor: (body as { cursor?: string }).cursor ? null : "pagina-2",
});

describe("lifecycle · portas do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("lifecycle", (call) => createServerPort(call, TENANT), {
      settings: (p) => p.settings(),
      saveSettings: (p, key) => p.saveSettings({ reminder_hours: [24, 2], daily_budget: 50 }, 0, key),
      steps: (p) => p.steps(null),
      markShared: (p, key) => p.markShared(ID, key),
      cancelStep: (p, key) => p.cancelStep(ID, key),
      setConsent: (p, key) => p.setConsent(ID, "marketing", true, key),
      audience: (p) => p.audience(),
      approveCampaign: (p, key) => p.approveCampaign(HASH, 30, key),
      campaigns: (p) => p.campaigns(),
    });

    // O ajuste parcial vai dentro de `settings`; a versão vista vai ao lado (0 = nunca salvo).
    expect(calls.saveSettings![0]!.body).toEqual({ settings: { reminder_hours: [24, 2], daily_budget: 50 }, expected_version: 0 });
    expect(calls.steps![0]!.body).toEqual({ status: null });
    expect(calls.approveCampaign![0]!.body).toEqual({ audience_hash: HASH, max_sends: 30 });

    // Aba Retorno: só leituras, de clientes, agenda e lista de espera.
    let waitlist: unknown;
    const board = await exercisePort("lifecycle", (call) => createServerReturnSource(call, TENANT), {
      board: async (p) => { waitlist = (await p.board()).waitlist; },
    }, {
      alsoReads: ["crm", "scheduling", "waitlist"],
      responses: { context, "customer.list": customerPages(), "booking.list": bookingPages },
    });
    const used = board.board!.map((c) => c.operation);
    expect(board.board!.filter((c) => c.operation === "customer.list").map((c) => c.path)).toEqual(["/crm/customers?limit=100", "/crm/customers?limit=100&cursor=pagina-2"]);
    // A porta engole falha da lista de espera: aqui a leitura tem de ter passado pelo contrato.
    expect(used).toContain("waitlist.list");
    expect(waitlist).toEqual({ waiting: 1, openSlots: 1 });
    expect(board.board!.every((c) => c.idempotencyKey === undefined)).toBe(true);

    expect(unusedOperations("lifecycle", { ...calls, ...board })).toEqual([]);
  });
});

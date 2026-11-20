// Porta de servidor de Contas contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { ContextResponse } from "@contracts";
import { createServerPort } from "../../../src/features/finance-advanced/serverPort.ts";
import type { AccEntry, AccPayable, AccSeries } from "../../../src/features/finance-advanced/port.ts";
import { exercisePort, sampleOf, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const payable = { id: ID, version: 4 } as AccPayable;
const series = { id: OTHER, version: 2 } as AccSeries;
// A porta calcula "hoje" no fuso do contexto: o exemplo gerado ("x") não é um fuso de verdade.
const context = { ...(sampleOf(ContextResponse, "context") as object), timezone: "America/Sao_Paulo" };
const entry = { entry_kind: "expense", entry_id: ID, amount_cents: 900, description: "Aluguel" } as AccEntry;

describe("finance-advanced · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("finance-advanced", (call) => createServerPort(call, TENANT), {
      base: (p) => p.base(),
      categories: (p) => p.categories(),
      saveCategory: (p, key) => p.saveCategory({ kind: "expense", name: "Produtos", base: "supplies" }, key),
      classify: (p, key) => p.classify(entry, OTHER, key),
      entries: (p) => p.entries("2026-10"),
      payables: (p) => p.payables("2026-10-01", "2026-10-31"),
      savePayable: (p, key) => p.savePayable({ description: "Aluguel", amount_cents: 120000, due_on: "2026-11-05", monthly: true }, key),
      pay: (p, key) => p.pay(payable, "2026-10-20T15:00:00Z", key),
      reverse: (p, key) => p.reverse(payable, key),
      cancel: (p, key) => p.cancel(payable, key),
      updateSeries: (p, key) => p.updateSeries(series, "end", key),
      reconciliation: (p) => p.reconciliation("2026-10-20"),
      reconcile: (p, key) => p.reconcile("2026-10-20", "pix", "manual", 35000, key),
      statement: (p) => p.statement("2026-10"),
    }, { responses: { context } });

    // Do lançamento só vão o tipo e o id; o resto da linha fica na tela.
    expect(calls.classify![0]!.body).toEqual({ entry_kind: "expense", entry_id: ID, category_id: OTHER });
    expect(calls.pay![0]!.body).toEqual({ payable_id: ID, expected_version: 4, paid_at: "2026-10-20T15:00:00Z" });
    expect(calls.cancel![0]!.body).toEqual({ payable_id: ID, expected_version: 4 });
    expect(calls.updateSeries![0]!.body).toEqual({ series_id: OTHER, expected_version: 2, action: "end" });
    expect(unusedOperations("finance-advanced", calls)).toEqual([]);
  });
});

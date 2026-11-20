// Portas de servidor da Lista de espera (dono e link público) contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { CustomerListOutput } from "@contracts";
import { createServerLinkPort, createServerPort } from "../../../src/features/waitlist/serverPort.ts";
import type { WaitlistEntry } from "../../../src/features/waitlist/types.ts";
import { contractCall, exercisePort, sampleOf, TENANT, testKey, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const TOKEN = "A".repeat(43);
const slot = { starts_at: "2026-10-21T17:00:00Z", ends_at: "2026-10-21T17:30:00Z" };
const windows = [{ weekday: 3, local_start: "14:00", local_end: "18:00" }];
const RESOURCE = "00000000-0000-4000-8000-0000000000c3";
// Agenda à mão: o gerador não acerta a janela semanal (fim depois do início).
const scheduleSettings = { resource_id: RESOURCE, resource_version: 1, timezone: "America/Sao_Paulo", rules: [{ weekday: 3, local_start: "09:00", local_end: "18:00" }] };
const entry = { id: ID, service_id: OTHER, version: 2 } as WaitlistEntry;

/** Duas páginas de clientes: a primeira devolve cursor, a segunda encerra. */
function customerPages() {
  let page = 0;
  return () => ({ ...(sampleOf(CustomerListOutput, "customer.list") as object), next_cursor: (page += 1) === 1 ? "pagina-2" : null });
}

describe("waitlist · portas do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("waitlist", (call) => {
      // join manda duas chaves (a recebida e uma derivada): tem caso próprio abaixo.
      const { join: _join, ...port } = createServerPort(call, TENANT);
      return port;
    }, {
      now: (p) => p.now(),
      base: (p) => p.base(),
      list: (p) => p.list(),
      withdraw: (p, key) => p.withdraw(entry, key),
      prepareOffer: (p, key) => p.prepareOffer(entry, slot, key),
      markShared: (p, key) => p.markShared(ID, key),
      cancelOffer: (p, key) => p.cancelOffer(ID, key),
    }, { alsoReads: ["crm", "scheduling", "pricing"], responses: { "customer.list": customerPages(), "schedule.settings": scheduleSettings } });

    expect(calls.now).toEqual([]);
    expect(calls.withdraw![0]!.body).toEqual({ entry_id: ID, expected_version: 2 });
    // A oferta cota o horário no recurso da agenda e cita a cotação recebida.
    const [settings, quote, offer] = calls.prepareOffer!;
    expect(settings!.operation).toBe("schedule.settings");
    expect(quote!.body).toEqual({ service_id: OTHER, resource_id: RESOURCE, slot });
    expect(offer!.body).toEqual({ entry_id: ID, slot, quote_id: "00000000-0000-4000-8000-000000000001" });

    // Link público: sem negócio no header; o token vai só no corpo.
    const link = await exercisePort("waitlist", (call) => createServerLinkPort(call), {
      view: (p) => p.view(TOKEN),
      accept: (p, key) => p.accept(TOKEN, key),
      decline: (p, key) => p.decline(TOKEN, key),
    }, { tenant: "none" });
    expect(link.accept![0]!.body).toEqual({ token: TOKEN });
    expect(link.view![0]!.path).not.toContain(TOKEN);

    // Entrar na lista: consentimento e entrada são dois comandos; a entrada cita o consentimento gravado.
    const join = contractCall("waitlist");
    const key = testKey(99);
    await createServerPort(join.call, TENANT).join({ customer_id: ID, service_id: OTHER, windows, valid_until: "2026-11-20T03:00:00Z" }, key);
    expect(join.calls.map((c) => [c.operation, c.idempotencyKey])).toEqual([["consent.record", `${key}-consent`], ["waitlist.join", key]]);
    expect(join.calls[1]!.body).toEqual({
      customer_id: ID, service_id: OTHER, acceptable_windows: windows, consent_id: "00000000-0000-4000-8000-000000000001", valid_until: "2026-11-20T03:00:00Z",
    });

    // Revogar consentimento ainda não tem tela.
    expect(unusedOperations("waitlist", { ...calls, ...link, join: join.calls })).toEqual(["consent.revoke"]);
  });
});

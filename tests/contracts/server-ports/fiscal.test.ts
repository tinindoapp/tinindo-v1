// Porta de servidor de Notas fiscais contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/fiscal/serverPort.ts";
import type { CancelDraft, EmitDraft, ProfileDraft } from "../../../src/features/fiscal/port.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const TERMS = "b".repeat(64);
const profile: ProfileDraft = { expected_version: 0, legal_name: "Barbearia Exemplo LTDA", cnpj: "11.222.333/0001-81", regime: "mei", municipality_ibge: "3550308", service_code: "06.01" };
const emission: EmitDraft = { receivable_id: ID, taker_name: "Maria Silva", taker_document: null, description: "Corte de cabelo", amount_cents: 5000, competence_date: "2026-10-20" };
const cancellation: CancelDraft = { document_id: ID, expected_version: 2, reason: "Nota emitida com valor errado" };

describe("fiscal · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("fiscal", (call) => createServerPort(call, TENANT), {
      overview: (p) => p.overview(),
      saveProfile: (p, key) => p.saveProfile(profile, key),
      grant: (p, key) => p.grant(TERMS, key),
      revoke: (p, key) => p.revoke(key),
      checkCredential: (p) => p.checkCredential(),
      emit: (p, key) => p.emit(emission, key),
      cancel: (p, key) => p.cancel(cancellation, key),
      folder: (p) => p.folder("2026-10"),
    });

    // Conceder e revogar são a mesma operação, separadas pelo campo `action`.
    expect(calls.grant![0]).toMatchObject({ operation: "fiscal.representation", body: { action: "grant", terms_hash: TERMS } });
    expect(calls.revoke![0]).toMatchObject({ operation: "fiscal.representation", body: { action: "revoke" } });
    // Conferir a credencial é consulta: sem chave.
    expect(calls.checkCredential![0]).toMatchObject({ operation: "fiscal.credential_check", body: {}, idempotencyKey: undefined });
    expect(calls.cancel![0]!.body).toEqual(cancellation);
    expect(calls.folder![0]!.body).toEqual({ month: "2026-10" });
    // A tela de Notas fiscais alcança todo o módulo.
    expect(unusedOperations("fiscal", calls)).toEqual([]);
  });
});

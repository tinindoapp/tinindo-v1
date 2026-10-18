import { beforeEach, describe, expect, it } from "vitest";
import { createDemoPort, resetDemoState } from "./demoPort.ts";

beforeEach(() => resetDemoState());

describe("assistente · emulação", () => {
  it("consulta responde pelo motor real, sem proposta", async () => {
    const a = await createDemoPort().ask("quantos atendimentos tenho hoje?", "k-ask-0001");
    expect(a.state).toBe("consulted");
    expect(a.text).toMatch(/5 atendimentos confirmados/);
    expect(a.text).toMatch(/R\$\s271,00/);
    expect(a.proposal).toBeNull();
  });

  it("proposta → aprovação única → execução idempotente", async () => {
    const port = createDemoPort();
    const a = await port.ask("marca um corte pra Maria Exemplo Silva quinta às 10h", "k-ask-0002");
    expect(a.state).toBe("pending_approval");
    const p = a.proposal!;
    expect(p.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    const approval = await port.approve(p, "k-appr-0001");
    await expect(port.approve(p, "k-appr-0002")).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect((await port.approve(p, "k-appr-0001")).approval_id).toBe(approval.approval_id);
    const r1 = await port.execute(approval.approval_id, "k-exec-0001");
    const r2 = await port.execute(approval.approval_id, "k-exec-0002");
    expect(r1.status).toBe("executed");
    expect(r2).toEqual(r1);
    const after = await port.ask("o que tenho quinta?", "k-ask-0003");
    expect(after.text).toMatch(/10:00 Corte — Maria Exemplo Silva/);
  });

  it("aprovação velha não executa quando a agenda mudou", async () => {
    const port = createDemoPort();
    const first = (await port.ask("marca um corte pra Maria Exemplo Silva quinta às 11h", "k-ask-0004")).proposal!;
    const second = (await port.ask("marca um corte pra Maria Exemplo Souza quinta às 11h", "k-ask-0005")).proposal!;
    const a1 = await port.approve(first, "k-appr-0003");
    const a2 = await port.approve(second, "k-appr-0004");
    expect((await port.execute(a1.approval_id, "k-exec-0003")).status).toBe("executed");
    expect((await port.execute(a2.approval_id, "k-exec-0004")).status).toBe("rejected_by_policy");
  });
});

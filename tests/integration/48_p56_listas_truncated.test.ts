// P56 · Aviso de corte nas listas com teto (D31 (a)) e rotinas isoladas, pelos handlers com o banco real.
// 1. A RPC do caixa devolve `truncated` por lista; o handler continua respondendo dentro do contrato (as telas não
//    mudam). Enquanto o contrato não declarar `truncated`, o handler o descarta: o teste 2 trava esse estado, para o
//    recado da tela (contrato + aviso) saber exatamente o que mudar e este teste ser atualizado junto.
// 2. O worker (jobs) segue respondendo com tick_errors vazio numa rodada sem falha.
// Os lançamentos ficam num período de 400 dias atrás, no negócio B, para não mexer nos outros arquivos do banco comum.
import { afterAll, describe, expect, it } from "vitest";
import { FinanceLedgerOutput } from "@contracts";
import { call, iso, ok, pool, rpc, runJobs, sql, T, U } from "./harness.ts";

afterAll(() => pool.end());
const owner = { as: U.ownerB, tenant: T.B };
const from = new Date(Date.now() - 410 * 86_400_000);
const to = new Date(Date.now() - 390 * 86_400_000);
const period = { starts_at: iso(from), ends_at: iso(to) };
const args = { p_tenant_id: T.B, p_from: period.starts_at, p_to: period.ends_at };

describe("P56 · listas com teto avisam o corte", () => {
  it("1 · até o teto: truncated false; teto + 1: true, e a lista continua em 200", async () => {
    const before = await rpc(U.ownerB, "finance_ledger", args);
    expect(before.error).toBeNull();
    expect((before.data as { truncated: unknown }).truncated).toEqual({ receivables: false, payments: false, expenses: false });

    // Seed direto no banco só para montar o volume (despesa não tem leitura de cenário pela tela).
    await sql(`insert into public.expense_entries (tenant_id, amount_cents, paid_at, category)
      select $1, 1000 + g, $2::timestamptz + make_interval(mins => g), 'other' from generate_series(1, 200) g`, [T.B, period.starts_at]);
    const at200 = await rpc(U.ownerB, "finance_ledger", args);
    expect((at200.data as { truncated: { expenses: boolean } }).truncated.expenses).toBe(false);

    await sql(`insert into public.expense_entries (tenant_id, amount_cents, paid_at, category) values ($1, 999, $2, 'other')`,
      [T.B, iso(new Date(from.getTime() + 3600_000 * 24 * 5))]);
    const at201 = await rpc(U.ownerB, "finance_ledger", args);
    const data = at201.data as { expenses: unknown[]; truncated: { expenses: boolean; payments: boolean } };
    expect(data.expenses).toHaveLength(200);
    expect(data.truncated.expenses).toBe(true);
    expect(data.truncated.payments).toBe(false);
  });

  it("2 · pelo handler: resposta dentro do contrato de sempre, 200 itens (truncated ainda fora do contrato)", async () => {
    const ledger = await ok(FinanceLedgerOutput, "finance", "finance.ledger", { ...owner, body: { period } });
    expect(ledger.expenses).toHaveLength(200);
    const raw = await call("finance", "finance.ledger", { ...owner, body: { period } });
    // Quando o contrato ganhar `truncated` (recado para-felipe do P56), troque por: toEqual({ ..., expenses: true }).
    expect(raw.data).not.toHaveProperty("truncated");
  });

  it("3 · worker: rodada sem falha devolve tick_errors vazio", async () => {
    const run = await runJobs() as unknown as { tick_errors: unknown; expired_holds: number };
    expect(run.tick_errors).toEqual({});
    expect(typeof run.expired_holds).toBe("number");
  });
});

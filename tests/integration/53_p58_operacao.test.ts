// P58 parte 2 · operação, com o banco real: a captura da função (withBuild) grava pela RPC aberta a anon; a leitura de
// saúde que o banco entrega passa no schema que o painel usa; o worker devolve ops_watch e o alerta acende com 21 erros.
import { afterAll, describe, expect, it } from "vitest";
import { withBuild } from "../../supabase/functions/_shared/http/build.ts";
import type { CapturedError } from "../../supabase/functions/_shared/http/capture.ts";
import { OpsHealth } from "../../src/features/service-ops/health.ts";
import { pool, rpc, runJobs, sql } from "./harness.ts";

afterAll(() => pool.end());

const OPERATOR = "d0000000-0000-4000-8000-0000000000dd";
const OWNER = "a0000000-0000-4000-8000-00000000000a";
const SHA = "afb8caf0123456789abcdef0123456789abcdef0";
const RID = "53535353-5353-4535-8535-535353535353";

/** O gravador de produção chama a RPC pela Data API com a chave pública: aqui, a mesma RPC como anon. */
const record = async (row: CapturedError) => {
  const r = await rpc(null, "ops_error_record", {
    p_source: "function", p_kind: row.kind, p_fn: row.fn, p_route: row.route, p_status: row.status,
    p_code: row.code, p_build_sha: row.build_sha, p_request_id: row.request_id,
  });
  if (r.error) throw new Error(String(r.error.message));
};

describe("P58 · captura, saúde e alerta", () => {
  it("exceção na função vira 500 e uma linha sem dado em ops_errors", async () => {
    const res = await withBuild(() => { throw new Error("cliente Fulana"); }, SHA, record)(
      new Request("http://edge/functions/v1/finance/finance.ledger", { method: "POST", headers: { "X-Request-Id": RID } }));
    expect(res.status).toBe(500);
    const rows = await sql<Record<string, unknown>>("select source, kind, fn, route, status, code, build_sha, request_id::text from public.ops_errors where request_id = $1", [RID]);
    expect(rows).toEqual([{ source: "function", kind: "exception", fn: "finance", route: "finance.ledger", status: 500, code: "INTERNAL_ERROR", build_sha: SHA, request_id: RID }]);
  });

  it("a saúde do banco passa no schema do painel; dono não lê", async () => {
    await sql("insert into public.platform_operators (user_id, display_name) values ($1, 'Operadora (exemplo)') on conflict do nothing", [OPERATOR]);
    const r = await rpc(OPERATOR, "ops_health", {});
    expect(r.error).toBeNull();
    const h = OpsHealth.parse(r.data);
    expect(h.errors.functions).toContainEqual({ fn: "finance", count: 1 });
    expect(h.ticks.map((t) => t.name)).toContain("ops_watch");
    const owner = await rpc(OWNER, "ops_health", {});
    expect(owner.error?.message).toBe("FORBIDDEN");
  });

  it("o worker devolve ops_watch; 21 erros na hora acendem o alerta e avisam uma vez", async () => {
    const first = (await runJobs()) as unknown as { ops_watch: { state: string; notify: boolean } };
    expect(first.ops_watch).toMatchObject({ state: "ok", notify: false });
    await sql("insert into public.ops_errors (source, kind, fn) select 'function', 'http_5xx', 'scheduling' from generate_series(1, 20)");
    const second = (await runJobs()) as unknown as { ops_watch: { state: string; reasons: string[]; notify: boolean } };
    expect(second.ops_watch).toEqual({ state: "attention", reasons: ["errors_over_ceiling"], notify: true, purged: 0 });
    const third = (await runJobs()) as unknown as { ops_watch: { notify: boolean } };
    expect(third.ops_watch.notify).toBe(false);
    const h = OpsHealth.parse((await rpc(OPERATOR, "ops_health", {})).data);
    expect(h.attention).toBe(true);
    expect(h.watch.state).toBe("attention");
    await sql("delete from public.ops_errors where fn = 'scheduling'");
    const back = (await runJobs()) as unknown as { ops_watch: { state: string } };
    expect(back.ops_watch.state).toBe("ok");
  });
});

// P57 pelos handlers com o banco real: um negócio novo exporta os próprios dados (arquivo gravado pela política do
// bucket com o JWT do dono, link com prazo), exporta e elimina um cliente final, pede a eliminação do negócio com
// carência, cancela, pede de novo e a rotina executa depois da carência. A retenção roda pelo worker de sempre.
// O Storage é simulado sobre storage.objects COM o papel e o JWT do usuário: as políticas do bucket valem de verdade.
import { afterAll, describe, expect, it } from "vitest";
import { BusinessCreateOutput, CrmCustomerUpsertOutput } from "@contracts";
import { createPrivacyHandler } from "../../supabase/functions/privacy/handler.ts";
import { PrivacyEraseOutput, PrivacyErasuresListOutput, PrivacyExportOutput, PrivacyExportsListOutput } from "../../supabase/functions/privacy/contract.ts";
import { ok, pool, rpc, runJobs, sql } from "./harness.ts";

afterAll(() => pool.end());

const OWNER = "57000000-0000-4000-8000-0000000000aa";
const STRANGER = "57000000-0000-4000-8000-0000000000bb";

/** Uma operação com o papel e o JWT do usuário, como o Storage faria pela API. */
async function asUser<T>(user: string, run: (q: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await client.query("set local role authenticated");
    const out = await run((text, values) => client.query(text, values));
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const files = new Map<string, string>();
const privacy = createPrivacyHandler({
  allowedOrigins: [],
  rpc: (token, fn, args) => rpc(token, fn, args),
  storage: {
    async upload(token, path, body) {
      await asUser(token, (q) => q(
        "insert into storage.objects (bucket_id, name, owner_id) values ('privacy-exports', $1, $2) on conflict (bucket_id, name) do update set updated_at = now()",
        [path, token]));
      files.set(path, new TextDecoder().decode(body));
    },
    async signedUrl(token, path, seconds) {
      const { rows } = await asUser(token, (q) => q("select name from storage.objects where bucket_id = 'privacy-exports' and name = $1", [path]));
      if (rows.length !== 1) throw new Error("sem acesso ao arquivo");
      return `https://storage.exemplo.test/sign/privacy-exports/${path}?ttl=${seconds}`;
    },
  },
});

async function call(op: string, as: string, tenant: string, body: unknown, key?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${as}`, "X-Tinindo-Tenant": tenant, "Content-Type": "application/json" };
  if (key) headers["Idempotency-Key"] = key;
  const res = await privacy(new Request(`http://edge/functions/v1/privacy/${op}`, { method: "POST", headers, body: JSON.stringify(body) }));
  const json = (await res.json()) as { data?: unknown; error?: { code: string; field?: string } };
  return { status: res.status, data: json.data, error: json.error ?? null };
}
const key = (s: string) => `p57-int-${s}-${crypto.randomUUID().slice(0, 8)}`;

describe("P57 · exportar e eliminar pelos handlers", () => {
  let tenant = "";
  let customer = "";

  it("0 · negócio novo com um cliente", async () => {
    await sql("insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', 'p57-dono@example.test'), ($2, 'authenticated', 'authenticated', 'p57-outro@example.test') on conflict do nothing", [OWNER, STRANGER]);
    const created = await ok(BusinessCreateOutput, "identity", "business.create", { as: OWNER, key: true, body: {
      name: "Salão P57 (int)", profession: "hairdresser", accepted_policy_versions: ["termos-piloto-v0", "privacidade-piloto-v0"] } });
    tenant = created.tenant.id;
    expect(tenant).toMatch(/^[0-9a-f-]{36}$/);
    const saved = await ok(CrmCustomerUpsertOutput, "crm", "customer.upsert", { as: OWNER, tenant, key: true,
      body: { name: "Maria Titular", phone: "+5511966665757", email: "maria@example.test" } });
    customer = saved.customer.id;
  });

  it("1 · dono exporta o negócio: arquivo gravado pela política do bucket, link com prazo, sem segredos", async () => {
    const k = key("exp");
    const r = await call("privacy.export", OWNER, tenant, { scope: "business" }, k);
    expect(r.status).toBe(201);
    const out = PrivacyExportOutput.parse(r.data);
    expect(out.export.status).toBe("ready");
    expect(out.download.url).toContain(`${tenant}/${out.export.id}.json`);
    const file = JSON.parse(files.get(`${tenant}/${out.export.id}.json`)!) as { format: string; data: Record<string, Record<string, unknown>[]> };
    expect(file.format).toBe("tinindo.export.v1");
    expect(file.data.customers!.map((c) => c.name)).toEqual(["Maria Titular"]);
    expect(JSON.stringify(file)).not.toMatch(/"(code_hash|token_hash|idem_key|request_hash)"/);
    // Repetir com a mesma chave: mesmo pedido, sem outro arquivo.
    const again = PrivacyExportOutput.parse((await call("privacy.export", OWNER, tenant, { scope: "business" }, k)).data);
    expect(again.export.id).toBe(out.export.id);
    expect((await sql<{ n: number }>("select count(*)::int as n from public.privacy_exports where tenant_id = $1", [tenant]))[0]!.n).toBe(1);
    // Link novo e lista.
    expect((await call("privacy.export_link", OWNER, tenant, { export_id: out.export.id })).status).toBe(200);
    const list = PrivacyExportsListOutput.parse((await call("privacy.exports", OWNER, tenant, {})).data);
    expect(list.items.map((e) => e.id)).toEqual([out.export.id]);
  });

  it("2 · quem não é dono não exporta, não lista e não lê o arquivo", async () => {
    expect((await call("privacy.export", STRANGER, tenant, { scope: "business" }, key("x"))).error?.code).toBe("FORBIDDEN");
    expect((await call("privacy.exports", STRANGER, tenant, {})).error?.code).toBe("FORBIDDEN");
    const [{ name }] = await sql<{ name: string }>("select storage_path as name from public.privacy_exports where tenant_id = $1", [tenant]);
    const seen = await asUser(STRANGER, (q) => q("select name from storage.objects where bucket_id = 'privacy-exports' and name = $1", [name]));
    expect(seen.rows).toHaveLength(0);
  });

  it("3 · exporta e elimina um cliente final: cadastro sem nome nem contato, trilha sem dado pessoal", async () => {
    const r = await call("privacy.export", OWNER, tenant, { scope: "customer", customer_id: customer }, key("expc"));
    const out = PrivacyExportOutput.parse(r.data);
    const file = JSON.parse(files.get(`${tenant}/${out.export.id}.json`)!) as { data: { customers: { name: string; email: string }[] } };
    expect(file.data.customers).toEqual([expect.objectContaining({ name: "Maria Titular", email: "maria@example.test" })]);
    expect((await call("privacy.erase", OWNER, tenant, { scope: "customer", customer_id: customer }, key("erc"))).status).toBe(400);
    const er = PrivacyEraseOutput.parse((await call("privacy.erase", OWNER, tenant, { scope: "customer", customer_id: customer, confirm: "ELIMINAR" }, key("erc"))).data);
    expect(er.erasure.status).toBe("done");
    const [c] = await sql<{ name: string; phone: string | null; email: string | null }>("select name, phone, email from public.customers where id = $1", [customer]);
    expect(c).toEqual({ name: "Cliente removido", phone: null, email: null });
    const audit = await sql<{ after: unknown }>("select after from public.audit_events where tenant_id = $1 and action like 'privacy.%'", [tenant]);
    expect(JSON.stringify(audit)).not.toMatch(/Maria|maria@|5511966665757/);
  });

  it("4 · eliminar o negócio: carência de 7 dias, cancelável; depois dela a rotina do worker encerra", async () => {
    const first = PrivacyEraseOutput.parse((await call("privacy.erase", OWNER, tenant, { scope: "business", confirm: "ELIMINAR" }, key("erb"))).data);
    expect(first.erasure.status).toBe("scheduled");
    expect(Date.parse(first.erasure.execute_after) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect((await call("privacy.erase", OWNER, tenant, { scope: "business", confirm: "ELIMINAR" }, key("erb2"))).error).toMatchObject({ code: "POLICY_REJECTED", field: "scheduled" });
    const cancelled = PrivacyEraseOutput.parse((await call("privacy.erase_cancel", OWNER, tenant, { erasure_id: first.erasure.id }, key("cancel"))).data);
    expect(cancelled.erasure.status).toBe("cancelled");
    const second = PrivacyEraseOutput.parse((await call("privacy.erase", OWNER, tenant, { scope: "business", confirm: "ELIMINAR" }, key("erb3"))).data);
    await runJobs();
    expect((await sql<{ status: string }>("select status from public.tenants where id = $1", [tenant]))[0]!.status).toBe("active");
    await sql("update public.privacy_erasures set execute_after = now() - interval '1 minute' where id = $1", [second.erasure.id]);
    await runJobs();
    expect((await sql<{ status: string }>("select status from public.tenants where id = $1", [tenant]))[0]!.status).toBe("closed");
    const list = await sql<{ status: string }>("select status from public.privacy_erasures where id = $1", [second.erasure.id]);
    expect(list[0]!.status).toBe("done");
    // Acesso encerrado: o antigo dono não lê mais nada do negócio.
    expect((await call("privacy.erasures", OWNER, tenant, {})).error?.code).toBe("FORBIDDEN");
    expect(PrivacyErasuresListOutput.safeParse({ items: [] }).success).toBe(true);
  });

  it("5 · a retenção roda no worker de sempre e registra só contagens", async () => {
    await sql("insert into public.idempotency_records (tenant_id, actor_user_id, operation, key, request_hash, created_at) values ($1, $2, 'privacy.test', $3, $4, now() - interval '40 days')",
      ["10000000-0000-4000-8000-00000000000a", "a0000000-0000-4000-8000-00000000000a", key("old"), "b".repeat(64)]);
    await runJobs();
    expect((await sql<{ n: number }>("select count(*)::int as n from public.idempotency_records where operation = 'privacy.test'"))[0]!.n).toBe(0);
    const runs = await sql<Record<string, unknown>>("select * from public.retention_runs where category = 'idempotency' order by id desc limit 1");
    expect(Object.keys(runs[0]!).sort()).toEqual(["affected", "category", "id", "ran_at"]);
  });
});

// Harness de integração handler ↔ banco real (P10). Monta cada Edge Function com a MESMA lógica de index.ts,
// trocando só o transporte: em vez de PostgREST com JWT, chama a RPC pelo `pg` numa transação com os claims
// do usuário e o papel (`anon`, `authenticated`, `service_role`) que o Supabase usaria. Nada é mockado:
// autorização, idempotência, versão, eventos e auditoria acontecem no Postgres de verdade.
// Uso: scripts/db-integration.sh cria o banco (shim + migrations + seed) e exporta PG*.
import { Pool, types } from "pg";
import { createAgentHandler } from "../../supabase/functions/agent/handler.ts";
import { createAnalyticsHandler } from "../../supabase/functions/analytics/handler.ts";
import { createContextHandler } from "../../supabase/functions/context/handler.ts";
import { createCrmHandler } from "../../supabase/functions/crm/handler.ts";
import { createFinanceHandler } from "../../supabase/functions/finance/handler.ts";
import { createIdentityHandler } from "../../supabase/functions/identity/handler.ts";
import { createJobsHandler, JOBS_SECRET_HEADER } from "../../supabase/functions/jobs/handler.ts";
import { createLifecycleHandler } from "../../supabase/functions/lifecycle/handler.ts";
import { createRecurrenceHandler } from "../../supabase/functions/recurrence/handler.ts";
import { createReferralsHandler } from "../../supabase/functions/referrals/handler.ts";
import { createCampaignsHandler } from "../../supabase/functions/campaigns/handler.ts";
import { createGrowthAdviceHandler } from "../../supabase/functions/growth-advice/handler.ts";
import { createPresenceHandler } from "../../supabase/functions/presence/handler.ts";
import { createDiscoveryHandler } from "../../supabase/functions/discovery/handler.ts";
import { createFiscalHandler, SYNC_SECRET_HEADER as FISCAL_SYNC_HEADER } from "../../supabase/functions/fiscal/handler.ts";
import { createSimulatedFiscalProvider, type FiscalProviderPort } from "../../supabase/functions/_shared/domain/fiscal/providers.ts";
import { createMessagingHandler, DISPATCH_SECRET_HEADER } from "../../supabase/functions/messaging/handler.ts";
import { createSimulatedProvider } from "../../supabase/functions/_shared/domain/messaging/providers.ts";
import { createNetworkHandler } from "../../supabase/functions/network/handler.ts";
import { createPaymentsHandler, SYNC_SECRET_HEADER } from "../../supabase/functions/payments/handler.ts";
import { createSimulatedPaymentProvider } from "../../supabase/functions/_shared/domain/payments/providers.ts";
import { createPricingHandler } from "../../supabase/functions/pricing/handler.ts";
import { createSalesHandler } from "../../supabase/functions/sales/handler.ts";
import { createSchedulingHandler } from "../../supabase/functions/scheduling/handler.ts";
import { createServiceOpsHandler } from "../../supabase/functions/service-ops/handler.ts";
import { createWaitlistHandler } from "../../supabase/functions/waitlist/handler.ts";
import { ErrorEnvelope, IDEMPOTENCY_HEADER, successEnvelope, TENANT_HEADER } from "@contracts";
import { FX } from "@contracts/fixtures.ts";
import type { z } from "zod";

// int8/numeric como number: os contratos esperam inteiros JS (centavos dentro do inteiro seguro).
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export const pool = new Pool({ max: 8 });
export const PUBLIC_APP_URL = "https://app.exemplo.test";
// Segredos de teste montados em tempo de execução (baixa entropia no fonte: a varredura de segredos não os confunde com vazamento).
export const JOBS_SECRET = "segredo-de-teste-".repeat(3);
export const DISPATCH_SECRET = "segredo-do-despacho-".repeat(2);
export const SIM_SECRET = "segredo-do-simulador-".repeat(2);
export const SYNC_SECRET = "segredo-do-sync-de-teste-".repeat(2);

interface Signature { args: { name: string; type: string }[]; setReturning: boolean }
const signatures = new Map<string, Signature>();

async function signature(fn: string): Promise<Signature> {
  const hit = signatures.get(fn);
  if (hit) return hit;
  const { rows } = await pool.query<{ args: string; proretset: boolean }>(
    `select pg_get_function_identity_arguments(p.oid) as args, p.proretset
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1 order by p.oid desc limit 1`, [fn]);
  if (!rows[0]) throw new Error(`RPC public.${fn} não existe`);
  const args = rows[0].args.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, ...type] = s.split(/\s+/);
    return { name: name!, type: type.join(" ") };
  });
  const sig = { args, setReturning: rows[0].proretset };
  signatures.set(fn, sig);
  return sig;
}

function serialize(value: unknown, type: string): unknown {
  if (value === undefined || value === null) return null;
  if (type === "jsonb" || type === "json") return JSON.stringify(value);
  if (type.endsWith("[]")) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/** Papel do worker (jobs). Só o harness de teste impersona este papel; o app nunca o usa (regra do lint). */
// eslint-disable-next-line no-restricted-syntax -- harness de integração, não código do app
const WORKER_ROLE = "service_role";
export type Actor = string | null | "worker";

/** Uma RPC = uma transação, como no PostgREST. accessToken é o id do usuário (o "JWT" do teste). */
export async function rpc(actor: Actor, fn: string, args: Record<string, unknown>) {
  const sig = await signature(fn);
  const unknownArgs = Object.keys(args).filter((k) => !sig.args.some((a) => a.name === k));
  if (unknownArgs.length) return { data: null, error: { code: "42883", message: `argumento desconhecido: ${unknownArgs.join(", ")}` } };
  const placeholders = sig.args.map((a, i) => `${a.name} => $${i + 1}::${a.type}`).join(", ");
  const values = sig.args.map((a) => serialize(args[a.name], a.type));
  const sql = sig.setReturning ? `select to_jsonb(x) as data from public.${fn}(${placeholders}) x` : `select public.${fn}(${placeholders}) as data`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (actor === "worker") {
      await client.query(`set local role ${WORKER_ROLE}`);
    } else if (actor === null) {
      await client.query("set local role anon");
    } else {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actor, role: "authenticated" })]);
      await client.query("set local role authenticated");
    }
    const res = await client.query(sql, values);
    await client.query("commit");
    const data = sig.setReturning ? res.rows.map((r) => r.data) : res.rows[0]?.data ?? null;
    return { data, error: null };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    const err = e as { code?: string; message?: string; hint?: string };
    return { data: null, error: { code: err.code ?? null, message: err.message ?? null, hint: err.hint ?? null } };
  } finally {
    client.release();
  }
}

const userRpc = (token: string, fn: string, args: Record<string, unknown>) => rpc(token, fn, args);
const anyRpc = (token: string | null, fn: string, args: Record<string, unknown>) => rpc(token, fn, args);
const deps = { allowedOrigins: [] as string[] };
/** DNS simulado da P17: nome → valores TXT. O teste escreve aqui o que o cliente "criou" no DNS dele. */
export const DNS = new Map<string, string[]>();
/** Provedor fiscal da P16 nos testes: homologação simulada; produção trocável pelo teste. */
export const FISCAL = { homologacao: createSimulatedFiscalProvider() as FiscalProviderPort, producao: { name: "rest", configured: false, environments: [] } as unknown as FiscalProviderPort };
export const FISCAL_SYNC_SECRET = "segredo-do-sync-fiscal-de-teste-".repeat(2);

export const handlers: Record<string, (req: Request) => Promise<Response>> = {
  context: createContextHandler({ ...deps, resolveContext: async (token, tenantId) => {
    const r = await rpc(token, "resolve_context", { p_tenant_id: tenantId });
    return { data: r.data as unknown[] | null, error: r.error };
  } }),
  identity: createIdentityHandler({ ...deps, rpc: userRpc }),
  crm: createCrmHandler({ ...deps, rpc: userRpc }),
  scheduling: createSchedulingHandler({ ...deps, rpc: userRpc }),
  pricing: createPricingHandler({ ...deps, rpc: userRpc }),
  waitlist: createWaitlistHandler({ ...deps, rpc: anyRpc }),
  finance: createFinanceHandler({ ...deps, rpc: userRpc }),
  agent: createAgentHandler({ ...deps, rpc: userRpc }),
  network: createNetworkHandler({ ...deps, rpc: anyRpc, publicAppUrl: PUBLIC_APP_URL, listPublicSlots: async (input) => {
    const r = await rpc(null, "scheduling_public_slots", { p_slug: input.slug, p_service_id: input.service_id, p_from: input.window.starts_at, p_to: input.window.ends_at });
    if (r.error) throw new Error("public_slots_unavailable");
    return r.data as { slots: { starts_at: string; ends_at: string }[]; timezone: string };
  } }),
  sales: createSalesHandler({ ...deps, rpc: anyRpc }),
  "service-ops": createServiceOpsHandler({ ...deps, rpc: userRpc }),
  analytics: createAnalyticsHandler({ ...deps, rpc: userRpc }),
  lifecycle: createLifecycleHandler({ ...deps, rpc: userRpc }),
  recurrence: createRecurrenceHandler({ ...deps, rpc: userRpc }),
  referrals: createReferralsHandler({ ...deps, rpc: userRpc }),
  campaigns: createCampaignsHandler({ ...deps, rpc: userRpc }),
  "growth-advice": createGrowthAdviceHandler({ ...deps, rpc: userRpc }),
  presence: createPresenceHandler({ ...deps, rpc: userRpc, anonRpc: (fn, args) => rpc(null, fn, args), serviceRpc: (fn, args) => rpc("worker", fn, args),
    publicAppUrl: PUBLIC_APP_URL, cnameTarget: null, resolveTxt: async (name) => DNS.get(name) ?? [] }),
  discovery: createDiscoveryHandler({ ...deps, rpc: userRpc, anonRpc: (fn, args) => rpc(null, fn, args), publicAppUrl: PUBLIC_APP_URL }),
  fiscal: createFiscalHandler({ ...deps, rpc: userRpc, serviceRpc: (fn, args) => rpc("worker", fn, args), syncSecret: FISCAL_SYNC_SECRET, providers: FISCAL }),
  messaging: createMessagingHandler({ ...deps, rpc: userRpc, dispatchSecret: DISPATCH_SECRET, simulatedSecret: SIM_SECRET, verifyToken: null,
    serviceRpc: (fn, args) => rpc("worker", fn, args),
    providers: { simulated: createSimulatedProvider({ secret: SIM_SECRET, deliver: async (phone, from, body, id) => {
      await rpc("worker", "channel_sim_deliver", { p_phone_e164: phone, p_from_account: from, p_body: body, p_provider_message_id: id });
    } }) } }),
  payments: createPaymentsHandler({ ...deps, rpc: userRpc, anonRpc: (fn, args) => rpc(null, fn, args), serviceRpc: (fn, args) => rpc("worker", fn, args),
    syncSecret: SYNC_SECRET, simulatedSecret: SIM_SECRET, publicAppUrl: PUBLIC_APP_URL,
    providers: { simulated: createSimulatedPaymentProvider({ secret: SIM_SECRET, store: (fn, args) => rpc("worker", fn, args) }) } }),
  jobs: createJobsHandler({ secret: JOBS_SECRET, runJobs: async (batch) => {
    const r = await rpc("worker", "jobs_run", { p_batch: batch });
    return { data: r.data, error: r.error };
  } }),
};

export interface CallOptions {
  /** Usuário (id) ou null para anônimo. */
  as?: string | null;
  tenant?: string | null;
  body?: unknown;
  /** Idempotency-Key; `true` gera uma nova. */
  key?: string | true;
  method?: "GET" | "POST";
  query?: Record<string, string>;
}
export interface CallResult { status: number; data: unknown; error: z.infer<typeof ErrorEnvelope>["error"] | null; requestId: string | null }

let seq = 0;
export const newKey = () => `k-${Date.now().toString(36)}-${(++seq).toString(36).padStart(4, "0")}-${crypto.randomUUID().slice(0, 8)}`;

/** Chama /functions/v1/<module>/<op> como a tela chamaria, e devolve o envelope já desmontado. */
export async function call(module: string, op: string, opts: CallOptions = {}): Promise<CallResult> {
  const handler = handlers[module];
  if (!handler) throw new Error(`módulo ${module} não existe no harness`);
  const method = opts.method ?? (opts.body === undefined && (module === "context" || op === "customers" || op === "services" || op === "profile.get" || op === "public.profile" || op === "referral.list") ? "GET" : "POST");
  const url = new URL(`http://edge/functions/v1/${module}${op ? `/${op}` : ""}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.as !== null && opts.as !== undefined) headers.Authorization = `Bearer ${opts.as}`;
  if (opts.tenant) headers[TENANT_HEADER] = opts.tenant;
  if (opts.key) headers[IDEMPOTENCY_HEADER] = opts.key === true ? newKey() : opts.key;
  if (method === "POST") headers["Content-Type"] = "application/json";
  const res = await handler(new Request(url, { method, headers, body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined }));
  const json: unknown = await res.json().catch(() => null);
  const requestId = res.headers.get("X-Request-Id");
  if (res.ok) {
    const env = successEnvelope((await import("zod")).z.unknown()).safeParse(json);
    if (!env.success) throw new Error(`envelope de sucesso inválido em ${module}/${op}: ${JSON.stringify(json)}`);
    return { status: res.status, data: env.data.data, error: null, requestId };
  }
  const env = ErrorEnvelope.safeParse(json);
  if (!env.success) throw new Error(`envelope de erro inválido em ${module}/${op}: ${JSON.stringify(json)}`);
  return { status: res.status, data: null, error: env.data.error, requestId };
}

/** Atalho: exige sucesso e devolve `data` tipado pelo schema do contrato. */
export async function ok<T extends z.ZodType>(schema: T, module: string, op: string, opts: CallOptions = {}): Promise<z.infer<T>> {
  const r = await call(module, op, opts);
  if (r.error) throw new Error(`${module}/${op} falhou: ${r.status} ${r.error.code} ${r.error.field ?? ""} ${r.error.message}`);
  const parsed = schema.safeParse(r.data);
  if (!parsed.success) throw new Error(`${module}/${op} fora do contrato: ${parsed.error.message}`);
  return parsed.data;
}

/** Atalho: exige o erro do catálogo (e, opcionalmente, o campo). */
export async function fails(module: string, op: string, opts: CallOptions, code: string, field?: string): Promise<void> {
  const r = await call(module, op, opts);
  if (!r.error) throw new Error(`${module}/${op} deveria falhar com ${code}, mas respondeu ${r.status}`);
  if (r.error.code !== code || (field !== undefined && r.error.field !== field)) {
    throw new Error(`${module}/${op}: esperado ${code}${field ? `/${field}` : ""}, obtido ${r.error.code}/${r.error.field ?? "-"}`);
  }
}

/** Uma rodada do despacho do canal (P12) como o cron chamaria. */
export async function runDispatch(): Promise<{ sent: number; failed: number; unknown: number; reconciled: number }> {
  const res = await handlers.messaging!(new Request("http://edge/functions/v1/messaging/channel.dispatch", { method: "POST", headers: { [DISPATCH_SECRET_HEADER]: DISPATCH_SECRET } }));
  const json = await res.json() as { data: { sent: number; failed: number; unknown: number; reconciled: number } };
  return json.data;
}

/** Uma rodada do sync de pagamentos (P14) como o cron chamaria. */
export async function runPaymentSync(): Promise<{ checked: number; settled: number; closed: number; still_unknown: number }> {
  const res = await handlers.payments!(new Request("http://edge/functions/v1/payments/payment.sync", { method: "POST", headers: { [SYNC_SECRET_HEADER]: SYNC_SECRET } }));
  const json = await res.json() as { data: { checked: number; settled: number; closed: number; still_unknown: number } };
  return json.data;
}

/** Uma rodada da consulta fiscal (P16) como o cron chamaria. */
export async function runFiscalSync(): Promise<{ checked: number; resolved: number; still_pending: number }> {
  const res = await handlers.fiscal!(new Request("http://edge/functions/v1/fiscal/fiscal.sync", { method: "POST", headers: { [FISCAL_SYNC_HEADER]: FISCAL_SYNC_SECRET } }));
  const json = await res.json() as { data: { checked: number; resolved: number; still_pending: number } };
  return json.data;
}

/** Uma rodada do worker (P06) como o cron chamaria. */
export async function runJobs(): Promise<{ done: number; retried: number; dead: number }> {
  const res = await handlers.jobs!(new Request("http://edge/functions/v1/jobs", { method: "POST", headers: { [JOBS_SECRET_HEADER]: JOBS_SECRET } }));
  const json = await res.json() as { data: { done: number; retried: number; dead: number } };
  return json.data;
}

/** SQL direto, só para preparar cenários e inspecionar o banco (nunca para o caminho testado). */
export const sql = <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []) => pool.query<T>(text, values).then((r) => r.rows);

/** Terça da semana que vem, HH:MM no fuso do negócio A (todos os seeds estão em São Paulo). */
export async function nextWeek(weekday: number, hhmm: string): Promise<string> {
  const [{ ts }] = await sql<{ ts: string }>(
    `select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7 + $1::int) + $2::time) at time zone 'America/Sao_Paulo' as ts`,
    [weekday - 1, hhmm]);
  return iso(new Date(ts));
}
/** Instante no formato que o banco devolve (app.sched_ts): sem milissegundos, em UTC. */
export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
export const plusMin = (v: string, min: number) => iso(new Date(Date.parse(v) + min * 60_000));

export const U = FX.users;
export const T = FX.tenants;
export { FX };

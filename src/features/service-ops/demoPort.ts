// EMULAÇÃO de Plano e serviços para a demonstração sem servidor. Mesmas regras do banco que a tela explica:
// assinatura fixa a versão; pedido nasce com escopo aceito e franquia de minutos; operador só começa e só lê com
// acesso concedido pelo dono (escopo + prazo); cada leitura entra no registro; minutos acima da franquia são
// recusados; aprovar a entrega revoga o acesso. Nada sai do navegador e nada é cobrado.
import {
  type AccessGrant,
  DEFAULT_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  type OfferingVersion,
  RETRYABLE,
  type ServiceOrderDetail,
  type ServiceOrderStatus,
} from "@contracts";
import { FIXED_NOW, FX, services as fixtureServices, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { AccessLog, OpsPort, PlanCurrent, ServiceOpsPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date(FIXED_NOW);
const ts = () => now().toISOString();

/** Operadora da demonstração: na demo, você vê as duas telas. */
export const DEMO_OPERATOR = { user_id: FX.users.outsider, display_name: "Operadora Tinindo (exemplo)" };

const hash = (n: number) => n.toString(16).padStart(64, "0");
const CATALOG: OfferingVersion[] = [
  { id: "90000000-0000-4000-8000-000000000001", code: "free", kind: "plan", version_no: 1, name: "Grátis",
    description: "Perfil e gestão básica para experimentar a Tinindo.", price_cents: 0, billing: "monthly",
    included: ["Agenda, clientes e caixa registrado", "Perfil público", "Exportação básica dos seus dados"],
    excluded: ["Atendimento humano", "Serviços assistidos", "Emissão fiscal"], agent_questions_month: 200, assisted_minutes: null,
    sla_days: null, scope_hash: hash(1), published_at: "2026-10-18T12:00:00Z" },
  { id: "90000000-0000-4000-8000-000000000002", code: "founder", kind: "plan", version_no: 1, name: "Completo (fundador)",
    description: "Preço de fundador por 12 meses para adesões elegíveis.", price_cents: 7900, billing: "monthly",
    included: ["Tudo do Grátis", "Assistente com franquia mensal", "Ofertas de vaga e recuperação de agenda"],
    excluded: ["Atendimento humano ilimitado", "Serviços assistidos (contratados à parte)", "Emissão fiscal", "Marketing pago"],
    agent_questions_month: 200, assisted_minutes: null, sla_days: null, scope_hash: hash(2), published_at: "2026-10-18T12:00:00Z" },
  { id: "90000000-0000-4000-8000-000000000003", code: "implantacao_exemplo", kind: "service", version_no: 1,
    name: "Implantação assistida (exemplo)", description: "Cadastro inicial de serviços, horários e clientes pela equipe Tinindo.",
    price_cents: 50000, billing: "one_time",
    included: ["Cadastro de até 20 serviços", "Horários de atendimento", "Importação de uma planilha de clientes"],
    excluded: ["Site personalizado", "Google Meu Negócio", "Emissão fiscal"], agent_questions_month: null, assisted_minutes: 120,
    sla_days: 7, scope_hash: hash(3), published_at: "2026-10-18T12:00:00Z" },
];

interface WorkLog { minutes: number; kind: "human" | "automation"; reprocess: boolean }
interface State {
  subscription: PlanCurrent["subscription"] & { version: OfferingVersion } | null;
  orders: (ServiceOrderDetail & { logs: WorkLog[] })[];
  log: AccessLog;
  idem: Map<string, unknown>;
  seq: number;
}
let shared: State | null = null;
function state(): State {
  shared ??= { subscription: null, orders: [], log: [], idem: new Map(), seq: 0 };
  return shared;
}
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
const id = (p: string) => `${p}-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;
const once = async <T>(key: string, run: () => T): Promise<T> => {
  const s = state();
  if (s.idem.has(key)) return clone(s.idem.get(key)) as T;
  const v = run();
  s.idem.set(key, clone(v));
  return clone(v);
};

function view(o: State["orders"][number]): ServiceOrderDetail {
  const { logs, ...rest } = o;
  const sum = (f: (l: WorkLog) => boolean) => logs.filter(f).reduce((s, l) => s + l.minutes, 0);
  const grants = rest.grants.map((g) => ({ ...g, active: g.revoked_at === null && Date.parse(g.expires_at) > now().getTime() }));
  return clone({ ...rest, grants, minutes_used: sum(() => true), human_minutes: sum((l) => l.kind === "human"), reprocess_minutes: sum((l) => l.reprocess) });
}
const find = (orderId: string) => state().orders.find((o) => o.id === orderId) ?? fail("NOT_FOUND");
function move(o: State["orders"][number], to: ServiceOrderStatus, note: string) {
  o.events.unshift({ from_status: o.status, to_status: to, note, occurred_at: ts() });
  o.events = o.events.slice(0, 20);
  o.status = to;
  o.blocked_reason = to === "blocked" ? note : null;
  o.version += 1;
}
const activeGrant = (o: State["orders"][number], op: string) =>
  o.grants.find((g) => g.operator_user_id === op && g.revoked_at === null && Date.parse(g.expires_at) > now().getTime());
const revokeAll = (o: State["orders"][number]) => o.grants.forEach((g) => { g.revoked_at ??= ts(); });
const audit = (action: string, actor: string, objectId: string | null, scopes: AccessGrant["scopes"] | null = null) =>
  state().log.unshift({ action, actor_name: actor, object_id: objectId, scopes, occurred_at: ts() });

function plan(): PlanCurrent {
  const s = state().subscription;
  const version = s?.version ?? CATALOG[0]!;
  return clone({
    subscription: s ? { id: s.id, price_cents: s.price_cents, scope_hash: s.scope_hash, started_at: s.started_at, billing_source: "manual" as const } : null,
    plan: version, plan_is_latest: true,
    usage: { agent_questions_used: 0, agent_questions_limit: version.agent_questions_month ?? 0, period_start: "2026-10-01" },
    catalog: CATALOG,
  });
}

export function createDemoPort(): ServiceOpsPort {
  return {
    kind: "demo",
    now,
    async timezone() {
      return tenantA.timezone;
    },
    async plan() {
      return plan();
    },
    subscribe(version, key) {
      return once(key, () => {
        const v = CATALOG.find((c) => c.id === version.id && c.kind === "plan") ?? fail("NOT_FOUND", "offering_version_id");
        if (v.scope_hash !== version.scope_hash) fail("STALE_VERSION");
        if (state().subscription?.version.id === v.id) fail("POLICY_REJECTED", "offering_version_id");
        state().subscription = { id: id("91000000"), price_cents: v.price_cents, scope_hash: v.scope_hash, started_at: ts(), billing_source: "manual", version: v };
        return plan();
      });
    },
    async orders() {
      return state().orders.map(view);
    },
    request(version, notes, key) {
      return once(key, () => {
        const v = CATALOG.find((c) => c.id === version.id && c.kind === "service") ?? fail("NOT_FOUND", "offering_version_id");
        if (v.scope_hash !== version.scope_hash) fail("STALE_VERSION");
        const o: State["orders"][number] = {
          id: id("92000000"), tenant_id: FX.tenants.A, status: "scope_accepted", offering: v, scope_hash: v.scope_hash, price_cents: v.price_cents,
          minutes_quota: v.assisted_minutes ?? 0, assignee_user_id: null, assignee_name: null, due_at: null, notes, blocked_reason: null,
          created_at: ts(), version: 1, minutes_used: 0, human_minutes: 0, reprocess_minutes: 0, deliverables: [], grants: [],
          events: [{ from_status: null, to_status: "scope_accepted", note: "Pedido com escopo aceito", occurred_at: ts() }], logs: [],
        };
        state().orders.unshift(o);
        return view(o);
      });
    },
    cancel(order, key) {
      return once(key, () => {
        const o = find(order.id);
        if (o.version !== order.version) fail("STALE_VERSION");
        if (o.status === "delivered" || o.status === "cancelled") fail("POLICY_REJECTED", "status");
        move(o, "cancelled", "Cancelado pelo cliente");
        revokeAll(o);
        return view(o);
      });
    },
    review(order, deliverableId, decision, note, key) {
      return once(key, () => {
        const o = find(order.id);
        if (o.status !== "client_review" || o.deliverables[0]?.id !== deliverableId) fail("POLICY_REJECTED", "deliverable_id");
        o.deliverables[0]!.review = { decision, note, decided_at: ts() };
        if (decision === "approved") {
          move(o, "delivered", "Entrega aprovada pelo cliente");
          revokeAll(o);
        } else {
          move(o, "in_progress", "Cliente pediu ajustes");
        }
        return view(o);
      });
    },
    grant(order, scopes, expiresAt, justification, key) {
      return once(key, () => {
        const o = find(order.id);
        if (!o.assignee_user_id || o.status === "delivered" || o.status === "cancelled") fail("POLICY_REJECTED", "order_id");
        const t = Date.parse(expiresAt);
        if (!(t > now().getTime()) || t > now().getTime() + 30 * 86_400_000) fail("VALIDATION_ERROR", "expires_at");
        const g: AccessGrant = { id: id("93000000"), order_id: o.id, operator_user_id: o.assignee_user_id, operator_name: o.assignee_name,
          scopes: [...new Set(scopes)].sort(), justification, expires_at: expiresAt, granted_at: ts(), revoked_at: null, active: true };
        o.grants.unshift(g);
        audit("access.grant", "Você", g.id, g.scopes);
        return clone(g);
      });
    },
    revoke(grantId, key) {
      return once(key, () => {
        const g = state().orders.flatMap((o) => o.grants).find((x) => x.id === grantId) ?? fail("NOT_FOUND");
        if (!g.revoked_at) {
          g.revoked_at = ts();
          audit("access.revoke", "Você", g.id);
        }
        return clone({ ...g, active: false });
      });
    },
    async accessLog() {
      return clone(state().log);
    },
  };
}

export function createDemoOpsPort(): OpsPort {
  const me = DEMO_OPERATOR.user_id;
  const mine = (orderId: string) => {
    const o = find(orderId);
    if (o.assignee_user_id !== me) fail("FORBIDDEN");
    return o;
  };
  return {
    kind: "demo",
    async queue() {
      return clone({
        operator: DEMO_OPERATOR, operators: [DEMO_OPERATOR],
        orders: state().orders.map((o) => {
          const g = activeGrant(o, me);
          return { ...view(o), tenant_name: tenantA.name, has_access: !!g, access_scopes: g?.scopes ?? [] };
        }),
      });
    },
    assign(order, assignee, key) {
      return once(key, () => {
        const o = find(order.id);
        if (o.status === "delivered" || o.status === "cancelled") fail("POLICY_REJECTED", "status");
        if (o.assignee_user_id !== assignee) revokeAll(o);
        o.assignee_user_id = assignee;
        o.assignee_name = DEMO_OPERATOR.display_name;
        o.version += 1;
        if ((o.status === "scope_accepted" || o.status === "in_progress") && !activeGrant(o, assignee)) {
          move(o, "awaiting_access", "Responsável definido; aguardando acesso do cliente");
        }
        return view(o);
      });
    },
    start(order, key) {
      return once(key, () => {
        const o = mine(order.id);
        if (!["scope_accepted", "awaiting_access", "blocked"].includes(o.status)) fail("POLICY_REJECTED", "status");
        if (!activeGrant(o, me)) fail("POLICY_REJECTED", "access");
        move(o, "in_progress", "Execução iniciada");
        audit("ops.start", DEMO_OPERATOR.display_name, o.id);
        return view(o);
      });
    },
    logWork(order, minutes, kind, reprocess, note, key) {
      return once(key, () => {
        const o = mine(order.id);
        if (o.status !== "in_progress" && o.status !== "client_review") fail("POLICY_REJECTED", "status");
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) fail("VALIDATION_ERROR", "minutes");
        if (o.logs.reduce((s, l) => s + l.minutes, 0) + minutes > o.minutes_quota) fail("QUOTA_EXCEEDED", "minutes");
        o.logs.push({ minutes, kind, reprocess });
        void note;
        audit("ops.log_work", DEMO_OPERATOR.display_name, o.id);
        return view(o);
      });
    },
    deliver(order, title, evidence, key) {
      return once(key, () => {
        const o = mine(order.id);
        if (o.status !== "in_progress") fail("POLICY_REJECTED", "status");
        o.deliverables.unshift({ id: id("94000000"), version_no: o.deliverables.length + 1, title, evidence, delivered_at: ts(), review: null });
        move(o, "client_review", "Entrega para revisão do cliente");
        audit("ops.deliver", DEMO_OPERATOR.display_name, o.id);
        return view(o);
      });
    },
    block(order, reason, key) {
      return once(key, () => {
        const o = find(order.id);
        if (["delivered", "cancelled", "blocked"].includes(o.status)) fail("POLICY_REJECTED", "status");
        move(o, "blocked", reason);
        audit("ops.block", DEMO_OPERATOR.display_name, o.id);
        return view(o);
      });
    },
    async snapshot(order) {
      const o = find(order.id);
      const g = activeGrant(o, me);
      if (!g || o.status === "delivered" || o.status === "cancelled") fail("FORBIDDEN");
      audit("access.read", DEMO_OPERATOR.display_name, g.id, g.scopes);
      return {
        scopes: g.scopes, expires_at: g.expires_at, tenant_name: tenantA.name,
        catalog: g.scopes.includes("catalog")
          ? fixtureServices.filter((s) => s.tenant_id === FX.tenants.A).map((s) => ({ name: s.name, duration_min: s.duration_min, base_price_cents: s.base_price_cents, active: s.active }))
          : null,
        agenda: g.scopes.includes("agenda") ? [] : null,
        customers: g.scopes.includes("customers") ? { count: 2, names: ["Cliente Exemplo Ana", "Cliente Exemplo Bruno"] } : null,
      };
    },
  };
}

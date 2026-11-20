// Portas de servidor de Plano e serviços contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import type { OfferingVersion, ServiceOrder } from "@contracts";
import { createServerOpsPort, createServerPort } from "../../../src/features/service-ops/serverPort.ts";
import type { QueueOrder } from "../../../src/features/service-ops/port.ts";
import { contractCall, exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const HASH = "c".repeat(64);
const version = { id: ID, scope_hash: HASH } as OfferingVersion;
const order = { id: ID, version: 3 } as ServiceOrder;
const queued = { id: ID, tenant_id: TENANT } as QueueOrder;

/** Forma mínima do `call` falso do arreio, só para repassar a chamada. */
type FakeCall = (path: string, ...rest: unknown[]) => Promise<unknown>;

describe("service-ops · portas do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("service-ops", (call) => createServerPort(call, TENANT), {
      now: (p) => p.now(),
      timezone: (p) => p.timezone(),
      plan: (p) => p.plan(),
      subscribe: (p, key) => p.subscribe(version, key),
      orders: (p) => p.orders(),
      request: (p, key) => p.request(version, null, key),
      cancel: (p, key) => p.cancel(order, key),
      review: (p, key) => p.review(order, OTHER, "changes_requested", "Faltou o serviço de barba", key),
      grant: (p, key) => p.grant(order, ["catalog", "agenda"], "2026-11-01T03:00:00Z", "Cadastrar o catálogo", key),
      revoke: (p, key) => p.revoke(OTHER, key),
      accessLog: (p) => p.accessLog(),
    });

    // Porta do operador. A fila é de todos os negócios (`tenant: false` no handler); as demais chamadas levam no
    // header o negócio do pedido. O arreio aceita um modo só por porta: a fila vai para um `call` sem negócio.
    const queue = contractCall("service-ops", { tenant: "none" });
    const ops = await exercisePort("service-ops", (call) => {
      const pick = (path: string): FakeCall => (path.endsWith("/ops.queue") ? queue.call : call);
      const route: FakeCall = (path, ...rest) => pick(path)(path, ...rest);
      return createServerOpsPort(route as never);
    }, {
      queue: (p) => p.queue(),
      assign: (p, key) => p.assign(queued, OTHER, key),
      start: (p, key) => p.start(queued, key),
      logWork: (p, key) => p.logWork(queued, 45, "human", false, null, key),
      deliver: (p, key) => p.deliver(queued, "Catálogo cadastrado", "12 serviços conferidos com o dono", key),
      block: (p, key) => p.block(queued, "Aguardando acesso", key),
      snapshot: (p) => p.snapshot(queued),
    });
    ops.queue = queue.calls;

    expect(calls.now).toEqual([]);
    // Assinar e pedir citam a versão da oferta e o hash do escopo aceito.
    expect(calls.subscribe![0]!.body).toEqual({ offering_version_id: ID, scope_hash: HASH });
    expect(calls.request![0]!.body).toEqual({ offering_version_id: ID, scope_hash: HASH, notes: null });
    expect(calls.cancel![0]!.body).toEqual({ order_id: ID, expected_version: 3 });
    expect(calls.grant![0]!.body).toEqual({ order_id: ID, scopes: ["catalog", "agenda"], expires_at: "2026-11-01T03:00:00Z", justification: "Cadastrar o catálogo" });
    // Operador: a fila sai sem negócio; o resto usa o negócio do pedido, que não vai no corpo.
    expect(ops.queue).toHaveLength(1);
    expect(ops.assign![0]).toMatchObject({ tenantId: TENANT, body: { order_id: ID, assignee_user_id: OTHER } });
    expect(ops.logWork![0]!.body).toEqual({ order_id: ID, minutes: 45, kind: "human", reprocess: false, note: null });
    // As duas portas juntas alcançam todo o módulo.
    expect(unusedOperations("service-ops", { ...calls, queue: ops.queue, assign: ops.assign!, start: ops.start!, logWork: ops.logWork!, deliver: ops.deliver!, block: ops.block!, snapshot: ops.snapshot! })).toEqual([]);
  });
});

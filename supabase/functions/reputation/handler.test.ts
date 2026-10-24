import { describe, expect, it, vi } from "vitest";
import { FX } from "../_shared/contracts/fixtures.ts";
import { createReputationHandler, type ReputationDeps } from "./handler.ts";

const review = { id: FX.tenants.B, rating: 5, body: "Ótimo", service_name: "Corte", service_month: "2026-10", verified_booking: true, reply: null,
  created_at: "2026-10-24T12:00:00Z", status: "published", version: 1 };
const setup = (over: Partial<ReputationDeps> = {}) => {
  const deps: ReputationDeps = {
    allowedOrigins: [],
    rpc: vi.fn(async () => ({ data: { review }, error: null })),
    anonRpc: vi.fn(async () => ({ data: null, error: null })),
    ...over,
  };
  return { deps, handler: createReputationHandler(deps) };
};
const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://edge/functions/v1/reputation/${op}`, { method: "POST", headers, body: JSON.stringify(body) });
const user = { Authorization: "Bearer jwt-cliente" };
const key = { ...user, "Idempotency-Key": "chave-avaliacao-000001" };

describe("Edge Function reputation", () => {
  it("cliente envia sem negócio selecionado: exige login e chave; nota fora de 1–5 cai antes do banco", async () => {
    const { handler, deps } = setup();
    expect((await handler(post("review.submit", { booking_id: FX.tenants.A, rating: 5 }))).status).toBe(401);
    expect((await handler(post("review.submit", { booking_id: FX.tenants.A, rating: 5 }, user))).status).toBe(400);
    expect((await handler(post("review.submit", { booking_id: FX.tenants.A, rating: 7 }, key))).status).toBe(400);
    const res = await handler(post("review.submit", { booking_id: FX.tenants.A, rating: 5, body: "Ótimo" }, key));
    expect(res.status).toBe(201);
    expect(deps.rpc).toHaveBeenCalledWith("jwt-cliente", "review_submit", { p_booking_id: FX.tenants.A, p_rating: 5, p_body: "Ótimo" });
  });

  it("atendimento de outra pessoa: 404 do banco repassado (não revela nada)", async () => {
    const { handler } = setup({ rpc: vi.fn(async () => ({ data: null, error: { code: "PT404", message: "NOT_FOUND" } })) });
    expect((await handler(post("review.submit", { booking_id: FX.tenants.A, rating: 1 }, key))).status).toBe(404);
  });

  it("resposta que traz o autor é cortada pelo contrato (campo extra removido)", async () => {
    const { handler } = setup({ rpc: vi.fn(async () => ({ data: { review: { ...review, author_user_id: FX.users.customerAB } }, error: null })) });
    const json = await (await handler(post("review.withdraw", { review_id: FX.tenants.B }, key))).json();
    expect(JSON.stringify(json)).not.toContain(FX.users.customerAB);
  });

  it("denúncia só com motivo do catálogo; lista pública sem login", async () => {
    const summary = { identity_verified: false, completed_bookings: 3, reviews_count: 1, rating_average: null, certified_competence: false };
    const { handler, deps } = setup({ anonRpc: vi.fn(async () => ({ data: { rules: { window_days: 30, min_reviews_for_average: 3, body_max: 600 }, summary, reviews: [review] }, error: null })) });
    expect((await handler(post("review.report", { review_id: FX.tenants.B, reason: "nao_gostei" }, key))).status).toBe(400);
    const res = await handler(post("review.public_list", { slug: "Barbearia-A" }));
    expect(res.status).toBe(200);
    expect(deps.anonRpc).toHaveBeenCalledWith("review_public_list", { p_slug: "barbearia-a" });
  });

  it("selo de competência certificada nunca vem verdadeiro (contrato)", async () => {
    const summary = { identity_verified: true, completed_bookings: 3, reviews_count: 1, rating_average: null, certified_competence: true };
    const { handler } = setup({ anonRpc: vi.fn(async () => ({ data: { rules: { window_days: 30, min_reviews_for_average: 3, body_max: 600 }, summary, reviews: [] }, error: null })) });
    expect((await handler(post("review.public_list", { slug: "barbearia-a" }))).status).toBe(500);
  });
});

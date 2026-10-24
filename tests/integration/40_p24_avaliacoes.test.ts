// P24 pelos handlers com o banco real: cliente com vínculo vê o que pode avaliar → avalia (uma por atendimento) →
// dono vê sem autor e responde → denúncia não esconde, moderação decide → lista pública e perfil (P09) refletem.
// SEC: quem não é a cliente não descobre o atendimento; outro dono não lê o painel.
import { afterAll, describe, expect, it } from "vitest";
import { MyReviewOutput, PublicProfile, ReviewOwnerListOutput, ReviewPendingOutput, ReviewPublicListOutput, ReviewReplyOutput, ReviewReportOutput } from "@contracts";
import { fails, ok, pool, rpc, sql, T, U } from "./harness.ts";

const CUST_A = "30000000-0000-4000-8000-0000000000a1";
const BK = "80000000-0000-4000-8000-0000000000f1";
const SLUG = "barbearia-exemplo-a";
afterAll(() => pool.end());

describe("P24 · avaliações pelos handlers", () => {
  let reviewId = "";

  it("1 · cliente vinculado vê o atendimento concluído e avalia uma vez; quem não é a cliente não descobre nada", async () => {
    await sql(`insert into public.customer_links (tenant_id, customer_id, user_id, verification_method, verified_at) select $1, $2, $3, 'owner_invite_code', now()
      where not exists (select 1 from public.customer_links where tenant_id = $1 and user_id = $3 and revoked_at is null)`, [T.A, CUST_A, U.customerAB]);
    await sql(`insert into public.bookings (id, tenant_id, resource_id, customer_id, service_id, starts_at, ends_at, occupied_range, blocks_capacity, status, source)
      values ($1, $2, '20000000-0000-4000-8000-00000000000a', $3, '40000000-0000-4000-8000-0000000000a1', now() - interval '20 days 2 hours', now() - interval '20 days 1 hour 30 minutes',
        tstzrange(now() - interval '20 days 2 hours', now() - interval '20 days 1 hour 20 minutes', '[)'), true, 'completed', 'owner')`, [BK, T.A, CUST_A]);
    const p = await ok(ReviewPendingOutput, "reputation", "review.pending", { as: U.customerAB, body: {} });
    expect(p.pending.map((x) => x.booking_id)).toContain(BK);
    await fails("reputation", "review.submit", { as: U.outsider, key: true, body: { booking_id: BK, rating: 1 } }, "NOT_FOUND");
    await fails("reputation", "review.submit", { as: U.ownerA, key: true, body: { booking_id: BK, rating: 5 } }, "NOT_FOUND");
    const r = await ok(MyReviewOutput, "reputation", "review.submit", { as: U.customerAB, key: true, body: { booking_id: BK, rating: 4, body: "Gostei do atendimento." } });
    reviewId = r.review.id;
    expect(r.review).toMatchObject({ rating: 4, verified_booking: true, status: "published" });
    await fails("reputation", "review.submit", { as: U.customerAB, key: true, body: { booking_id: BK, rating: 1, body: "Mudei" } }, "POLICY_REJECTED", "already_reviewed");
  });

  it("2 · dono vê sem autor e responde; nota intacta", async () => {
    const l = await ok(ReviewOwnerListOutput, "reputation", "review.owner_list", { as: U.ownerA, tenant: T.A, body: {} });
    const mine = l.reviews.find((x) => x.id === reviewId)!;
    expect(JSON.stringify(l)).not.toContain(U.customerAB);
    const r = await ok(ReviewReplyOutput, "reputation", "review.reply", { as: U.ownerA, tenant: T.A, key: true, body: { review_id: reviewId, expected_version: mine.version, body: "Obrigado!" } });
    expect(r.review).toMatchObject({ rating: 4, reply: { body: "Obrigado!" } });
  });

  it("3 · denúncia não esconde; moderação procedente oculta; lista pública e perfil refletem", async () => {
    await sql(`insert into public.public_profiles (tenant_id, slug, category, area, public_fields, published_at) values ($1, $2, 'barber', 'Pinheiros', array['area','display_name'], now())
      on conflict (tenant_id) do update set published_at = now()`, [T.A, SLUG]);
    const slug = (await sql<{ slug: string }>("select slug from public.public_profiles where tenant_id = $1", [T.A]))[0]!.slug;
    const rep = await ok(ReviewReportOutput, "reputation", "review.report", { as: U.ownerA, key: true, body: { review_id: reviewId, reason: "offensive" } });
    let pub = await ok(ReviewPublicListOutput, "reputation", "review.public_list", { as: null, body: { slug } });
    expect(pub.reviews.map((x) => x.id)).toContain(reviewId);
    const profile = await ok(PublicProfile, "network", "public.profile", { as: null, method: "GET", query: { slug } });
    expect(profile.reputation.reviews_count).toBeGreaterThanOrEqual(1);
    expect((await rpc("worker", "review_moderate", { p_report_id: rep.report.id, p_decision: "upheld", p_note: "Linguagem ofensiva" })).error).toBeNull();
    pub = await ok(ReviewPublicListOutput, "reputation", "review.public_list", { as: null, body: { slug } });
    expect(pub.reviews.map((x) => x.id)).not.toContain(reviewId);
    expect(pub.summary.certified_competence).toBe(false);
    expect(JSON.stringify(pub)).not.toContain(U.customerAB);
  });

  it("SEC · outro dono não lê o painel; sem login não há pendentes", async () => {
    await fails("reputation", "review.owner_list", { as: U.ownerB, tenant: T.A, body: {} }, "FORBIDDEN");
    await fails("reputation", "review.pending", { as: null, body: {} }, "AUTH_REQUIRED");
  });
});

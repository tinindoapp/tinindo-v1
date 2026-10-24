// Avaliações e verificação (P24). Aditivos ao v1; ver ADR-0028.
// Experiência só de atendimento concluído e vinculado (login de cliente ↔ cadastro do negócio), uma por atendimento, em
// até 30 dias; resposta do profissional; denúncia com moderação pelo backend. Selos separados: identidade verificada
// (equipe), atendimentos verificados (contagem), competência certificada (P39, sempre falso aqui). O autor nunca aparece.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

export const ReputationRules = z.object({ window_days: z.int(), min_reviews_for_average: z.int(), body_max: z.int() });
export const PublicReview = z.object({
  id: Uuid,
  rating: z.int().min(1).max(5),
  body: z.string().nullable(),
  service_name: z.string(),
  service_month: z.string().regex(/^\d{4}-\d{2}$/),
  verified_booking: z.literal(true),
  reply: z.object({ body: z.string(), at: IsoDateTime }).nullable(),
  created_at: IsoDateTime,
});
export type PublicReview = z.infer<typeof PublicReview>;
export const ReputationSummary = z.object({
  identity_verified: z.boolean(),
  completed_bookings: z.int().min(0),
  reviews_count: z.int().min(0),
  /** Só com 3 ou mais avaliações publicadas; null = poucas para média. */
  rating_average: z.number().min(1).max(5).nullable(),
  certified_competence: z.literal(false),
});
export type ReputationSummary = z.infer<typeof ReputationSummary>;
const ReviewStatus = z.enum(["published", "withdrawn", "hidden"]);
export const MyReview = PublicReview.extend({ status: ReviewStatus, version: z.int().min(1) });
export const OwnerReview = MyReview.extend({ hidden_reason: z.string().nullable(), open_reports: z.int().min(0) });

export const ReviewPendingInput = z.object({});
export const ReviewPendingOutput = z.object({
  rules: ReputationRules,
  pending: z.array(z.object({ booking_id: Uuid, tenant_name: z.string(), service_name: z.string(), ended_at: IsoDateTime, review_until: IsoDateTime })),
  mine: z.array(MyReview.extend({ tenant_name: z.string() })),
});
export type ReviewPending = z.infer<typeof ReviewPendingOutput>;
export const ReviewSubmitInput = z.object({ booking_id: Uuid, rating: z.int().min(1).max(5), body: z.string().trim().min(3).max(600).nullable().default(null) });
export const ReviewWithdrawInput = z.object({ review_id: Uuid });
export const MyReviewOutput = z.object({ review: MyReview });
export const ReviewReportInput = z.object({
  review_id: Uuid,
  reason: z.enum(["offensive", "personal_data", "not_a_customer", "conflict_of_interest", "other"]),
  note: z.string().trim().max(300).nullable().default(null),
});
export const ReviewReportOutput = z.object({ report: z.object({ id: Uuid, status: z.enum(["open", "upheld", "dismissed"]), reason: z.string(), created_at: IsoDateTime }) });
export const ReviewOwnerListInput = z.object({});
export const ReviewOwnerListOutput = z.object({ rules: ReputationRules, summary: ReputationSummary, reviews: z.array(OwnerReview).max(100) });
export type ReviewOwnerList = z.infer<typeof ReviewOwnerListOutput>;
export const ReviewReplyInput = z.object({ review_id: Uuid, expected_version: z.int().min(1), body: z.string().trim().min(2).max(600) });
export const ReviewReplyOutput = z.object({ review: OwnerReview });
export const ReviewPublicListInput = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/) });
export const ReviewPublicListOutput = z.object({ rules: ReputationRules, summary: ReputationSummary, reviews: z.array(PublicReview).max(50) });
export type ReviewPublicList = z.infer<typeof ReviewPublicListOutput>;

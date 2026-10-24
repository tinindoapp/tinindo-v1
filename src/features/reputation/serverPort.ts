// Portas reais de Avaliações: Edge Function `reputation`.
import { MyReviewOutput, ReviewOwnerListOutput, ReviewPendingOutput, ReviewPublicListOutput, ReviewReplyOutput, ReviewReportOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { CustomerReviewsPort, OwnerReviewsPort, PublicReviewsPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/reputation/${name}`;

export function createServerOwnerPort(call: Call, tenantId: string): OwnerReviewsPort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  return {
    kind: "server",
    async list() {
      return (await call(op("review.owner_list"), ReviewOwnerListOutput, post({}))).data;
    },
    async reply(review_id, expected_version, body, key) {
      await call(op("review.reply"), ReviewReplyOutput, post({ review_id, expected_version, body }, key));
    },
    async report(review_id, reason, key) {
      await call(op("review.report"), ReviewReportOutput, { method: "POST", body: { review_id, reason }, idempotencyKey: key });
    },
  };
}

export function createServerCustomerPort(call: Call): CustomerReviewsPort {
  return {
    kind: "server",
    async pending() {
      return (await call(op("review.pending"), ReviewPendingOutput, { method: "POST", body: {} })).data;
    },
    async submit(booking_id, rating, body, key) {
      await call(op("review.submit"), MyReviewOutput, { method: "POST", body: { booking_id, rating, body }, idempotencyKey: key });
    },
    async withdraw(review_id, key) {
      await call(op("review.withdraw"), MyReviewOutput, { method: "POST", body: { review_id }, idempotencyKey: key });
    },
  };
}

export function createServerPublicPort(call: Call): PublicReviewsPort {
  return {
    kind: "server",
    async list(slug) {
      return (await call(op("review.public_list"), ReviewPublicListOutput, { method: "POST", body: { slug } })).data;
    },
  };
}

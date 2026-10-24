// Portas do módulo Avaliações (P24). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `reputation`.
import type { ReviewOwnerList, ReviewPending, ReviewPublicList, ReviewReportInput } from "@contracts";
import type { z } from "zod";

export type ReportReason = z.input<typeof ReviewReportInput>["reason"];
export type { ReviewOwnerList, ReviewPending, ReviewPublicList };

/** Dono: avaliações recebidas e resposta. */
export interface OwnerReviewsPort {
  readonly kind: "demo" | "server";
  list(): Promise<ReviewOwnerList>;
  reply(reviewId: string, expectedVersion: number, body: string, key: string): Promise<void>;
  report(reviewId: string, reason: ReportReason, key: string): Promise<void>;
}

/** Cliente com login (sem negócio selecionado). */
export interface CustomerReviewsPort {
  readonly kind: "demo" | "server";
  pending(): Promise<ReviewPending>;
  submit(bookingId: string, rating: number, body: string | null, key: string): Promise<void>;
  withdraw(reviewId: string, key: string): Promise<void>;
}

/** Público (sem login). */
export interface PublicReviewsPort {
  readonly kind: "demo" | "server";
  list(slug: string): Promise<ReviewPublicList>;
}

export const newKey = () => crypto.randomUUID();

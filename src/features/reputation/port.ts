// Portas do módulo Avaliações (P24). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `reputation`.
import type { IdentityRequest, IdentityRequestInput, ReviewOwnerList, ReviewPending, ReviewPublicList, ReviewReportInput } from "@contracts";
import type { z } from "zod";

export type ReportReason = z.input<typeof ReviewReportInput>["reason"];
export type IdentityMethod = z.input<typeof IdentityRequestInput>["preferred_method"];
export type { IdentityRequest };
export type { ReviewOwnerList, ReviewPending, ReviewPublicList };

/** Dono: avaliações recebidas e resposta. */
export interface OwnerReviewsPort {
  readonly kind: "demo" | "server";
  list(): Promise<ReviewOwnerList>;
  reply(reviewId: string, expectedVersion: number, body: string, key: string): Promise<void>;
  report(reviewId: string, reason: ReportReason, key: string): Promise<void>;
  /** Recado #89: pede à equipe a verificação de identidade. Pedir de novo devolve o mesmo pedido aberto. */
  requestIdentity(method: IdentityMethod, key: string): Promise<IdentityRequest>;
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

// Identidade e onboarding (P01): onboarding mínimo e vínculo cliente ↔ login por código.
// Promovido do módulo identity pelo integrador (aditivo; ADR-0007). business.create está em catalog.ts.
import { z } from "zod";
import { Cents, IsoDateTime, Uuid, Version } from "./common.ts";
import { BookingStatus } from "./scheduling.ts";

/** Objetivo principal declarado no onboarding (docs/15: diagnóstico mínimo, sem score). */
export const OnboardingGoal = z.enum([
  "fill_schedule",
  "organize_clients",
  "track_payments",
  "reduce_no_shows",
  "save_admin_time",
]);
export type OnboardingGoal = z.infer<typeof OnboardingGoal>;

export const CancellationNoticeHours = z.int().min(0).max(168);
/** Multa por cancelamento tardio, em basis points do preço combinado. Cobrança é manual (P07). */
export const LateCancellationFeeBps = z.int().min(1).max(10_000);

export const Onboarding = z.object({
  tenant_id: Uuid,
  goal: OnboardingGoal.nullable(),
  cancellation_notice_hours: CancellationNoticeHours.nullable(),
  late_cancellation_fee_bps: LateCancellationFeeBps.nullable(),
  completed_at: IsoDateTime.nullable(),
  version: Version,
});
export type Onboarding = z.infer<typeof Onboarding>;

export const OnboardingSaveInput = z
  .object({
    expected_version: Version,
    goal: OnboardingGoal.nullable().default(null),
    cancellation_notice_hours: CancellationNoticeHours.nullable().default(null),
    late_cancellation_fee_bps: LateCancellationFeeBps.nullable().default(null),
    mark_complete: z.boolean().default(false),
  })
  .refine((v) => !v.mark_complete || (v.goal !== null && v.cancellation_notice_hours !== null), {
    message: "para concluir, informe objetivo e antecedência de cancelamento",
    path: ["mark_complete"],
  });
export type OnboardingSaveInput = z.infer<typeof OnboardingSaveInput>;
export const OnboardingSaveOutput = z.object({ onboarding: Onboarding });

/** Código de vínculo: 256 bits em base64url, sem padding. */
export const LinkCode = z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/, "código de vínculo inválido");

export const CustomerLinkIssueInput = z.object({ customer_id: Uuid });
export const CustomerLinkIssueOutput = z.object({
  invite_id: Uuid,
  customer_id: Uuid,
  expires_at: IsoDateTime,
  /** Só vem na primeira resposta. Na repetição é null: o banco guarda apenas o hash. */
  code: LinkCode.nullable(),
});
export type CustomerLinkIssueOutput = z.infer<typeof CustomerLinkIssueOutput>;

export const CustomerLinkRedeemInput = z.object({ code: LinkCode });
export const CustomerLinkRedeemOutput = z.object({
  link_id: Uuid,
  tenant_id: Uuid,
  tenant_name: z.string().min(1).max(120),
  verified_at: IsoDateTime,
});
export type CustomerLinkRedeemOutput = z.infer<typeof CustomerLinkRedeemOutput>;

export const CustomerLinkRevokeInput = z.object({ link_id: Uuid, expected_version: Version });
export const CustomerLinkRevokeOutput = z.object({
  link_id: Uuid,
  revoked_at: IsoDateTime,
  version: Version,
});

/** Linha de public.my_customer_links(): vínculos ativos do login, sem dados do CRM. */
export const MyCustomerLink = z.object({
  link_id: Uuid,
  tenant_id: Uuid,
  tenant_name: z.string().min(1).max(120),
  verified_at: IsoDateTime,
  version: Version,
});
export type MyCustomerLink = z.infer<typeof MyCustomerLink>;

/**
 * Linha de public.my_bookings(): reserva do próprio login num negócio com vínculo ativo. Só leitura, sem CRM
 * (nada de notas, motivo, origem ou outros clientes). Reserva provisória vencida não aparece.
 */
export const MyBooking = z.object({
  booking_id: Uuid,
  tenant_id: Uuid,
  tenant_name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64),
  service_name: z.string().min(1).max(120),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  status: BookingStatus.exclude(["expired"]),
  agreed_price_cents: Cents.nullable(),
});
export type MyBooking = z.infer<typeof MyBooking>;

// Orçamentos e aceite (P11). Aditivos ao v1; ver ADR-0013.
// Cada versão é um snapshot imutável com hash; o aceite cita versão + hash e vale dentro da validade.
// Aceito ≠ pago: a cobrança segue pelo caixa (P07). Propor horário não reserva; o aceite revalida pela agenda.
import { z } from "zod";
import { Cents, IsoDateTime, Uuid, Version } from "./common.ts";
import { Booking } from "./scheduling.ts";

export const SalesQuoteStatus = z.enum(["draft", "sent", "accepted", "declined", "expired", "cancelled"]);
export type SalesQuoteStatus = z.infer<typeof SalesQuoteStatus>;

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
/** Token opaco do link (256 bits, base64url). O banco guarda só o hash. */
export const SalesQuoteToken = z.string().min(32).max(256);

/** Item enviado pelo dono. O total da linha e do orçamento é calculado no servidor. */
export const SalesQuoteItemInput = z.object({
  service_id: Uuid.nullable().optional(),
  description: z.string().trim().min(1).max(120),
  quantity: z.int().min(1).max(99),
  unit_price_cents: Cents,
});
export const SalesQuoteItem = z.object({
  service_id: Uuid.nullable(),
  description: z.string(),
  quantity: z.int().min(1),
  unit_price_cents: Cents,
  line_total_cents: Cents,
});

/** Horário proposto: o fim é início + duração do serviço (servidor). */
export const SalesQuoteSlotInput = z.object({ service_id: Uuid, starts_at: IsoDateTime });
export const SalesQuoteSlot = z.object({ service_id: Uuid, starts_at: IsoDateTime, ends_at: IsoDateTime });

export const SalesQuoteVersion = z.object({
  version_no: z.int().min(1),
  title: z.string(),
  items: z.array(SalesQuoteItem).min(1).max(20),
  total_cents: Cents,
  currency: z.literal("BRL"),
  valid_until: IsoDateTime,
  slot: SalesQuoteSlot.nullable(),
  notes: z.string().nullable(),
  snapshot_hash: Sha256Hex,
  created_at: IsoDateTime,
});
export type SalesQuoteVersion = z.infer<typeof SalesQuoteVersion>;

export const SalesQuote = z.object({
  id: Uuid,
  customer_id: Uuid,
  status: SalesQuoteStatus,
  current_version: z.int().min(1),
  /** Há link válido agora (enviado, não vencido). */
  link_active: z.boolean(),
  sent_at: IsoDateTime.nullable(),
  decided_at: IsoDateTime.nullable(),
  decided_version: z.int().min(1).nullable(),
  booking_id: Uuid.nullable(),
  version: z.int().min(1),
  created_at: IsoDateTime,
  current: SalesQuoteVersion,
});
export type SalesQuote = z.infer<typeof SalesQuote>;

const QuoteContent = {
  title: z.string().trim().min(1).max(120),
  items: z.array(SalesQuoteItemInput).min(1).max(20),
  valid_until: IsoDateTime,
  slot: SalesQuoteSlotInput.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
};

export const SalesQuoteCreateInput = z.object({ customer_id: Uuid, ...QuoteContent });
/** expected_version = número da versão atual que o dono está revisando. */
export const SalesQuoteReviseInput = z.object({ quote_id: Uuid, expected_version: Version, ...QuoteContent });
export const SalesQuoteSendInput = z.object({ quote_id: Uuid, expected_version: Version });
export const SalesQuoteRefInput = z.object({ quote_id: Uuid });
export const SalesQuoteListInput = z.object({ status: SalesQuoteStatus.optional() });

export const SalesQuoteOutput = z.object({ quote: SalesQuote });
export const SalesQuoteSendOutput = z.object({
  quote: SalesQuote,
  /** Token do link: só na resposta que o gera; repetição devolve null. Gerar de novo invalida o anterior. */
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable(),
});
export const SalesQuoteListOutput = z.object({ quotes: z.array(SalesQuote).max(200) });
export const SalesQuoteDecision = z.object({
  decision: z.enum(["accepted", "declined"]),
  version_no: z.int().min(1),
  snapshot_hash: Sha256Hex,
  booking_id: Uuid.nullable(),
  decided_at: IsoDateTime,
});
export const SalesQuoteDetailOutput = z.object({
  quote: SalesQuote,
  versions: z.array(SalesQuoteVersion).min(1),
  decision: SalesQuoteDecision.nullable(),
});

// ---------------------------------------------------------------------------
// Link do cliente (anônimo). Token no corpo de um POST, nunca na query.
// ---------------------------------------------------------------------------

export const SalesQuoteTokenInput = z.object({ token: SalesQuoteToken });
/** Aceite/recusa citam a versão e o hash que o cliente viu. */
export const SalesQuoteDecideInput = z.object({ token: SalesQuoteToken, version_no: z.int().min(1), snapshot_hash: Sha256Hex });

/** O que o link mostra: sem tenant, sem cadastro do cliente, sem outros orçamentos. */
export const SalesQuotePublicView = SalesQuoteVersion.extend({
  business_name: z.string(),
  timezone: z.string(),
  status: SalesQuoteStatus,
  slot_service_name: z.string().nullable(),
});
export const SalesQuoteDecideOutput = z.object({
  status: z.enum(["accepted", "declined"]),
  version_no: z.int().min(1),
  decided_at: IsoDateTime,
  /** Reserva confirmada pelo aceite (null se o orçamento não tem horário, ou na recusa). */
  booking: Booking.nullable(),
});

// Tipos primitivos compartilhados por todos os módulos (contratos v1).
// TypeScript puro + zod: roda no Vite/Node e no Deno das Edge Functions.
// Mudança incompatível exige ADR e aprovação do integrador (docs/03_CONTRATOS.md).
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

/** Instante ISO 8601 com offset explícito (Z ou ±hh:mm). Nunca horário "flutuante". */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Data civil local (YYYY-MM-DD), usada com timezone IANA explícito. */
export const LocalDate = z.iso.date();

/** Horário civil local HH:MM (regras recorrentes de disponibilidade). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

/** Janela semanal em horário local (0 = domingo). Usada por regras de preço e lista de espera. */
export const WeeklyWindow = z
  .object({ weekday: z.int().min(0).max(6), local_start: LocalTime, local_end: LocalTime })
  .refine((w) => w.local_end > w.local_start, {
    message: "local_end deve ser posterior a local_start",
    path: ["local_end"],
  });
export type WeeklyWindow = z.infer<typeof WeeklyWindow>;

/** Timezone IANA. No piloto todos os negócios estão no Brasil. */
export const TimeZone = z
  .string()
  .regex(/^[A-Za-z]+(?:[/_+-][A-Za-z0-9_+-]+)+$/, "timezone IANA, ex.: America/Sao_Paulo");

/** Moeda ISO 4217. Piloto aceita apenas BRL. */
export const Currency = z.literal("BRL");
export type Currency = z.infer<typeof Currency>;

/** Valor em centavos inteiros, não negativo, dentro do inteiro seguro. Nunca float. */
export const Cents = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
export type Cents = z.infer<typeof Cents>;

/** Variação em centavos (estorno/ajuste); sinal explícito. */
export const SignedCents = z.int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

/** Percentual em basis points: 10000 = 100%. */
export const BasisPoints = z.int().min(0).max(10_000);
export type BasisPoints = z.infer<typeof BasisPoints>;

export const Money = z.object({
  amount_cents: Cents,
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

/**
 * Intervalo semiaberto [starts_at, ends_at). Fim estritamente após início.
 * Comparação feita pelo instante, não pela string.
 */
export const TimeRange = z
  .object({ starts_at: IsoDateTime, ends_at: IsoDateTime })
  .refine((r) => Date.parse(r.ends_at) > Date.parse(r.starts_at), {
    message: "ends_at deve ser posterior a starts_at",
    path: ["ends_at"],
  });
export type TimeRange = z.infer<typeof TimeRange>;

/** Versão otimista de um registro editável (expected_version nos comandos). */
export const Version = z.int().min(1);

/**
 * Chave de idempotência gerada pelo cliente, enviada SEMPRE no header `Idempotency-Key`
 * (nunca no corpo: o corpo entra no hash da requisição e da aprovação). Escopo no servidor:
 * (tenant, actor, operation, key). Mesmo payload → mesma resposta; payload diferente → 409.
 */
export const IdempotencyKey = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "use UUID ou base64url");
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Paginação por cursor; listas ilimitadas são proibidas. */
export const PAGE_LIMIT_MAX = 100;
export const PAGE_LIMIT_DEFAULT = 50;
export const PageRequest = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});
export const PageInfo = z.object({
  next_cursor: z.string().nullable(),
});

/** Telefone normalizado E.164. Não é chave de autorização nem de merge entre negócios. */
export const PhoneE164 = z.string().regex(/^\+[1-9]\d{7,14}$/, "telefone E.164");

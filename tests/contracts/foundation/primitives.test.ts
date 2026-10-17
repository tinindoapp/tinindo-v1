// Contratos v1: primitivos, envelope e catálogo de erros.
import { describe, expect, it } from "vitest";
import {
  BOOKING_TRANSITIONS,
  BookingStatus,
  ERROR_STATUS,
  ErrorEnvelope,
  errorBody,
  IdempotencyKey,
  Money,
  ProviderService,
  Quote,
  successEnvelope,
  TimeRange,
  WeeklyWindow,
} from "@contracts";
import { services } from "@contracts/fixtures.ts";

const RID = "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10";

describe("Money", () => {
  it("aceita centavos inteiros em BRL", () => {
    expect(Money.parse({ amount_cents: 8500, currency: "BRL" })).toEqual({ amount_cents: 8500, currency: "BRL" });
  });
  it.each([
    [85.5, "fração (float)"],
    [-1, "negativo"],
    [Number.MAX_SAFE_INTEGER + 1, "acima do inteiro seguro"],
  ])("rejeita %s (%s)", (amount) => {
    expect(Money.safeParse({ amount_cents: amount, currency: "BRL" }).success).toBe(false);
  });
  it("rejeita outra moeda no piloto", () => {
    expect(Money.safeParse({ amount_cents: 100, currency: "USD" }).success).toBe(false);
  });
});

describe("TimeRange", () => {
  it("é semiaberto e exige fim depois do início, comparando instantes", () => {
    // 10:00-03:00 == 13:00Z; fim 12:30Z é ANTES do início, apesar da string "maior".
    expect(TimeRange.safeParse({ starts_at: "2026-10-20T10:00:00-03:00", ends_at: "2026-10-20T12:30:00Z" }).success).toBe(false);
    expect(TimeRange.safeParse({ starts_at: "2026-10-20T10:00:00-03:00", ends_at: "2026-10-20T13:30:00Z" }).success).toBe(true);
  });
  it("rejeita intervalo vazio", () => {
    const t = "2026-10-20T10:00:00-03:00";
    expect(TimeRange.safeParse({ starts_at: t, ends_at: t }).success).toBe(false);
  });
  it("rejeita horário sem offset", () => {
    expect(TimeRange.safeParse({ starts_at: "2026-10-20T10:00:00", ends_at: "2026-10-20T11:00:00" }).success).toBe(false);
  });
});

describe("WeeklyWindow e IdempotencyKey", () => {
  it("janela local precisa terminar depois de começar", () => {
    expect(WeeklyWindow.safeParse({ weekday: 2, local_start: "14:00", local_end: "18:00" }).success).toBe(true);
    expect(WeeklyWindow.safeParse({ weekday: 2, local_start: "18:00", local_end: "14:00" }).success).toBe(false);
    expect(WeeklyWindow.safeParse({ weekday: 7, local_start: "08:00", local_end: "09:00" }).success).toBe(false);
  });
  it("chave aceita UUID e rejeita valores curtos ou com espaço", () => {
    expect(IdempotencyKey.safeParse(RID).success).toBe(true);
    expect(IdempotencyKey.safeParse("curta").success).toBe(false);
    expect(IdempotencyKey.safeParse("tem espaço no meio 123").success).toBe(false);
  });
});

describe("catálogo", () => {
  it("piso maior que o preço base é inválido", () => {
    const s = { ...services[0]!, min_price_cents: 99_999 };
    expect(ProviderService.safeParse(s).success).toBe(false);
  });
});

describe("estados de reserva", () => {
  it("toda transição aponta para estado existente e terminais não saem", () => {
    for (const [from, tos] of Object.entries(BOOKING_TRANSITIONS)) {
      expect(BookingStatus.options).toContain(from);
      for (const to of tos) expect(BookingStatus.options).toContain(to);
    }
    expect(BOOKING_TRANSITIONS.completed).toEqual([]);
    expect(BOOKING_TRANSITIONS.cancelled).toEqual([]);
    expect(BOOKING_TRANSITIONS.expired).toEqual([]);
    expect(BOOKING_TRANSITIONS.held).not.toContain("completed");
  });
});

describe("envelope e erros", () => {
  it("exemplo de cotação do doc03 valida no envelope de sucesso", () => {
    const example = {
      data: {
        quote_id: "0f8f2d36-5b9b-4b7e-8d0b-6a3c2f6e9a11",
        service_id: services[0]!.id,
        resource_id: "20000000-0000-4000-8000-00000000000a",
        slot: { starts_at: "2026-10-20T14:00:00-03:00", ends_at: "2026-10-20T14:30:00-03:00" },
        currency: "BRL",
        base_price_cents: 10000,
        final_price_cents: 8500,
        rule_version: 3,
        reason_code: "OFF_PEAK_APPROVED",
        expires_at: "2026-10-20T13:10:00-03:00",
      },
      meta: { request_id: RID, as_of: "2026-10-20T13:00:00-03:00", schema_version: 1 },
    };
    expect(successEnvelope(Quote).safeParse(example).success).toBe(true);
    expect(successEnvelope(Quote).safeParse({ ...example, meta: { ...example.meta, schema_version: 2 } }).success).toBe(false);
  });

  it("catálogo de erros mantém os status do doc03", () => {
    expect(ERROR_STATUS).toMatchObject({
      VALIDATION_ERROR: 400,
      AUTH_REQUIRED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      SLOT_CONFLICT: 409,
      STALE_VERSION: 409,
      IDEMPOTENCY_MISMATCH: 409,
      POLICY_REJECTED: 422,
      QUOTA_EXCEEDED: 429,
      PROVIDER_UNAVAILABLE: 503,
    });
  });

  it("errorBody produz envelope válido e marca retryable só nos transitórios", () => {
    const conflict = errorBody("SLOT_CONFLICT", "Horário ocupado.", RID);
    expect(ErrorEnvelope.parse(conflict).error.retryable).toBe(false);
    expect(errorBody("PROVIDER_UNAVAILABLE", "x", RID).error.retryable).toBe(true);
    expect(ErrorEnvelope.safeParse({ error: { code: "TEAPOT", message: "x", retryable: false }, request_id: RID }).success).toBe(false);
  });
});

// Fixtures sintéticas comuns (docs/03 "Fixtures comuns"). Todos os módulos reutilizam
// estes IDs e o relógio determinístico. Dados 100% fictícios. Nenhum dado real.
// supabase/seed.sql espelha os registros que já existem no banco (teste em tests/contracts).
import type { Booking, ProviderService, Tenant } from "./index.ts";

/** Relógio fixo dos testes: terça, 20/10/2026 09:00 em São Paulo. */
export const FIXED_NOW = "2026-10-20T12:00:00Z";
export const FIXED_NOW_LOCAL = "2026-10-20T09:00:00-03:00";

export const FX = {
  users: {
    ownerA: "a0000000-0000-4000-8000-00000000000a",
    ownerB: "b0000000-0000-4000-8000-00000000000b",
    /** Cliente com login que usa os dois negócios. */
    customerAB: "c0000000-0000-4000-8000-0000000000ab",
    /** Usuário autenticado sem vínculo nenhum (testes de negação). */
    outsider: "d0000000-0000-4000-8000-0000000000dd",
  },
  tenants: {
    A: "10000000-0000-4000-8000-00000000000a",
    B: "10000000-0000-4000-8000-00000000000b",
  },
  resources: {
    A: "20000000-0000-4000-8000-00000000000a",
    B: "20000000-0000-4000-8000-00000000000b",
  },
  customers: {
    /** Cadastro privado em A, vinculável ao login customerAB (P01). */
    abInA: "30000000-0000-4000-8000-0000000000a1",
    /** Cadastro privado em B da mesma pessoa; NÃO é o mesmo registro. */
    abInB: "30000000-0000-4000-8000-0000000000b1",
    /** Cliente sem login em A. */
    guestInA: "30000000-0000-4000-8000-0000000000a2",
  },
  services: {
    corteA: "40000000-0000-4000-8000-0000000000a1",
    barbaA: "40000000-0000-4000-8000-0000000000a2",
    sessaoB: "40000000-0000-4000-8000-0000000000b1",
  },
  packages: {
    dezSessoesB: "50000000-0000-4000-8000-0000000000b1",
  },
} as const;

export const tenantA: Tenant = {
  id: FX.tenants.A,
  name: "Barbearia Exemplo A",
  profession: "barber",
  timezone: "America/Sao_Paulo",
  currency: "BRL",
  status: "active",
  version: 1,
};

export const tenantB: Tenant = {
  id: FX.tenants.B,
  name: "Personal Exemplo B",
  profession: "personal_trainer",
  timezone: "America/Sao_Paulo",
  currency: "BRL",
  status: "active",
  version: 1,
};

export const services: ProviderService[] = [
  {
    id: FX.services.corteA, tenant_id: FX.tenants.A, name: "Corte", duration_min: 30,
    buffer_before_min: 0, buffer_after_min: 10, base_price_cents: 6000, min_price_cents: 4500,
    estimated_cost_cents: 1500, fee_bps: 500, active: true, version: 1,
  },
  {
    id: FX.services.barbaA, tenant_id: FX.tenants.A, name: "Barba", duration_min: 20,
    buffer_before_min: 0, buffer_after_min: 5, base_price_cents: 4000, min_price_cents: 3000,
    estimated_cost_cents: null, fee_bps: null, active: true, version: 1,
  },
  {
    id: FX.services.sessaoB, tenant_id: FX.tenants.B, name: "Sessão de treino", duration_min: 60,
    buffer_before_min: 15, buffer_after_min: 15, base_price_cents: 12000, min_price_cents: 10000,
    estimated_cost_cents: 2000, fee_bps: 500, active: true, version: 1,
  },
];

const booking = (
  n: number,
  tenant: "A" | "B",
  serviceId: string,
  customerId: string | null,
  starts: string,
  ends: string,
  status: Booking["status"],
  price: number | null,
): Booking => ({
  id: `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant_id: FX.tenants[tenant],
  resource_id: FX.resources[tenant],
  customer_id: customerId,
  service_id: serviceId,
  starts_at: starts,
  ends_at: ends,
  status,
  // Hold vence 10 min após FIXED_NOW; demais estados não têm prazo.
  hold_expires_at: status === "held" ? "2026-10-20T09:10:00-03:00" : null,
  price_quote_id: null,
  agreed_price_cents: price,
  source: "owner",
  version: 1,
});

/** Terça 20/10 em A: manhã lotada (09:00–12:00), tarde parcial. */
export const bookingsA: Booking[] = [
  booking(1, "A", FX.services.corteA, FX.customers.abInA, "2026-10-20T09:00:00-03:00", "2026-10-20T09:30:00-03:00", "confirmed", 6000),
  booking(2, "A", FX.services.corteA, FX.customers.guestInA, "2026-10-20T09:40:00-03:00", "2026-10-20T10:10:00-03:00", "confirmed", 6000),
  booking(3, "A", FX.services.barbaA, FX.customers.guestInA, "2026-10-20T10:20:00-03:00", "2026-10-20T10:40:00-03:00", "confirmed", 4000),
  booking(4, "A", FX.services.corteA, null, "2026-10-20T10:45:00-03:00", "2026-10-20T11:15:00-03:00", "held", null),
  booking(5, "A", FX.services.corteA, FX.customers.abInA, "2026-10-20T11:25:00-03:00", "2026-10-20T11:55:00-03:00", "confirmed", 6000),
  booking(6, "A", FX.services.corteA, FX.customers.guestInA, "2026-10-20T15:00:00-03:00", "2026-10-20T15:30:00-03:00", "confirmed", 5100),
];

/** Pacote pré-pago em B: 10 sessões por R$1.000, 2 já consumidas. */
export const packageB = {
  package_id: FX.packages.dezSessoesB,
  tenant_id: FX.tenants.B,
  customer_id: FX.customers.abInB,
  service_id: FX.services.sessaoB,
  purchased_credits: 10,
  remaining_credits: 8,
  total_price_cents: 100_000,
  expires_at: "2027-01-31T23:59:59-03:00",
} as const;

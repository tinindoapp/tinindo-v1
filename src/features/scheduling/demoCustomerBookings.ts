// Demonstração: as reservas de um cliente como ele as vê ("Minhas reservas" e quais atendimentos pode avaliar), lidas da
// agenda emulada da aba. Mesma projeção de public.my_bookings: sem CRM, sem reserva provisória vencida.
import { tenantA } from "@contracts/fixtures.ts";
import type { DemoCustomerBooking } from "../../lib/demo/journey.ts";
import type { SchedulingPort } from "./port.ts";

export async function customerBookingsFrom(port: SchedulingPort, customerId: string): Promise<DemoCustomerBooking[]> {
  const [ctx, services, bookings] = await Promise.all([
    port.context(),
    port.listServices(),
    port.listBookings({ starts_at: "2026-09-01T00:00:00-03:00", ends_at: "2027-01-01T00:00:00-03:00" }),
  ]);
  return bookings
    .filter((b) => b.customer_id === customerId && b.status !== "expired")
    .map((b) => ({
      booking_id: b.id, tenant_id: b.tenant_id, tenant_name: tenantA.name, timezone: ctx.timezone,
      service_name: services.find((s) => s.id === b.service_id)?.name ?? "Atendimento",
      starts_at: b.starts_at, ends_at: b.ends_at, status: b.status as DemoCustomerBooking["status"],
      agreed_price_cents: b.agreed_price_cents,
    }))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
}

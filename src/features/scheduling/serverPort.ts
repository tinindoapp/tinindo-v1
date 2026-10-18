// Implementação real da porta: Edge Functions por módulo (ADR-0002), envelope v1 validado.
// Operações com contrato v1 (availability.list, pricing.quote, booking.*) já estão ligadas.
// Leituras sem contrato (listar atendimentos, serviços, clientes, expediente) lançam
// NotConnectedError até o integrador publicar `booking.list` & cia. (proposta no handoff do P04).
import {
  AvailabilityListOutput,
  BookingOutput,
  ContextResponse,
  Quote,
} from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import { NotConnectedError, type SchedulingPort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;

export function createServerPort(call: Call, tenantId: string): SchedulingPort {
  const post = (body: unknown, idempotencyKey?: string) => ({
    method: "POST" as const,
    tenantId,
    body,
    idempotencyKey,
  });

  return {
    kind: "server",
    now: () => new Date(),
    async context() {
      const { data } = await call("/context", ContextResponse, { tenantId });
      return { tenantId: data.tenant_id, tenantName: data.tenant_name, timezone: data.timezone, resourceId: null };
    },
    listServices: () => Promise.reject(new NotConnectedError("A lista de serviços", "P02 (leitura do catálogo)")),
    listCustomers: () => Promise.reject(new NotConnectedError("A lista de clientes", "P02 (leitura do CRM)")),
    listBookings: () => Promise.reject(new NotConnectedError("A lista de atendimentos", "P03 (proposta booking.list)")),
    getBooking: () => Promise.reject(new NotConnectedError("O detalhe do atendimento", "P03 (proposta booking.list)")),
    dayPlans: async () => null,
    async availability(input) {
      const { data } = await call("/scheduling/availability.list", AvailabilityListOutput, post(input));
      return data;
    },
    async quote(input) {
      const { data } = await call("/pricing/pricing.quote", Quote, post(input));
      return data;
    },
    async create(input, key) {
      const { data } = await call("/scheduling/booking.create", BookingOutput, post(input, key));
      return data.booking;
    },
    async reschedule(input, key) {
      const { data } = await call("/scheduling/booking.reschedule", BookingOutput, post(input, key));
      return data.booking;
    },
    async cancel(input, key) {
      const { data } = await call("/scheduling/booking.cancel", BookingOutput, post(input, key));
      return data.booking;
    },
    async complete(input, key) {
      const { data } = await call("/scheduling/booking.complete", BookingOutput, post(input, key));
      return data.booking;
    },
  };
}

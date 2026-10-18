// Porta da Lista de espera (P06). Demonstração: emulação na aba; servidor: Edge Function `waitlist`
// (+ `crm` para nomes, `scheduling` para o recurso e `pricing` para a cotação da oferta).
import type { Booking, TimeRange, WaitlistEntry, WaitlistOffer, WeeklyWindow, z } from "./types.ts";
import type { WaitlistListOutput, WaitlistOfferView } from "@contracts";

export interface WaitlistBase {
  timezone: string;
  customers: { id: string; name: string }[];
  services: { id: string; name: string; duration_min: number }[];
}

export interface WaitlistPort {
  readonly kind: "demo" | "server";
  now(): Date;
  base(): Promise<WaitlistBase>;
  list(): Promise<z.infer<typeof WaitlistListOutput>>;
  /** Registra o consentimento e entra na lista (dois comandos idempotentes). */
  join(input: { customer_id: string; service_id: string; windows: WeeklyWindow[]; valid_until: string }, key: string): Promise<WaitlistEntry>;
  withdraw(entry: WaitlistEntry, key: string): Promise<void>;
  /** Cota o horário e prepara a oferta (hold + token). Devolve o token só nesta resposta. */
  prepareOffer(entry: WaitlistEntry, slot: TimeRange, key: string): Promise<WaitlistOffer>;
  markShared(offerId: string, key: string): Promise<void>;
  cancelOffer(offerId: string, key: string): Promise<void>;
}

/** Link da oferta (anônimo): ver não muda nada; aceitar/recusar são ações explícitas. */
export interface OfferLinkPort {
  readonly kind: "demo" | "server";
  view(token: string): Promise<z.infer<typeof WaitlistOfferView>>;
  accept(token: string, key: string): Promise<Booking>;
  decline(token: string, key: string): Promise<void>;
}

export const newKey = () => crypto.randomUUID();

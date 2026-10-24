// Portas do módulo Site e Google (P17). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `presence`.
import type { DomainCheckOutput, GoogleSetInput, PresenceDelivery, PresenceOverview, PublicSite, SiteSaveInput, SiteSection, SiteSnapshot } from "@contracts";
import type { z } from "zod";

export type SiteDraft = z.input<typeof SiteSaveInput>;
export type GoogleAction = z.input<typeof GoogleSetInput>;
export type DomainCheck = z.infer<typeof DomainCheckOutput>;
export type { PresenceDelivery, PresenceOverview, PublicSite, SiteSection, SiteSnapshot };

export interface PresencePort {
  readonly kind: "demo" | "server";
  overview(): Promise<PresenceOverview>;
  saveSite(draft: SiteDraft, key: string): Promise<PresenceOverview>;
  publish(expectedHash: string, key: string): Promise<PresenceOverview>;
  unpublish(expectedVersion: number, key: string): Promise<PresenceOverview>;
  restore(versionNo: number, expectedVersion: number, key: string): Promise<PresenceOverview>;
  addDomain(hostname: string, key: string): Promise<PresenceOverview>;
  removeDomain(domainId: string, expectedVersion: number, key: string): Promise<PresenceOverview>;
  checkDomain(domainId: string): Promise<DomainCheck>;
  setGoogle(action: GoogleAction, key: string): Promise<PresenceOverview>;
  /** Só na demonstração: simula o cliente criando o registro TXT no DNS dele. */
  simulateDns?(txtName: string, value: string): void;
}

/** Leitura pública da página publicada (sem login). */
export interface PublicSitePort {
  readonly kind: "demo" | "server";
  site(slug: string): Promise<PublicSite>;
}

export const newKey = () => crypto.randomUUID();

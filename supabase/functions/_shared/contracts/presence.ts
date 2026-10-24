// Presença digital (P17). Aditivos ao v1; ver ADR-0025.
// Site padronizado montado só de dados públicos (perfil P09 publicado + serviços marcados), publicado por aprovação do
// hash visto, versionado e reversível; domínio do cliente verificado por DNS; Perfil da Empresa no Google por acesso de
// gerente concedido e revogável pelo dono; entregas com evidência. Nenhum campo de posição ou ranking existe aqui.
import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
export const SiteSection = z.enum(["services", "prices", "hours", "booking"]);
export type SiteSection = z.infer<typeof SiteSection>;
export const SiteTheme = z.enum(["papel", "tinta"]);

/** Conteúdo do site (prévia ou versão publicada). Só dados públicos; preço só com a seção "prices". */
export const SiteSnapshot = z.object({
  slug: z.string(),
  display_name: z.string().nullable(),
  category: z.enum(["barber", "hairdresser", "personal_trainer", "other"]),
  area: z.string(),
  bio: z.string().nullable(),
  headline: z.string().nullable(),
  theme: SiteTheme,
  sections: z.array(SiteSection),
  services: z.array(z.object({ name: z.string(), duration_min: z.int(), price_cents: z.int().nullable() })).max(30),
  hours: z.array(z.object({ weekday: z.int().min(0).max(6), start: z.string(), end: z.string() })),
  booking_path: z.string().nullable(),
  timezone: z.string(),
});
export type SiteSnapshot = z.infer<typeof SiteSnapshot>;

export const PresenceDomain = z.object({
  id: Uuid,
  hostname: z.string(),
  status: z.enum(["pending", "verified", "removed"]),
  /** Registro TXT a criar no DNS do cliente (valor público: prova controle, não dá acesso). */
  txt_name: z.string(),
  txt_value: z.string(),
  last_check_at: IsoDateTime.nullable(),
  last_check_result: z.enum(["found", "not_found", "taken", "lookup_failed"]).nullable(),
  verified_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  version: z.int().min(1),
});
export type PresenceDomain = z.infer<typeof PresenceDomain>;

export const GoogleAccess = z.object({
  status: z.enum(["not_connected", "granted", "revoked"]),
  profile_name: z.string().nullable(),
  profile_url: z.string().nullable(),
  /** Sempre gerente: a Tinindo nunca é proprietária do perfil do cliente. */
  access_level: z.literal("manager"),
  granted_at: IsoDateTime.nullable(),
  revoked_at: IsoDateTime.nullable(),
  version: z.int().min(0),
});

export const DeliveryKind = z.enum([
  "site_published", "site_unpublished", "site_restored", "domain_verified", "domain_removed",
  "google_access_granted", "google_access_revoked", "google_profile_update", "google_post", "google_review_reply",
]);
export const PresenceDelivery = z.object({
  id: Uuid,
  kind: DeliveryKind,
  summary: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  actor: z.enum(["owner", "operator", "system"]),
  service_order_id: Uuid.nullable(),
  created_at: IsoDateTime,
});
export type PresenceDelivery = z.infer<typeof PresenceDelivery>;

export const PresenceOverview = z.object({
  rules: z.object({ txt_name_prefix: z.string(), txt_value_prefix: z.string(), check_cooldown_seconds: z.int(), max_services: z.int(), headline_max: z.int() }),
  profile: z.object({ exists: z.boolean(), published: z.boolean(), slug: z.string().nullable(), public_fields: z.array(z.string()) }),
  site: z.object({
    headline: z.string().nullable(),
    sections: z.array(SiteSection),
    theme: SiteTheme,
    status: z.enum(["draft", "published", "unpublished"]),
    service_ids: z.array(Uuid),
    version: z.int().min(0),
  }),
  catalog: z.array(z.object({ id: Uuid, name: z.string(), duration_min: z.int(), base_price_cents: z.int(), active: z.boolean() })),
  preview: SiteSnapshot.nullable(),
  preview_hash: Hash.nullable(),
  published: z.object({ version_no: z.int().min(1), snapshot: SiteSnapshot, snapshot_hash: Hash, approved_at: IsoDateTime, published_at: IsoDateTime }).nullable(),
  versions: z.array(z.object({ version_no: z.int().min(1), snapshot_hash: Hash, approved_at: IsoDateTime })).max(20),
  domain: PresenceDomain.nullable(),
  google: GoogleAccess,
  deliveries: z.array(PresenceDelivery).max(50),
  /** Destino do CNAME no ambiente (null enquanto o projeto hospedado não existe). Vem da função, não do banco. */
  cname_target: z.string().nullable().default(null),
});
export type PresenceOverview = z.infer<typeof PresenceOverview>;

export const PresenceGetInput = z.object({});
export const SiteSaveInput = z.object({
  expected_version: z.int().min(0),
  headline: z.string().trim().max(90).nullable().default(null),
  sections: z.array(SiteSection).max(4).refine((s) => new Set(s).size === s.length, "seções repetidas"),
  theme: SiteTheme.default("papel"),
  service_ids: z.array(Uuid).max(30).default([]),
});
export const SitePublishInput = z.object({ expected_hash: Hash });
export const SiteUnpublishInput = z.object({ expected_version: z.int().min(1) });
export const SiteRestoreInput = z.object({ version_no: z.int().min(1), expected_version: z.int().min(1) });
export const DomainAddInput = z.object({ hostname: z.string().trim().toLowerCase().min(4).max(253) });
export const DomainRemoveInput = z.object({ domain_id: Uuid, expected_version: z.int().min(1) });
export const DomainCheckInput = z.object({ domain_id: Uuid });
export const DomainCheckOutput = z.object({ result: z.enum(["found", "not_found", "taken", "lookup_failed"]), domain: PresenceDomain });
export const GoogleSetInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), profile_name: z.string().trim().min(1).max(120), profile_url: z.string().trim().max(300).nullable().default(null), expected_version: z.int().min(0) }),
  z.object({ action: z.literal("revoke"), expected_version: z.int().min(1) }),
]);
export const DeliveryRecordInput = z.object({
  kind: z.enum(["google_profile_update", "google_post", "google_review_reply"]),
  summary: z.string().trim().min(1).max(280),
  evidence_url: z.string().trim().regex(/^https:\/\/\S{4,250}$/),
  service_order_id: Uuid.nullable().default(null),
});
export const DeliveryRecordOutput = z.object({ delivery: PresenceDelivery });

/** Leitura pública (sem login): por endereço do perfil ou por domínio verificado. */
export const PublicSiteInput = z.union([
  z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/) }),
  z.object({ host: z.string().trim().toLowerCase().min(4).max(253) }),
]);
export const PublicSiteOutput = z.object({
  site: SiteSnapshot,
  version_no: z.int().min(1),
  snapshot_hash: Hash,
  published_at: IsoDateTime,
  hostname: z.string().nullable(),
});
export type PublicSite = z.infer<typeof PublicSiteOutput>;

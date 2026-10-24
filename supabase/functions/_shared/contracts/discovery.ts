// Diretório e busca local (P23). Aditivos ao v1; ver ADR-0027.
// Opt-in com perfil publicado; o cartão público só leva o que o perfil (P09) e o site (P17) já mostram, a cidade
// declarada e, se o dono quiser, os dias de atendimento. Filtros exatos e ordem alfabética documentada (sem destaque
// pago, nota ou posição comprada).
import { z } from "zod";
import { IsoDateTime } from "./common.ts";

export const Uf = z.enum(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);
const CitySlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);
const Category = z.enum(["barber", "hairdresser", "personal_trainer", "other"]);

export const DirectoryCriteria = z.object({ filters: z.array(z.string()), order: z.string(), never: z.array(z.string()), page_size: z.int() });
export const DirectoryCard = z.object({
  slug: z.string(),
  display_name: z.string().nullable(),
  category: Category,
  area: z.string(),
  city_name: z.string(),
  city_slug: CitySlug,
  uf: Uf,
  profile_path: z.string().startsWith("/p/"),
  site_path: z.string().startsWith("/s/").nullable(),
  booking: z.boolean(),
  /** Dias com expediente (0 = domingo) só quando o dono escolheu mostrar; null = não mostra. */
  weekdays: z.array(z.int().min(0).max(6)).nullable(),
});
export type DirectoryCard = z.infer<typeof DirectoryCard>;

export const DiscoveryOverview = z.object({
  criteria: DirectoryCriteria,
  profile: z.object({ exists: z.boolean(), published: z.boolean(), slug: z.string().nullable(), public_fields: z.array(z.string()) }),
  listing: z.object({ uf: Uf, city_name: z.string(), city_slug: CitySlug, show_hours: z.boolean(), status: z.enum(["listed", "unlisted", "suspended"]),
    suspended_reason: z.string().nullable(), listed_at: IsoDateTime.nullable(), version: z.int().min(1) }).nullable(),
  card: DirectoryCard.nullable(),
  visible: z.boolean(),
});
export type DiscoveryOverview = z.infer<typeof DiscoveryOverview>;

export const DiscoveryGetInput = z.object({});
export const DiscoverySaveInput = z.object({
  expected_version: z.int().min(0),
  uf: z.string().trim().toUpperCase().pipe(Uf),
  city_name: z.string().trim().min(2).max(80),
  show_hours: z.boolean().default(false),
  listed: z.boolean(),
});
export const DirectorySearchInput = z.object({
  uf: z.string().trim().toUpperCase().pipe(Uf),
  city_slug: CitySlug,
  category: Category.nullable().default(null),
  area: z.string().trim().max(60).nullable().default(null),
  weekday: z.int().min(0).max(6).nullable().default(null),
  page: z.int().min(1).max(50).default(1),
});
export const DirectorySearchOutput = z.object({
  criteria: DirectoryCriteria,
  total: z.int().min(0),
  page: z.int().min(1),
  items: z.array(DirectoryCard).max(20),
  city_name: z.string().nullable(),
});
export type DirectorySearch = z.infer<typeof DirectorySearchOutput>;
export const DirectoryCitiesInput = z.object({ category: Category.nullable().default(null) });
export const DirectoryCitiesOutput = z.object({ cities: z.array(z.object({ uf: Uf, city_slug: CitySlug, city_name: z.string(), count: z.int().min(1) })) });
export type DirectoryCities = z.infer<typeof DirectoryCitiesOutput>;

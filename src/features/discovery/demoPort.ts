// EMULAÇÃO do Diretório para a demonstração sem servidor. Mesmas regras do banco: entrar exige perfil publicado; o
// cartão leva só campos autorizados; filtros exatos; ordem alfabética do nome exibido; sem destaque pago. Três negócios
// de exemplo já listados em São Paulo/SP; o negócio da demonstração entra quando o dono liga a opção.
import { DEFAULT_MESSAGES, DirectorySearchInput, DiscoverySaveInput, ERROR_STATUS, type ErrorCode, RETRYABLE } from "@contracts";
import { FIXED_NOW, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { DirectoryCard, DirectoryCities, DirectoryPort, DirectorySearch, DiscoveryOverview, DiscoveryPort } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
const CRITERIA = {
  filters: ["profissão (exata)", "cidade e UF (exatas)", "bairro (contém o texto, na área do perfil)", "dia da semana (só quem mostra o expediente)"],
  order: "ordem alfabética do nome exibido",
  never: ["destaque pago", "nota ou avaliação", "posição comprada", "contatos ou dados de clientes"],
  page_size: 20,
};
export const slug = (v: string) => v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const OTHERS: DirectoryCard[] = [
  { slug: "studio-exemplo-c", display_name: "Studio Exemplo C", category: "hairdresser", area: "Vila Madalena", city_name: "São Paulo", city_slug: "sao-paulo", uf: "SP",
    profile_path: "/p/studio-exemplo-c", site_path: null, booking: true, weekdays: [2, 3, 4, 5, 6] },
  { slug: "treino-exemplo-d", display_name: "Treino Exemplo D", category: "personal_trainer", area: "Pinheiros", city_name: "São Paulo", city_slug: "sao-paulo", uf: "SP",
    profile_path: "/p/treino-exemplo-d", site_path: null, booking: false, weekdays: null },
  { slug: "barba-exemplo-e", display_name: null, category: "barber", area: "Moema", city_name: "São Paulo", city_slug: "sao-paulo", uf: "SP",
    profile_path: "/p/barba-exemplo-e", site_path: null, booking: true, weekdays: [1, 2, 3, 4, 5, 6] },
];
interface State { listing: DiscoveryOverview["listing"]; profilePublished: boolean; idem: Map<string, unknown> }
let shared: State | null = null;
const state = (): State => (shared ??= { listing: null, profilePublished: true, idem: new Map() });
/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
/** Só para testes e demonstração: o dono tira/põe o perfil público no ar (P09). */
export function setDemoProfilePublished(on: boolean) {
  state().profilePublished = on;
}
function ownCard(): DirectoryCard | null {
  const s = state();
  const l = s.listing;
  if (!l || l.status !== "listed" || !s.profilePublished) return null;
  return { slug: "barbearia-exemplo-a", display_name: tenantA.name, category: "barber", area: "Pinheiros", city_name: l.city_name, city_slug: l.city_slug, uf: l.uf,
    profile_path: "/p/barbearia-exemplo-a", site_path: null, booking: true, weekdays: l.show_hours ? [1, 2, 3, 4, 5] : null };
}
const all = () => [...OTHERS, ...(ownCard() ? [ownCard()!] : [])];
const sortName = (c: DirectoryCard) => slug(c.display_name ?? c.area);

function overview(): DiscoveryOverview {
  const s = state();
  return clone({
    criteria: CRITERIA,
    profile: { exists: true, published: s.profilePublished, slug: "barbearia-exemplo-a", public_fields: ["display_name", "category", "area", "booking_link"] },
    listing: s.listing, card: ownCard(), visible: !!ownCard(),
  });
}

export function createDemoPort(): DiscoveryPort {
  return {
    kind: "demo",
    async overview() {
      return overview();
    },
    async save(draft, key) {
      const s = state();
      if (s.idem.has(key)) return overview();
      const d = DiscoverySaveInput.parse(draft);
      if (d.listed && !s.profilePublished) fail("POLICY_REJECTED", "profile");
      if ((s.listing?.version ?? 0) !== d.expected_version) fail("STALE_VERSION");
      const status = s.listing?.status === "suspended" ? "suspended" : d.listed ? "listed" : "unlisted";
      s.listing = { uf: d.uf, city_name: d.city_name, city_slug: slug(d.city_name), show_hours: d.show_hours, status, suspended_reason: s.listing?.suspended_reason ?? null,
        listed_at: status === "listed" ? (s.listing?.listed_at ?? FIXED_NOW) : s.listing?.listed_at ?? null, version: (s.listing?.version ?? 0) + 1 };
      s.idem.set(key, true);
      return overview();
    },
  };
}

export function createDemoDirectoryPort(): DirectoryPort {
  return {
    kind: "demo",
    async search(q): Promise<DirectorySearch> {
      const i = DirectorySearchInput.parse(q);
      const area = i.area ? slug(i.area) : null;
      const hits = all().filter((c) => c.uf === i.uf && c.city_slug === i.city_slug && (!i.category || c.category === i.category)
        && (!area || slug(c.area).includes(area)) && (i.weekday === null || (c.weekdays?.includes(i.weekday) ?? false)))
        .sort((a, b) => sortName(a).localeCompare(sortName(b)) || a.slug.localeCompare(b.slug));
      return clone({ criteria: CRITERIA, total: hits.length, page: i.page, items: hits.slice((i.page - 1) * 20, i.page * 20), city_name: hits[0]?.city_name ?? null });
    },
    async cities(category = null): Promise<DirectoryCities> {
      const map = new Map<string, { uf: DirectoryCard["uf"]; city_slug: string; city_name: string; count: number }>();
      for (const c of all().filter((x) => !category || x.category === category)) {
        const k = `${c.uf}/${c.city_slug}`;
        const cur = map.get(k) ?? { uf: c.uf, city_slug: c.city_slug, city_name: c.city_name, count: 0 };
        cur.count += 1;
        map.set(k, cur);
      }
      return { cities: [...map.values()].sort((a, b) => a.uf.localeCompare(b.uf) || a.city_slug.localeCompare(b.city_slug)) };
    },
  };
}

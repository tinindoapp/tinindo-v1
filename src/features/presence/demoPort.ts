// EMULAÇÃO de Site e Google para a demonstração sem servidor. Mesmas regras do banco que a tela explica: o site só
// existe com o perfil publicado e só leva dados públicos; publicar aprova o hash da prévia (mudou → recusa); cada
// publicação é uma versão; tirar do ar e voltar versão são reversíveis; domínio só vale com o TXT certo; Google só
// com acesso de gerente concedido. Nada sai do navegador; o DNS é simulado pelo botão de demonstração.
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode, RETRYABLE, SiteSaveInput } from "@contracts";
import { FIXED_NOW, services, tenantA } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import type { PresenceDelivery, PresenceOverview, PresencePort, PublicSite, PublicSitePort, SiteSnapshot } from "./port.ts";

function fail(code: ErrorCode, field?: string): never {
  throw new ApiError(code, DEFAULT_MESSAGES[code], ERROR_STATUS[code], crypto.randomUUID(), RETRYABLE.has(code), field);
}
const clone = <T>(v: T): T => structuredClone(v);
type Site = PresenceOverview["site"];
type Version = { version_no: number; snapshot: SiteSnapshot; snapshot_hash: string; approved_at: string };
interface State {
  profilePublished: boolean;
  site: Site;
  published: number | null;
  publishedAt: string | null;
  versions: Version[];
  domain: PresenceOverview["domain"];
  token: string;
  google: PresenceOverview["google"];
  deliveries: PresenceDelivery[];
  dns: Map<string, string[]>;
  prices: Map<string, number>;
  idem: Map<string, unknown>;
  seq: number;
  clock: number;
}
const SLUG = "barbearia-exemplo-a";
let shared: State | null = null;
const state = (): State => (shared ??= {
  profilePublished: true,
  site: { headline: null, sections: ["services", "booking"], theme: "papel", status: "draft", service_ids: [], version: 0 },
  published: null, publishedAt: null, versions: [], domain: null, token: "d".repeat(32),
  google: { status: "not_connected", profile_name: null, profile_url: null, access_level: "manager", granted_at: null, revoked_at: null, version: 0 },
  deliveries: [], dns: new Map(), prices: new Map(), idem: new Map(), seq: 0, clock: Date.parse(FIXED_NOW),
});
const ts = () => new Date((state().clock += 1000)).toISOString().replace(/\.\d{3}Z$/, "Z");
const id = () => `d0d0d0d0-0000-4000-8000-${String(++state().seq).padStart(12, "0")}`;
const catalog = () => services.filter((s) => s.tenant_id === tenantA.id && s.active).map((s) => ({ ...s, base_price_cents: state().prices.get(s.id) ?? s.base_price_cents }));
const HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" }));
const RULES = { txt_name_prefix: "_tinindo-verify", txt_value_prefix: "tinindo-verify=", check_cooldown_seconds: 20, max_services: 30, headline_max: 90 };

/** Só para testes. */
export function resetDemoState() {
  shared = null;
}
/** Só para testes e demonstração: o dono tira/põe o perfil público no ar (P09). */
export function setDemoProfilePublished(on: boolean) {
  state().profilePublished = on;
}
/** Só para testes e demonstração: muda o preço base de um serviço (prova que a versão publicada não muda sozinha). */
export function setDemoPrice(serviceId: string, cents: number) {
  state().prices.set(serviceId, cents);
}

function snapshot(): SiteSnapshot | null {
  const s = state();
  if (!s.profilePublished) return null;
  const has = (x: string) => s.site.sections.includes(x as never);
  const chosen = s.site.service_ids.map((sid) => catalog().find((c) => c.id === sid)).filter((c) => !!c);
  return {
    slug: SLUG, display_name: tenantA.name, category: "barber", area: "Pinheiros", bio: null, headline: s.site.headline, theme: s.site.theme, sections: [...s.site.sections],
    services: has("services") ? chosen.map((c) => ({ name: c.name, duration_min: c.duration_min, price_cents: has("prices") ? c.base_price_cents : null })) : [],
    hours: has("hours") ? HOURS : [], booking_path: has("booking") ? `/p/${SLUG}` : null, timezone: tenantA.timezone,
  };
}
async function hashOf(v: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(v));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function deliver(kind: PresenceDelivery["kind"], summary: string, evidence: Record<string, unknown>, actor: PresenceDelivery["actor"] = "owner") {
  state().deliveries.unshift({ id: id(), kind, summary, evidence, actor, service_order_id: null, created_at: ts() });
}
async function overview(): Promise<PresenceOverview> {
  const s = state();
  const preview = snapshot();
  const pv = s.published ? s.versions.find((v) => v.version_no === s.published) : undefined;
  return clone({
    rules: RULES,
    profile: { exists: true, published: s.profilePublished, slug: SLUG, public_fields: ["display_name", "category", "area", "booking_link"] },
    site: s.site,
    catalog: catalog().map((c) => ({ id: c.id, name: c.name, duration_min: c.duration_min, base_price_cents: c.base_price_cents, active: c.active })),
    preview, preview_hash: preview ? await hashOf(preview) : null,
    published: pv && s.publishedAt ? { ...pv, published_at: s.publishedAt } : null,
    versions: [...s.versions].reverse().map((v) => ({ version_no: v.version_no, snapshot_hash: v.snapshot_hash, approved_at: v.approved_at })),
    domain: s.domain, google: s.google, deliveries: s.deliveries.slice(0, 50), cname_target: null,
  });
}
async function once(key: string, run: () => Promise<void> | void): Promise<PresenceOverview> {
  const s = state();
  if (!s.idem.has(key)) {
    await run();
    s.idem.set(key, true);
  }
  return overview();
}

export function createDemoPort(): PresencePort {
  return {
    kind: "demo",
    overview,
    saveSite: (draft, key) => once(key, () => {
      const d = SiteSaveInput.parse(draft);
      const s = state();
      if (d.expected_version !== s.site.version) fail("STALE_VERSION");
      if (d.service_ids.some((sid) => !catalog().some((c) => c.id === sid))) fail("POLICY_REJECTED", "service_ids");
      s.site = { ...s.site, headline: d.headline || null, sections: d.sections, theme: d.theme, service_ids: d.service_ids, version: s.site.version + 1 };
    }),
    publish: (expected, key) => once(key, async () => {
      const s = state();
      const snap = snapshot();
      if (!snap) fail("POLICY_REJECTED", "profile");
      const h = await hashOf(snap);
      if (h !== expected) fail("STALE_VERSION", "preview");
      const current = s.versions.find((v) => v.version_no === s.published);
      if (s.site.status === "published" && current?.snapshot_hash === h) return;
      const no = s.versions.length + 1;
      s.versions.push({ version_no: no, snapshot: snap, snapshot_hash: h, approved_at: ts() });
      s.published = no;
      s.publishedAt = ts();
      s.site = { ...s.site, status: "published", version: s.site.version + 1 };
      deliver("site_published", `Site publicado (versão ${no}).`, { version_no: no, snapshot_hash: h, path: `/s/${SLUG}` });
    }),
    unpublish: (expected, key) => once(key, () => {
      const s = state();
      if (s.site.status !== "published") fail("POLICY_REJECTED", "status");
      if (s.site.version !== expected) fail("STALE_VERSION");
      deliver("site_unpublished", `Site tirado do ar (estava na versão ${s.published}).`, { version_no: s.published });
      s.published = null;
      s.site = { ...s.site, status: "unpublished", version: s.site.version + 1 };
    }),
    restore: (no, expected, key) => once(key, () => {
      const s = state();
      if (s.site.version !== expected) fail("STALE_VERSION");
      const v = s.versions.find((x) => x.version_no === no);
      if (!v) fail("NOT_FOUND", "version_no");
      if (!s.profilePublished) fail("POLICY_REJECTED", "profile");
      s.published = no;
      s.publishedAt = ts();
      s.site = { ...s.site, status: "published", version: s.site.version + 1 };
      deliver("site_restored", `Site no ar de novo com a versão ${no}.`, { version_no: no, snapshot_hash: v.snapshot_hash });
    }),
    addDomain: (hostname, key) => once(key, () => {
      const s = state();
      const host = hostname.trim().toLowerCase();
      if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) fail("VALIDATION_ERROR", "hostname");
      if (/(^|\.)tinindo\./.test(host) || /\.(test|example|invalid|localhost|local)$/.test(host)) fail("POLICY_REJECTED", "hostname");
      if (s.domain) fail("POLICY_REJECTED", "domain");
      s.domain = { id: id(), hostname: host, status: "pending", txt_name: `${RULES.txt_name_prefix}.${host}`, txt_value: `${RULES.txt_value_prefix}${s.token}`,
        last_check_at: null, last_check_result: null, verified_at: null, created_at: ts(), version: 1 };
    }),
    removeDomain: (domainId, expected, key) => once(key, () => {
      const s = state();
      if (!s.domain || s.domain.id !== domainId) fail("NOT_FOUND");
      if (s.domain.version !== expected) fail("STALE_VERSION");
      if (s.domain.status === "verified") deliver("domain_removed", `Domínio ${s.domain.hostname} desligado do site.`, { hostname: s.domain.hostname });
      s.domain = null;
    }),
    async checkDomain(domainId) {
      const s = state();
      const d = s.domain;
      if (!d || d.id !== domainId) fail("NOT_FOUND");
      const found = (s.dns.get(d.txt_name) ?? []).includes(d.txt_value);
      const result = d.status === "verified" || found ? "found" : "not_found";
      const at = ts();
      s.domain = { ...d, status: found ? "verified" : d.status, verified_at: found ? d.verified_at ?? at : d.verified_at, last_check_at: at, last_check_result: result,
        version: d.version + 1 };
      if (found && d.status !== "verified") {
        deliver("domain_verified", `Domínio ${d.hostname} verificado por DNS.`, { hostname: d.hostname, txt_name: d.txt_name, txt_value: d.txt_value }, "system");
      }
      return clone({ result, domain: s.domain });
    },
    setGoogle: (action, key) => once(key, () => {
      const s = state();
      const g = s.google;
      if (action.action === "grant") {
        if (g.status === "granted") fail("POLICY_REJECTED", "status");
        if (action.expected_version !== g.version) fail("STALE_VERSION");
        const url = action.profile_url?.trim() || null;
        if (url && !/^https:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.app\.goo\.gl\/|g\.page\/)/.test(url)) fail("VALIDATION_ERROR", "profile_url");
        s.google = { ...g, status: "granted", profile_name: action.profile_name.trim(), profile_url: url, granted_at: ts(), revoked_at: null, version: g.version + 1 };
        deliver("google_access_granted", `Acesso de gerente ao perfil “${s.google.profile_name}” concedido pelo dono.`, url ? { profile_url: url, access_level: "manager" } : { access_level: "manager" });
      } else {
        if (g.status !== "granted") fail("POLICY_REJECTED", "status");
        if (action.expected_version !== g.version) fail("STALE_VERSION");
        s.google = { ...g, status: "revoked", revoked_at: ts(), version: g.version + 1 };
        deliver("google_access_revoked", `Acesso ao perfil “${g.profile_name}” revogado pelo dono. Nada mais é feito no Google.`, {});
      }
    }),
    simulateDns(txtName, value) {
      state().dns.set(txtName, [value]);
    },
  };
}

export function createDemoPublicPort(): PublicSitePort {
  return {
    kind: "demo",
    async site(slug): Promise<PublicSite> {
      const s = state();
      const v = s.versions.find((x) => x.version_no === s.published);
      if (slug !== SLUG || !v || s.site.status !== "published" || !s.profilePublished || !s.publishedAt) fail("NOT_FOUND");
      return clone({ site: v.snapshot, version_no: v.version_no, snapshot_hash: v.snapshot_hash, published_at: s.publishedAt,
        hostname: s.domain?.status === "verified" ? s.domain.hostname : null });
    },
  };
}

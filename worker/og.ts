// Prévia do link no WhatsApp e nas redes (auditoria de UX, item E1). Quem lê a prévia (robô do WhatsApp, Facebook,
// Telegram) não roda JavaScript: as tags Open Graph precisam vir no HTML que o servidor entrega. O Worker que serve o
// frontend intercepta só /p/:slug (perfil) e /s/:slug (site) e troca o bloco de tags padrão do index.html pelas do
// perfil publicado, lidas das leituras públicas que o app já usa (network/public.profile e presence.public_site).
// Só dados que o dono publicou. Qualquer falha (sem Supabase, perfil fora do ar, lentidão) devolve o padrão genérico.

export interface OgConfig {
  /** URL do Supabase e chave pública do mesmo build (as mesmas que já vão no bundle). null na demonstração. */
  supabase_url: string | null;
  publishable_key: string | null;
}

export interface OgTags {
  title: string;
  description: string;
  url: string;
  image: string;
}

const CATEGORY: Record<string, string> = {
  barber: "Barbearia",
  hairdresser: "Cabeleireiro(a)",
  personal_trainer: "Personal trainer",
  other: "Serviços",
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;
export const OG_START = "<!-- og:start -->";
export const OG_END = "<!-- og:end -->";
/** Tempo máximo para buscar o perfil: a prévia não pode atrasar a página de quem abre o link. */
const TIMEOUT_MS = 1500;

export function routeOf(pathname: string): { kind: "profile" | "site"; slug: string } | null {
  const m = /^\/(p|s)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  const slug = decodeURIComponent(m[2]!).toLowerCase();
  if (!SLUG.test(slug)) return null;
  return { kind: m[1] === "p" ? "profile" : "site", slug };
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export function renderTags(tags: OgTags): string {
  const t = escape(clip(tags.title, 70));
  const d = escape(clip(tags.description, 200));
  return [
    OG_START,
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Tinindo" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escape(tags.url)}" />`,
    `<meta property="og:image" content="${escape(tags.image)}" />`,
    `<meta property="og:image:width" content="512" />`,
    `<meta property="og:image:height" content="512" />`,
    `<meta name="twitter:card" content="summary" />`,
    OG_END,
  ].join("\n    ");
}

/** Troca o bloco padrão (entre og:start e og:end) do index.html. Sem o bloco, devolve o HTML intacto. */
export function injectTags(html: string, tags: OgTags): string {
  const a = html.indexOf(OG_START);
  const b = html.indexOf(OG_END);
  if (a < 0 || b < a) return html;
  return html.slice(0, a) + renderTags(tags) + html.slice(b + OG_END.length);
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function readJson(fetcher: Fetch, url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
  const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: unknown };
  return json && typeof json.data === "object" && json.data ? (json.data as Record<string, unknown>) : null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Frases curtas numa descrição só, sem ponto duplicado. */
const sentences = (parts: (string | null)[]) =>
  parts.filter((p): p is string => !!p).map((p) => p.replace(/[.\s]+$/, "")).join(". ") + ".";

/** Tags do perfil ou do site publicado; null quando não há o que mostrar (o chamador usa o padrão). */
export async function tagsFor(
  route: { kind: "profile" | "site"; slug: string },
  origin: string,
  config: OgConfig,
  fetcher: Fetch,
): Promise<OgTags | null> {
  if (!config.supabase_url || !config.publishable_key) return null;
  const base = `${config.supabase_url.replace(/\/$/, "")}/functions/v1`;
  const headers = { apikey: config.publishable_key };
  const image = `${origin}/icons/app-icon-512.png`;
  const url = `${origin}/${route.kind === "profile" ? "p" : "s"}/${route.slug}`;

  if (route.kind === "profile") {
    const p = await readJson(fetcher, `${base}/network/public.profile?slug=${encodeURIComponent(route.slug)}`, { headers });
    if (!p) return null;
    const fields = (p.fields ?? {}) as Record<string, unknown>;
    const category = CATEGORY[String(p.category)] ?? CATEGORY.other!;
    const name = str(fields.display_name) ?? category;
    const area = str(p.area);
    const about = str(fields.bio) ?? str(fields.services_summary);
    const lead = [category, area].filter(Boolean).join(" · ");
    const action = str(fields.booking_link) ? "Veja os horários livres e agende pelo link." : "Veja o perfil no Tinindo.";
    return { title: name, description: sentences([lead, about, action]), url, image };
  }

  const s = await readJson(fetcher, `${base}/presence/presence.public_site`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ slug: route.slug }),
  });
  const site = s && typeof s.site === "object" && s.site ? (s.site as Record<string, unknown>) : null;
  if (!site) return null;
  const category = CATEGORY[String(site.category)] ?? CATEGORY.other!;
  const name = str(site.display_name) ?? category;
  const lead = [category, str(site.area)].filter(Boolean).join(" · ");
  const about = str(site.headline) ?? str(site.bio);
  return { title: name, description: sentences([lead, about, "Veja os serviços e agende pelo link"]), url, image };
}

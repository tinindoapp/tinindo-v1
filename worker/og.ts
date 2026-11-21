// Prévia do link no WhatsApp e nas redes (auditoria de UX, item E1; revisão 2026-11-10, D18, D19 e D24). Quem lê a
// prévia (robô do WhatsApp, Facebook, Telegram, buscadores) não roda JavaScript: as tags precisam vir no HTML que o
// servidor entrega. O Worker que serve o frontend troca o bloco de tags padrão do index.html (entre og:start e og:end):
//   /p/:slug                    perfil publicado: nome do negócio, canonical e dados estruturados (JSON-LD).
//   /s/:slug                    301 para /p/:slug (D19: o perfil absorveu o site); resolvido em worker/index.ts.
//   /pagar, /orcamento, /avaliar, /reserva (com /:slug opcional), /avaliacoes/:slug e /oferta
//                               páginas do cliente final: prévia com o nome do negócio quando o caminho traz o
//                               endereço do perfil; sem ele, texto neutro para o cliente (nunca o slogan do app, que
//                               fala com o profissional). O token desses links vai no fragmento (#) e não chega aqui.
// Só dados que o dono publicou (leitura pública network/public.profile). Falhar aberto: sem Supabase, perfil fora do
// ar ou lentidão, /p fica com o padrão do index.html e as páginas do cliente ficam com o texto neutro (sem rede).

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
  /** Tamanho da imagem em px: 1200×630 na imagem padrão (cartão grande), 800×800 na foto do perfil. */
  imageWidth?: number;
  imageHeight?: number;
  /** Endereço canônico (páginas indexáveis: perfil e avaliações). */
  canonical?: string;
  /** Dados estruturados schema.org (todas as páginas do cliente). */
  jsonLd?: Record<string, unknown>;
  /** Páginas de link com token: fora dos buscadores. */
  noindex?: boolean;
}

/** Páginas do cliente final além do perfil. */
export type CustomerKind = "payment" | "quote" | "review" | "booking" | "offer" | "reviews";
export type Route =
  | { kind: "profile"; slug: string }
  /** /s/:slug: endereço antigo do site, redireciona para o perfil. */
  | { kind: "redirect"; slug: string }
  | { kind: CustomerKind; slug: string | null };

const CATEGORY: Record<string, string> = {
  barber: "Barbearia",
  hairdresser: "Cabeleireiro(a)",
  personal_trainer: "Personal trainer",
  other: "Serviços",
};
/** Tipo schema.org por categoria; o que não tem tipo específico certo fica em LocalBusiness. */
const SCHEMA_TYPE: Record<string, string> = { barber: "HairSalon", hairdresser: "HairSalon" };

const SEGMENT: Record<string, CustomerKind> = {
  pagar: "payment",
  orcamento: "quote",
  avaliar: "review",
  reserva: "booking",
  oferta: "offer",
  avaliacoes: "reviews",
};
const PATH: Record<CustomerKind, string> = {
  payment: "pagar",
  quote: "orcamento",
  review: "avaliar",
  booking: "reserva",
  offer: "oferta",
  reviews: "avaliacoes",
};
/** Links com token (fragmento): cada um é de um cliente só, não entram em buscador. */
const TOKEN_PAGES: ReadonlySet<CustomerKind> = new Set(["payment", "quote", "review", "booking", "offer"]);

/** Texto com o nome do negócio (D18: a marca do profissional vem primeiro). /oferta não leva slug. */
const NAMED: Record<Exclude<CustomerKind, "offer">, (name: string) => [title: string, description: string]> = {
  payment: (n) => [`Pagamento · ${n}`, `${n} enviou um link de pagamento. Abra para ver o valor e o prazo.`],
  quote: (n) => [`Orçamento · ${n}`, `${n} enviou um orçamento. Abra para ver os itens e responder.`],
  review: (n) => [`Avalie seu atendimento · ${n}`, `Conte como foi seu atendimento com ${n}. Leva um minuto.`],
  booking: (n) => [`Sua reserva · ${n}`, `Veja o dia, a hora e o local da sua reserva com ${n}.`],
  reviews: (n) => [`Avaliações de ${n}`, `Veja o que clientes atendidos dizem sobre ${n}.`],
};
/** Texto neutro, para o cliente final, quando não dá para saber o negócio. Não depende de rede. */
const NEUTRAL: Record<CustomerKind, [title: string, description: string]> = {
  payment: ["Link de pagamento", "Você recebeu um link de pagamento de um profissional que usa a Tinindo. Abra para ver o valor e o prazo."],
  quote: ["Orçamento", "Você recebeu um orçamento de um profissional que usa a Tinindo. Abra para ver os itens e responder."],
  review: ["Avalie seu atendimento", "Conte como foi seu atendimento com um profissional que usa a Tinindo. Leva um minuto."],
  booking: ["Sua reserva", "Veja o dia, a hora e o local da sua reserva com um profissional que usa a Tinindo."],
  offer: ["Um horário abriu para você", "Um profissional que usa a Tinindo ofereceu um horário para você. Abra para ver e responder."],
  reviews: ["Avaliações", "Veja o que clientes atendidos dizem sobre este profissional na Tinindo."],
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;
export const OG_START = "<!-- og:start -->";
export const OG_END = "<!-- og:end -->";
/** Tempo máximo para buscar o perfil: a prévia não pode atrasar a página de quem abre o link. */
const TIMEOUT_MS = 1500;
// Imagem sem foto do negócio (D24): public/og/previa.png, 1200×630, feita com o wordmark original
// (worker/gerar-imagem-previa.cjs). O título e a descrição dizem o nome do negócio; a imagem é neutra.
export const FALLBACK_IMAGE = "/og/previa.png";
const FALLBACK_SIZE = { imageWidth: 1200, imageHeight: 630 } as const;
const PHOTO_SIZE = { imageWidth: 800, imageHeight: 800 } as const;

function slugOf(segment: string): string | null {
  try {
    const slug = decodeURIComponent(segment).toLowerCase();
    return SLUG.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

export function routeOf(pathname: string): Route | null {
  const m = /^\/([a-z]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return null;
  const [, head, segment] = m;
  const slug = segment === undefined ? null : slugOf(segment);
  if (head === "p" || head === "s") return slug ? { kind: head === "p" ? "profile" : "redirect", slug } : null;
  const kind = SEGMENT[head!];
  if (!kind) return null;
  // /oferta não tem endereço de perfil; /avaliacoes só existe com ele.
  if (kind === "offer") return segment === undefined ? { kind, slug: null } : null;
  if (kind === "reviews") return slug ? { kind, slug } : null;
  // Link com token e endereço inválido: ainda é página do cliente, fica com o texto neutro.
  return { kind, slug };
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** JSON dentro de <script>: os valores são do dono do perfil, então nada de "<", ">" ou "&" crus (fecharia a tag). */
const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function renderTags(tags: OgTags): string {
  const t = escape(clip(tags.title, 70));
  const d = escape(clip(tags.description, 200));
  const width = tags.imageWidth ?? FALLBACK_SIZE.imageWidth;
  const height = tags.imageHeight ?? FALLBACK_SIZE.imageHeight;
  return [
    OG_START,
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    ...(tags.noindex ? [`<meta name="robots" content="noindex" />`] : []),
    ...(tags.canonical ? [`<link rel="canonical" href="${escape(tags.canonical)}" />`] : []),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Tinindo" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escape(tags.url)}" />`,
    `<meta property="og:image" content="${escape(tags.image)}" />`,
    `<meta property="og:image:width" content="${width}" />`,
    `<meta property="og:image:height" content="${height}" />`,
    `<meta property="og:image:alt" content="${t}" />`,
    // Foto quadrada do negócio: cartão pequeno; imagem 1200×630: cartão grande.
    `<meta name="twitter:card" content="${width > height ? "summary_large_image" : "summary"}" />`,
    ...(tags.jsonLd ? [`<script type="application/ld+json">${scriptJson(tags.jsonLd)}</script>`] : []),
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

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Frases curtas numa descrição só, sem ponto duplicado. */
const sentences = (parts: (string | null)[]) =>
  parts.filter((p): p is string => !!p).map((p) => p.replace(/[.\s]+$/, "")).join(". ") + ".";

interface PublicProfile {
  /** Campos D21 (P55): endereço ou domicílio, horário e política. */
  details: { address: string | null; homeService: boolean; openingHours: string | null };
  category: string;
  /** Nome que o dono publicou; null quando o perfil não tem nome próprio. */
  name: string | null;
  area: string | null;
  fields: Record<string, unknown>;
  /** Foto pública do negócio, já conferida; null sem foto. */
  photo: string | null;
}

/** Perfil publicado pelo endereço; null sem Supabase, fora do ar, erro de rede ou demora (falhar aberto). */
async function readProfile(slug: string, config: OgConfig, fetcher: Fetch): Promise<PublicProfile | null> {
  if (!config.supabase_url || !config.publishable_key) return null;
  const supabase = config.supabase_url.replace(/\/$/, "");
  try {
    const res = await fetcher(`${supabase}/functions/v1/network/public.profile?slug=${encodeURIComponent(slug)}`, {
      headers: { apikey: config.publishable_key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown } | null;
    if (!json || typeof json.data !== "object" || !json.data) return null;
    const p = json.data as Record<string, unknown>;
    const fields = (p.fields && typeof p.fields === "object" ? p.fields : {}) as Record<string, unknown>;
    // Foto do negócio quando o dono ligou "Mostrar foto" (o servidor já manda null desligado); só do bucket público.
    const photo = p.photo && typeof p.photo === "object" ? str((p.photo as Record<string, unknown>).url) : null;
    const d = (p.details && typeof p.details === "object" ? p.details : {}) as Record<string, unknown>;
    return {
      details: { address: str(d.address), homeService: d.home_service === true, openingHours: str(d.opening_hours) },
      category: String(p.category),
      name: str(fields.display_name),
      area: str(p.area),
      fields,
      photo: photo?.startsWith(`${supabase}/storage/v1/object/public/profile-photos/`) ? photo : null,
    };
  } catch {
    return null;
  }
}

/**
 * Tags da rota. null só no perfil (/p) sem dado publicado: o chamador deixa o index.html como está.
 * Nas páginas do cliente sempre devolve tags (com o nome do negócio, ou neutras) e nunca lança.
 */
export async function tagsFor(route: Exclude<Route, { kind: "redirect" }>, origin: string, config: OgConfig, fetcher: Fetch): Promise<OgTags | null> {
  const profile = route.slug ? await readProfile(route.slug, config, fetcher) : null;
  // Sempre URL absoluta, com largura e altura: é o que os robôs de prévia pedem.
  const image = profile?.photo
    ? { image: profile.photo, ...PHOTO_SIZE }
    : { image: `${origin}${FALLBACK_IMAGE}`, ...FALLBACK_SIZE };

  if (route.kind === "profile") {
    if (!profile) return null;
    const url = `${origin}/p/${route.slug}`;
    const category = CATEGORY[profile.category] ?? CATEGORY.other!;
    const name = profile.name ?? category;
    const bio = str(profile.fields.bio);
    const about = bio ?? str(profile.fields.services_summary);
    const lead = [category, profile.area].filter(Boolean).join(" · ");
    const action = str(profile.fields.booking_link) ? "Veja os horários livres e agende pelo link." : "Veja o perfil na Tinindo.";
    return { title: name, description: sentences([lead, about, action]), url, ...image, canonical: url, jsonLd: businessLd(profile, name, url) };
  }

  const named = profile?.name && route.kind !== "offer" ? NAMED[route.kind](clip(profile.name, 60)) : null;
  const [title, description] = named ?? NEUTRAL[route.kind];
  const url = `${origin}/${PATH[route.kind]}${route.slug ? `/${route.slug}` : ""}`;
  const business = profile && route.slug ? businessLd(profile, profile.name ?? CATEGORY[profile.category] ?? CATEGORY.other!, `${origin}/p/${route.slug}`) : null;
  // Dados estruturados em todas as páginas do cliente: a página (WebPage) e, quando se sabe, o negócio de quem ela é.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: clip(title, 70),
    url,
    inLanguage: "pt-BR",
    ...(business ? { about: { ...business, "@context": undefined } } : {}),
  };
  const indexable = !TOKEN_PAGES.has(route.kind);
  // Links com token: fora dos buscadores e sem canonical (noindex e canonical juntos mandam sinais opostos).
  return { title, description, url, ...image, jsonLd, ...(indexable ? { canonical: url } : { noindex: true }) };
}

/**
 * O negócio em schema.org (D24): só o que o dono publicou. Sem nota média, sem horário e sem endereço inventados.
 * O endereço entra como texto quando o perfil traz `details.address`; atender em domicílio vira `areaServed`.
 * `details.opening_hours` (texto livre) não vira `openingHours`, que exige formato próprio do schema.org.
 */
function businessLd(profile: PublicProfile, name: string, url: string): Record<string, unknown> {
  const bio = str(profile.fields.bio);
  return {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPE[profile.category] ?? "LocalBusiness",
    name,
    url,
    ...(profile.photo ? { image: profile.photo } : {}),
    ...(bio ? { description: clip(bio, 500) } : {}),
    ...(profile.area ? { areaServed: profile.area } : {}),
    ...(profile.details.address ? { address: clip(profile.details.address, 200) } : {}),
  };
}

// Página do site (P17) em HTML servido pelo backend: indexável sem JavaScript, com título, descrição, endereço
// canônico e dados estruturados do negócio. Só o conteúdo aprovado (versão publicada); sem avaliação, nota ou
// promessa de posição (não há fonte verificável para isso). Todo texto é escapado.
import type { PublicSite } from "../../contracts/index.ts";

const CATEGORY: Record<PublicSite["site"]["category"], string> = {
  barber: "Barbearia",
  hairdresser: "Cabeleireira",
  personal_trainer: "Personal trainer",
  other: "Serviços",
};
const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
// Valores dos tokens da marca (brand/tokens/tokens.css, temas claro e escuro). A página é servida fora do app, sem o
// tokens.css; manter em sincronia (teste em tests/contracts/presence).
export const THEME = {
  papel: { bg: "#F7F7F5", fg: "#111111", muted: "#4A4A46", card: "#FFFFFF", line: "#DEDED9" },
  tinta: { bg: "#111111", fg: "#F7F7F5", muted: "#BDBDB7", card: "#1C1C1A", line: "#3A3A37" },
} as const;

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Título e descrição da página (também usados pela prévia no app). */
export function pageMeta(p: PublicSite): { title: string; description: string } {
  const s = p.site;
  const name = s.display_name ?? CATEGORY[s.category];
  const title = `${name} · ${CATEGORY[s.category]} em ${s.area}`;
  const description = (s.headline ?? s.bio ?? `${CATEGORY[s.category]} em ${s.area}.`).slice(0, 160);
  return { title, description };
}

export function renderSitePage(p: PublicSite, opts: { origin: string }): string {
  const s = p.site;
  const c = THEME[s.theme];
  const { title, description } = pageMeta(p);
  const canonical = p.hostname ? `https://${p.hostname}/` : `${opts.origin.replace(/\/$/, "")}/s/${s.slug}`;
  const booking = s.booking_path ? `${opts.origin.replace(/\/$/, "")}${s.booking_path}` : null;
  // Dados estruturados mínimos e verdadeiros: nome, área e endereço da página. Sem nota agregada.
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "LocalBusiness", name: s.display_name ?? title, areaServed: s.area, url: canonical,
    ...(s.services.length ? { makesOffer: s.services.map((x) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: x.name },
      ...(x.price_cents != null ? { price: (x.price_cents / 100).toFixed(2), priceCurrency: "BRL" } : {}) })) } : {}),
  }).replace(/</g, "\\u003c");
  const services = s.services.length
    ? `<section><h2>Serviços</h2><ul class="list">${s.services.map((x) =>
      `<li><span>${escapeHtml(x.name)} <small>${x.duration_min} min</small></span>${x.price_cents != null ? `<strong>${escapeHtml(formatBRL(x.price_cents))}</strong>` : ""}</li>`).join("")}</ul></section>`
    : "";
  const hours = s.hours.length
    ? `<section><h2>Horários</h2><ul class="list">${s.hours.map((h) => `<li><span>${WEEKDAY[h.weekday]}</span><span>${escapeHtml(h.start)}–${escapeHtml(h.end)}</span></li>`).join("")}</ul></section>`
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<script type="application/ld+json">${ld}</script>
<style>
body{margin:0;background:${c.bg};color:${c.fg};font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px 48px}
h1{font-size:2rem;line-height:1.15;margin:0 0 8px}h2{font-size:1.15rem;margin:32px 0 8px}
.muted{color:${c.muted}}.list{list-style:none;margin:0;padding:0;background:${c.card};border:1px solid ${c.line};border-radius:16px}
.list li{display:flex;justify-content:space-between;gap:12px;padding:12px 16px}.list li+li{border-top:1px solid ${c.line}}
small{color:${c.muted}}.cta{display:inline-block;margin-top:24px;padding:12px 24px;border-radius:999px;background:${c.fg};color:${c.bg};text-decoration:none;font-weight:600}
footer{margin-top:40px;font-size:.85rem}
</style>
</head>
<body>
<main>
<p class="muted">${escapeHtml(CATEGORY[s.category])} · ${escapeHtml(s.area)}</p>
<h1>${escapeHtml(s.display_name ?? CATEGORY[s.category])}</h1>
${s.headline ? `<p>${escapeHtml(s.headline)}</p>` : ""}
${s.bio ? `<p class="muted">${escapeHtml(s.bio)}</p>` : ""}
${booking ? `<a class="cta" href="${escapeHtml(booking)}">Ver horários e agendar</a>` : ""}
${services}
${hours}
<footer class="muted">Página feita com a Tinindo · versão ${p.version_no}</footer>
</main>
</body>
</html>`;
}

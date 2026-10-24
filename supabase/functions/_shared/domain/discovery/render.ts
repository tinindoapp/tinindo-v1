// Páginas indexáveis do diretório (P23): "Profissão em Cidade/UF" com a lista dos listados, canônico, descrição e
// ItemList (schema.org) só com o que é público. Mostra os critérios de ordem; sem nota, destaque pago ou promessa.
import type { DirectorySearch } from "../../contracts/index.ts";
import { escapeHtml, THEME } from "../presence/render.ts";

export const CATEGORY_PLURAL = { barber: "Barbearias", hairdresser: "Cabeleireiras", personal_trainer: "Personal trainers", other: "Serviços" } as const;
const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function directoryPath(uf: string, citySlug: string, category: string | null): string {
  return `/diretorio/${uf.toLowerCase()}/${citySlug}${category ? `/${category}` : ""}`;
}

export function renderDirectoryPage(r: DirectorySearch, q: { uf: string; city_slug: string; category: keyof typeof CATEGORY_PLURAL | null }, opts: { origin: string }): string {
  const c = THEME.papel;
  const origin = opts.origin.replace(/\/$/, "");
  const city = r.city_name ?? q.city_slug;
  const what = q.category ? CATEGORY_PLURAL[q.category] : "Profissionais";
  const title = `${what} em ${city}/${q.uf}`;
  const canonical = `${origin}${directoryPath(q.uf, q.city_slug, q.category)}`;
  const description = `${r.total} ${r.total === 1 ? "profissional listado" : "profissionais listados"} em ${city}/${q.uf}. Ordem: ${r.criteria.order}; sem destaque pago.`;
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList", name: title,
    itemListElement: r.items.map((x, i) => ({ "@type": "ListItem", position: i + 1, url: `${origin}${x.site_path ?? x.profile_path}`, name: x.display_name ?? x.area })),
  }).replace(/</g, "\\u003c");
  const items = r.items.map((x) => `<li><a href="${escapeHtml(`${origin}${x.site_path ?? x.profile_path}`)}"><strong>${escapeHtml(x.display_name ?? x.area)}</strong></a>`
    + `<span>${escapeHtml(x.area)}${x.weekdays?.length ? ` · atende ${x.weekdays.map((d) => WEEKDAY[d]).join(", ")}` : ""}</span></li>`).join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<script type="application/ld+json">${ld}</script>
<style>
body{margin:0;background:${c.bg};color:${c.fg};font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.9rem;line-height:1.15;margin:0 0 8px}
.muted{color:${c.muted}}ul{list-style:none;margin:24px 0 0;padding:0;background:${c.card};border:1px solid ${c.line};border-radius:16px}
li{display:grid;gap:2px;padding:12px 16px}li+li{border-top:1px solid ${c.line}}a{color:${c.fg}}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="muted">${escapeHtml(description)}</p>
${r.items.length ? `<ul>${items}</ul>` : `<p>Nenhum profissional listado aqui ainda.</p>`}
<p class="muted">Critérios: ${escapeHtml(r.criteria.filters.join("; "))}. Nunca: ${escapeHtml(r.criteria.never.join(", "))}.</p>
</main>
</body>
</html>`;
}

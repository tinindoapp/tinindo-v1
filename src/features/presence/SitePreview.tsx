// O site como o público vê (prévia no app e página /s/:slug). Mesmo conteúdo da página HTML servida pelo backend.
import { Link } from "react-router";
import { CATEGORY_LABEL, formatCents, WEEKDAY } from "./labels.ts";
import type { SiteSnapshot } from "./port.ts";

export function SitePreview({ site, headingLevel = 2, live = false }: { site: SiteSnapshot; headingLevel?: 1 | 2; live?: boolean }) {
  const H = headingLevel === 1 ? "h1" : "h2";
  const Sub = headingLevel === 1 ? "h2" : "h3";
  const name = site.display_name ?? CATEGORY_LABEL[site.category];
  return (
    <article className="tn-site" data-theme={site.theme} aria-label={live ? undefined : `Prévia do site de ${name}`}>
      <p className="tn-site__eyebrow">{CATEGORY_LABEL[site.category]} · {site.area}</p>
      <H className="tn-site__name">{name}</H>
      {site.headline ? <p className="tn-site__headline">{site.headline}</p> : null}
      {site.bio ? <p className="tn-site__bio">{site.bio}</p> : null}
      {site.booking_path ? (
        live ? <Link className="tn-site__cta" to={site.booking_path}>Ver horários e agendar</Link> : <span className="tn-site__cta" aria-hidden="true">Ver horários e agendar</span>
      ) : null}
      {site.services.length ? (
        <section className="tn-site__block">
          <Sub>Serviços</Sub>
          <ul className="tn-site__list">
            {site.services.map((s) => (
              <li key={s.name}>
                <span>{s.name} <small>{s.duration_min} min</small></span>
                {s.price_cents != null ? <strong className="tn-num">{formatCents(s.price_cents)}</strong> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {site.hours.length ? (
        <section className="tn-site__block">
          <Sub>Horários</Sub>
          <ul className="tn-site__list">
            {site.hours.map((h) => <li key={`${h.weekday}-${h.start}`}><span>{WEEKDAY[h.weekday]}</span><span className="tn-num">{h.start}–{h.end}</span></li>)}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

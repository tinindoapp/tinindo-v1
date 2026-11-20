// Lista pública das avaliações de um negócio (/avaliacoes/:slug). O negócio vem primeiro (D18) e o título diz de quem
// são as avaliações (05 #12); a Tinindo só no rodapé. Sem sessão.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { StatusBanner } from "../../components/ui/index.tsx";
import type { PublicReviewsPort, ReviewPublicList } from "./port.ts";
import { type PublicBusiness, PublicFrame, PublicMissing, PublicSkeleton, usePublicBusiness } from "./public-kit.tsx";
import { Badges, ReviewSummary, ReviewView } from "./ReviewViews.tsx";

export function PublicReviewsPage({ port }: { port: PublicReviewsPort }) {
  const { slug = "" } = useParams();
  const profile = usePublicBusiness(slug);
  const [data, setData] = useState<{ slug: string; list: ReviewPublicList | null } | null>(null);
  useEffect(() => {
    let alive = true;
    port.list(slug).then((l) => alive && setData({ slug, list: l }), () => alive && setData({ slug, list: null }));
    return () => { alive = false; };
  }, [port, slug]);
  const cur = data?.slug === slug ? data : null;
  // Sem perfil publicado lido (demonstração), vale o nome que a porta conhece; o endereço mantém a volta ao perfil.
  const business: PublicBusiness | null | undefined = profile ?? (profile === null && cur?.list && port.businessName ? { name: port.businessName, slug } : profile);
  const loading = !cur || profile === undefined;

  return (
    <PublicFrame business={business}>
      {loading ? (
        <>
          <h1>Avaliações</h1>
          <PublicSkeleton label="Carregando as avaliações…" />
        </>
      ) : null}
      {!loading && !cur.list ? (
        <PublicMissing title="Não encontramos estas avaliações" business={business} what="a página de avaliações">
          <p>O endereço pode estar errado ou a página saiu do ar. Confira o link com quem mandou.</p>
        </PublicMissing>
      ) : null}
      {!loading && cur.list ? (
        <section className="tn-rev-pub" aria-labelledby="rev-pub-title">
          <h1 id="rev-pub-title">{business ? `Avaliações de ${business.name}` : "Avaliações"}</h1>
          {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Avaliações de exemplo.</StatusBanner> : null}
          <ReviewSummary s={cur.list.summary} min={cur.list.rules.min_reviews_for_average} />
          <Badges s={cur.list.summary} />
          <ul className="tn-rev-list" aria-label="Avaliações publicadas">{cur.list.reviews.map((r) => <li key={r.id} className="tn-rev-item"><ReviewView r={r} /></li>)}</ul>
          <p><Link className="tn-rev-back" to={`/p/${slug}`}>Voltar ao perfil</Link></p>
        </section>
      ) : null}
    </PublicFrame>
  );
}

// Avaliações em destaque na vitrine do perfil (P55 parte 2, item 5). As avaliações são do módulo Avaliações: o perfil
// lê a lista pública pela API (review.public_list), sem importar o módulo. Destaque = as mais recentes com comentário,
// sem filtrar pela nota (BRAND.md, Reputação: nada de escolher só as boas). Sem avaliações, a seção não aparece.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { type ReviewPublicList, ReviewPublicListOutput } from "@contracts";
import { anonCall } from "../../../components/public/public-kit.tsx";
import { formatMonth } from "../../../lib/time.ts";

export type ReviewsReader = (slug: string) => Promise<ReviewPublicList | null>;

const serverReader: ReviewsReader = async (slug) => {
  const call = anonCall();
  // Demonstração sem servidor: o pacote público troca a leitura pela do módulo Avaliações (src/app/public-app.tsx).
  if (!call) return null;
  return call("/reputation/review.public_list", ReviewPublicListOutput, { method: "POST", body: { slug } }).then((r) => r.data, () => null);
};
let reader: ReviewsReader = serverReader;
/** Quem monta as rotas troca a leitura (a demonstração usa a do módulo Avaliações); null volta para a do servidor. */
export function setReviewsReader(fn: ReviewsReader | null) {
  reader = fn ?? serverReader;
}

/** Quantas aparecem no perfil; as outras ficam em /avaliacoes/:slug. */
export const HIGHLIGHTS = 3;

export function pickHighlights(list: ReviewPublicList, n = HIGHLIGHTS) {
  return [...list.reviews]
    .filter((r) => !!r.body?.trim())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, n);
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Lista pública das avaliações do negócio; null enquanto carrega, se falhou ou se não há. */
export function useReviewList(slug: string): ReviewPublicList | null {
  const [data, setData] = useState<{ slug: string; list: ReviewPublicList | null } | null>(null);
  useEffect(() => {
    let alive = true;
    reader(slug).then((list) => alive && setData({ slug, list }), () => alive && setData({ slug, list: null }));
    return () => {
      alive = false;
    };
  }, [slug]);
  return data?.slug === slug ? data.list : null;
}

export function ReviewHighlights({ slug, list }: { slug: string; list: ReviewPublicList | null }) {
  if (!list || list.summary.reviews_count === 0) return null;
  const top = pickHighlights(list);
  const { reviews_count: count, rating_average: avg } = list.summary;
  return (
    <section className="tn-net-highlights" aria-labelledby="perfil-avaliacoes">
      <h2 id="perfil-avaliacoes">O que os clientes dizem</h2>
      {avg != null ? (
        <p className="tn-net-highlights__avg">
          <span aria-hidden="true">{stars(Math.round(avg))}</span>{" "}
          <span className="tn-num">{avg.toFixed(1).replace(".", ",")}</span> de 5 · {count === 1 ? "1 avaliação" : `${count} avaliações`}
        </p>
      ) : null}
      {top.length ? (
        <ul className="tn-net-highlights__list">
          {top.map((r) => (
            <li key={r.id}>
              <p className="tn-net-highlights__stars" aria-label={`${r.rating} de 5 estrelas`}>{stars(r.rating)}</p>
              <blockquote>{r.body}</blockquote>
              <p className="tn-muted">
                {r.service_name} · {formatMonth(r.service_month)} · atendimento verificado
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        <Link className="tn-net-highlights__all" to={`/avaliacoes/${slug}`}>
          {count === 1 ? "Ver a avaliação" : `Ver as ${count} avaliações`}
        </Link>
      </p>
    </section>
  );
}

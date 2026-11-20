// Pedaços de leitura das avaliações, sem sessão nem porta: usados pelo painel do dono, pela página do cliente e pela
// lista pública (pacote público).
import { plural } from "../../lib/text/plural.ts";
import { formatMonth } from "../../lib/time.ts";
import type { ReviewPublicList } from "./port.ts";

/** "2026-10" → "outubro de 2026". */
const monthLabel = formatMonth;
const stars = (n: number) => `${"★".repeat(n)}${"☆".repeat(5 - n)}`;

type Summary = ReviewPublicList["summary"];
const decimal = (n: number) => n.toFixed(1).replace(".", ",");

/** Resumo no topo (item 43): "4,7 ★ · 3 avaliações"; sem média antes de 3, diz quando ela aparece. */
export function ReviewSummary({ s, min = 3 }: { s: Summary; min?: number }) {
  if (s.reviews_count === 0) return <p className="tn-rev-summary">Nenhuma avaliação ainda</p>;
  const count = plural(s.reviews_count, "avaliação", "avaliações");
  return (
    <p className="tn-rev-summary">
      {s.rating_average != null ? (
        <>
          <span className="tn-num tn-rev-summary__avg" aria-label={`Média ${decimal(s.rating_average)} de 5`}>{decimal(s.rating_average)} ★</span> · {count}
        </>
      ) : (
        <>
          {count} <span className="tn-muted">· a média aparece a partir de {min}</span>
        </>
      )}
    </p>
  );
}

/** Selos como pílulas (item 43): só o que é verdade. Sem selo de "não verificado" nem de "não certificado". */
export function Badges({ s }: { s: Summary }) {
  if (!s.identity_verified && s.completed_bookings === 0 && s.reviews_count === 0) return null;
  return (
    <ul className="tn-rev-badges" aria-label="Selos">
      {s.identity_verified ? <li data-on="true">✓ Identidade verificada pela equipe</li> : null}
      {s.completed_bookings > 0 ? <li>{plural(s.completed_bookings, "atendimento concluído", "atendimentos concluídos")} na Tinindo</li> : null}
      {s.reviews_count > 0 ? <li>Avaliações só de clientes atendidos</li> : null}
    </ul>
  );
}

export function ReviewView({ r }: { r: ReviewPublicList["reviews"][number] }) {
  return (
    <>
      <p className="tn-rev-head"><span aria-label={`${r.rating} de 5`}>{stars(r.rating)}</span> <span className="tn-muted">· {r.service_name} · {monthLabel(r.service_month)} · cliente com atendimento verificado</span></p>
      {r.body ? <p className="tn-rev-body">{r.body}</p> : null}
      {r.reply ? <p className="tn-rev-reply"><strong>Resposta do profissional:</strong> {r.reply.body}</p> : null}
    </>
  );
}

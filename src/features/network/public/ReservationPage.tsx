// /reserva#t=… e /reserva/:slug#t=… — o cliente vê a reserva e avalia o atendimento pelo link, sem conta (D20).
// O token sai da barra de endereço na hora e só vai ao servidor no corpo de um POST. Abrir a página não muda nada.
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router";
import { Button, ConfirmAction, Field, StatusBanner, toast, whatsappHref } from "../../../components/ui/index.tsx";
import { ApiError } from "../../../lib/api/client.ts";
import { formatTime } from "../../../lib/time.ts";
import type { BookingView, LinkReview } from "../api.ts";
import { BookingFacts } from "../PublicProfileView.tsx";
import { PublicFrame, PublicMissing, PublicSkeleton, type PublicBusiness, usePublicBusiness } from "../public-kit.tsx";
import { newIdempotencyKey } from "./labels.ts";
import { usePublicNetworkApi } from "./anon.ts";
import "../network.css";

const KEY = "tinindo.reserva";

function takeToken(): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
  if (m?.[1]) {
    try {
      sessionStorage.setItem(KEY, m[1]);
    } catch {
      /* sem armazenamento: vale enquanto a página estiver aberta */
    }
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return m[1];
  }
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const STATUS: Record<string, string> = {
  confirmed: "Confirmado",
  completed: "Atendido",
  cancelled: "Cancelado",
  no_show: "Falta registrada",
  held: "Aguardando confirmação",
  expired: "Não confirmado",
};
const RATING_WORDS = ["Ruim", "Regular", "Bom", "Muito bom", "Excelente"] as const;

const dayText = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone }).format(new Date(iso));

function reviewError(e: unknown): string {
  if (e instanceof ApiError && e.field === "already_reviewed") return "Este atendimento já foi avaliado.";
  if (e instanceof ApiError && e.field === "window") return "O prazo para avaliar este atendimento já passou.";
  if (e instanceof ApiError && e.field === "booking_status") return "Dá para avaliar depois que o atendimento acontecer.";
  return "Não foi possível publicar agora. Tentar de novo é seguro.";
}

function ReviewForm({ token, business, onDone }: { token: string; business: string; onDone: (r: LinkReview) => void }) {
  const api = usePublicNetworkApi();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) {
      setProblem("Escolha de 1 a 5 estrelas.");
      return;
    }
    if (text.trim() && text.trim().length < 3) {
      setProblem("Escreva pelo menos 3 letras, ou deixe o comentário em branco.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onDone(await api.reviewByLink(token, rating, text.trim() || null, key));
      toast("Obrigado! Sua avaliação foi publicada sem o seu nome.");
    } catch (err) {
      setProblem(reviewError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="tn-stack" aria-label="Avaliar o atendimento" onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className="tn-net-stars">
        <legend>Nota</legend>
        <div className="tn-net-stars__row">
          {RATING_WORDS.map((word, i) => (
            <label key={word} data-on={i < rating || undefined}>
              <input type="radio" name="nota" value={i + 1} checked={rating === i + 1} onChange={() => { setRating(i + 1); setProblem(null); }} />
              <span aria-hidden="true">★</span>
              <span className="tn-visually-hidden">{i + 1} – {word}</span>
            </label>
          ))}
        </div>
        <p className="tn-muted" aria-hidden="true">{rating ? `${rating} · ${RATING_WORDS[rating - 1]}` : "Toque numa estrela"}</p>
      </fieldset>
      <Field as="textarea" label="Comentário (opcional)" hint="O que você contaria a um amigo?" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
      {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
      <p className="tn-muted">Seu nome não aparece. {business} pode responder.</p>
      <div className="tn-pub-cta">
        <Button type="submit" loading={busy} loadingText="Publicando…">Publicar avaliação</Button>
      </div>
    </form>
  );
}

export function ReservationPage() {
  const { slug } = useParams();
  const api = usePublicNetworkApi();
  const fromSlug = usePublicBusiness(slug);
  const [token] = useState(takeToken);
  const [view, setView] = useState<BookingView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">(token ? "loading" : "missing");
  const [review, setReview] = useState<LinkReview | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.bookingByLink(token).then(
      (v) => { if (alive) { setView(v); setReview(v.review.existing); setState("ready"); } },
      () => alive && setState("missing"),
    );
    return () => {
      alive = false;
    };
  }, [api, token]);

  const business: PublicBusiness | null | undefined = view
    ? { ...(fromSlug ?? {}), name: view.business.name, slug: view.business.slug ?? fromSlug?.slug ?? null, whatsapp_e164: view.business.whatsapp_e164 ?? fromSlug?.whatsapp_e164 ?? null }
    : fromSlug;

  if (state === "loading") {
    return <PublicFrame business={business}><PublicSkeleton /></PublicFrame>;
  }
  if (state === "missing" || !view || !token) {
    return (
      <PublicFrame business={business}>
        <PublicMissing title="Não encontramos esta reserva" business={business} what="o link da minha reserva">
          <p>O link pode estar incompleto ou ter sido copiado pela metade. Peça o link de novo a quem te atendeu.</p>
        </PublicMissing>
      </PublicFrame>
    );
  }

  const name = view.business.name;
  return (
    <PublicFrame business={business}>
      <h1 id="reserva-titulo">Sua reserva</h1>
      <section aria-labelledby="reserva-titulo" className="tn-stack">
        <dl className="tn-pub-facts">
          <div><dt>Serviço</dt><dd>{view.service_name}</dd></div>
          <div>
            <dt>Quando</dt>
            <dd>{dayText(view.slot.starts_at, view.timezone)}, <span className="tn-num">{formatTime(view.slot.starts_at, view.timezone)}</span></dd>
          </div>
          <div><dt>Situação</dt><dd>{STATUS[view.status] ?? view.status}</dd></div>
        </dl>
        <BookingFacts price={view.price_cents} place={view.place} policy={view.policy} duration={null} />
        {view.business.whatsapp_e164 ? (
          <div className="tn-pub-cta" data-inline>
            <a className="tn-button" data-variant="secondary" target="_blank" rel="noopener noreferrer"
              href={whatsappHref(view.business.whatsapp_e164, `Olá! Sobre o meu horário de ${view.service_name} em ${dayText(view.slot.starts_at, view.timezone)}.`)}>
              Falar com {name} no WhatsApp
            </a>
          </div>
        ) : null}
        <p className="tn-muted">Para remarcar ou cancelar, fale com {name}. Abrir esta página não muda nada na reserva.</p>
      </section>

      <section aria-labelledby="avaliar-titulo" className="tn-stack">
        <h2 id="avaliar-titulo">{review ? "Sua avaliação" : `Como foi seu ${view.service_name}?`}</h2>
        {review ? (
          <>
            <p>
              <span className="tn-net-stars__show" aria-label={`${review.rating} de 5 estrelas`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
              {review.body ? <> · {review.body}</> : null}
            </p>
            <p className="tn-muted">
              {review.status === "published" ? "Publicada sem o seu nome." : review.status === "withdrawn" ? "Você retirou esta avaliação." : "Oculta pela moderação."}
            </p>
            {review.status === "published" ? (
              <ConfirmAction
                trigger="Retirar avaliação"
                title="Retirar sua avaliação?"
                consequence={<p>Ela sai da página de {name} e este atendimento não pode ser avaliado de novo.</p>}
                confirmLabel="Sim, retirar"
                onConfirm={() =>
                  api.withdrawByLink(token, newIdempotencyKey()).then(
                    (r) => { setReview(r); toast("Avaliação retirada."); },
                    () => toast({ tone: "danger", message: "Não foi possível retirar agora. Tente de novo." }),
                  )
                }
              />
            ) : null}
          </>
        ) : view.review.can_review ? (
          <ReviewForm token={token} business={name} onDone={setReview} />
        ) : view.status === "completed" ? (
          <p className="tn-muted">O prazo de {view.review.window_days} dias para avaliar este atendimento já passou.</p>
        ) : (
          <p className="tn-muted">Depois do atendimento, abra este mesmo link para contar como foi.</p>
        )}
      </section>
    </PublicFrame>
  );
}

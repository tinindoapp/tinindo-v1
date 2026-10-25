// Avaliações (P24): painel do dono (responder, denunciar), página do cliente para avaliar atendimentos concluídos e lista
// pública do perfil. Selos separados: identidade verificada, atendimentos verificados, competência certificada (ainda não).
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Card, Help, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { useSession } from "../../app/session.tsx";
import { type CustomerReviewsPort, newKey, type OwnerReviewsPort, type PublicReviewsPort, type ReviewOwnerList, type ReviewPending, type ReviewPublicList } from "./port.ts";

const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (ym: string) => MONTH.format(new Date(`${ym}-15T12:00:00Z`));
// Data do atendimento no fuso do piloto (o pendente não traz o fuso do negócio).
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const stars = (n: number) => `${"★".repeat(n)}${"☆".repeat(5 - n)}`;

function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  if (e?.code === "POLICY_REJECTED") return e.field === "already_reviewed" ? "Este atendimento já foi avaliado." : e.field === "window" ? "O prazo de 30 dias para avaliar acabou." : "As regras não permitem esta ação.";
  if (e?.code === "STALE_VERSION") return "Isto mudou em outro lugar. Atualizamos a tela: tente de novo.";
  if (e?.code === "NOT_FOUND") return "Não encontrado.";
  if (e?.code === "AUTH_REQUIRED") return "Entre na sua conta para avaliar.";
  return "Não deu certo agora. Nada foi alterado; tente de novo.";
}

export function Badges({ s }: { s: ReviewPublicList["summary"] }) {
  return (
    <ul className="tn-rev-badges" aria-label="Selos">
      <li data-on={s.identity_verified || undefined}>{s.identity_verified ? "Identidade verificada pela equipe" : "Identidade não verificada"}</li>
      <li>{s.completed_bookings} atendimento(s) concluído(s) na Tinindo</li>
      <li>{s.reviews_count} avaliação(ões) de clientes atendidos{s.rating_average != null ? ` · média ${s.rating_average.toFixed(1).replace(".", ",")}` : " · média só a partir de 3"}</li>
      <li>Competência certificada: não (ainda não existe certificação na Tinindo)</li>
    </ul>
  );
}

function ReviewView({ r }: { r: ReviewPublicList["reviews"][number] }) {
  return (
    <>
      <p className="tn-rev-head"><span aria-label={`${r.rating} de 5`}>{stars(r.rating)}</span> <span className="tn-rev-muted">· {r.service_name} · {monthLabel(r.service_month)} · cliente com atendimento verificado</span></p>
      {r.body ? <p className="tn-rev-body">{r.body}</p> : null}
      {r.reply ? <p className="tn-rev-reply"><strong>Resposta do profissional:</strong> {r.reply.body}</p> : null}
    </>
  );
}

function OwnerItem({ r, port, onDone }: { r: ReviewOwnerList["reviews"][number]; port: OwnerReviewsPort; onDone: (t: string, ok: boolean) => void }) {
  const [text, setText] = useState(r.reply?.body ?? "");
  const [open, setOpen] = useState(false);
  return (
    <li className="tn-rev-item">
      <ReviewView r={r} />
      {r.status === "hidden" ? <StatusBanner tone="warning">Oculta pela moderação: {r.hidden_reason}</StatusBanner> : null}
      {r.open_reports ? <p className="tn-rev-muted">Denúncia em análise pela moderação.</p> : null}
      <div className="tn-rev-actions">
        {!open ? <Button variant="secondary" onClick={() => setOpen(true)}>{r.reply ? "Editar resposta" : "Responder"}</Button> : null}
        {r.status === "published" && !r.open_reports ? (
          <Button variant="ghost" onClick={() => void port.report(r.id, "offensive", newKey()).then(() => onDone("Denúncia enviada. A avaliação continua visível até a moderação decidir.", true), (e: unknown) => onDone(explain(e), false))}>
            Denunciar
          </Button>
        ) : null}
      </div>
      {open ? (
        <form className="tn-rev-form" aria-label="Responder avaliação" onSubmit={(e) => {
          e.preventDefault();
          void port.reply(r.id, r.version, text, newKey()).then(() => onDone("Resposta publicada.", true), (err: unknown) => onDone(explain(err), false));
        }}>
          <label className="tn-field"><span>Sua resposta (pública)</span><textarea value={text} maxLength={600} onChange={(e) => setText(e.target.value)} /></label>
          <div className="tn-rev-actions">
            <Button type="submit" disabled={text.trim().length < 2}>Publicar resposta</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

export function OwnerReviewsPage({ port }: { port: OwnerReviewsPort }) {
  const [data, setData] = useState<ReviewOwnerList | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    port.list().then((d) => alive && setData(d), (e: unknown) => alive && setNotice({ tone: "danger", text: explain(e) }));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (text: string, ok: boolean) => {
    setNotice({ tone: ok ? "success" : "danger", text });
    setNonce((n) => n + 1);
  };
  return (
    <div className="tn-rev">
      <PageHeader id="rev-title" title="Avaliações" subtitle="Só clientes com atendimento concluído e vínculo verificado avaliam. Você responde; ninguém apaga." />
      <Help><p>Cada avaliação vem de um atendimento concluído de um cliente que entrou na Tinindo com o código do seu negócio, em até 30 dias. Você pode responder publicamente e denunciar o que for ofensivo ou trouxer dados pessoais; quem decide é a moderação. Não há como pagar por avaliação, e a média só aparece a partir de 3.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Avaliações de exemplo.</StatusBanner> : null}
      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
      {data ? (
        <>
          <Card aria-labelledby="rev-badges-title"><h2 id="rev-badges-title">Selos do seu perfil</h2><Badges s={data.summary} /></Card>
          <Card aria-labelledby="rev-list-title">
            <h2 id="rev-list-title">Recebidas</h2>
            {data.reviews.length === 0 ? <p className="tn-rev-muted">Nenhuma avaliação ainda.</p> : null}
            <ul className="tn-rev-list" aria-label="Avaliações recebidas">{data.reviews.map((r) => <OwnerItem key={`${r.id}:${r.version}:${r.open_reports}`} r={r} port={port} onDone={done} />)}</ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Página do cliente (/avaliar): atendimentos concluídos e vinculados, avaliáveis por 30 dias. */
export function CustomerReviewPage({ port }: { port: CustomerReviewsPort }) {
  const { state } = useSession();
  const [data, setData] = useState<ReviewPending | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [rating, setRating] = useState<Record<string, number>>({});
  const [text, setText] = useState<Record<string, string>>({});
  const signedOut = state.status === "signed_out";
  useEffect(() => {
    if (signedOut) return;
    let alive = true;
    port.pending().then((d) => alive && setData(d), (e: unknown) => alive && setNotice({ tone: "danger", text: explain(e) }));
    return () => { alive = false; };
  }, [port, nonce, signedOut]);
  return (
    <main className="tn-rev-page">
      <h1>Avaliar atendimentos</h1>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Você vê como a Cliente Exemplo Ana: aparecem os exemplos e os atendimentos dela concluídos na Agenda desta aba. Nada é publicado fora da aba.</StatusBanner> : null}
      {signedOut ? <p><Link to="/entrar">Entre na sua conta</Link> para avaliar os atendimentos que você fez.</p> : null}
      {!signedOut ? <p><Link to="/app/conta/reservas">Minhas reservas</Link></p> : null}
      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
      {data ? (
        <>
          <p className="tn-rev-muted">Aparecem só atendimentos concluídos nos negócios em que você tem vínculo, até {data.rules.window_days} dias depois. Seu nome não aparece na avaliação.</p>
          {data.pending.length === 0 ? <p>Nada para avaliar agora.</p> : null}
          <ul className="tn-rev-list" aria-label="Para avaliar">
            {data.pending.map((p) => (
              <li key={p.booking_id} className="tn-rev-item">
                <form aria-label={`Avaliar ${p.service_name} em ${p.tenant_name}, ${DAY.format(new Date(p.ended_at))}`} className="tn-rev-form" onSubmit={(e) => {
                  e.preventDefault();
                  void port.submit(p.booking_id, rating[p.booking_id] ?? 0, text[p.booking_id]?.trim() || null, newKey())
                    .then(() => { setNotice({ tone: "success", text: "Obrigado! Sua avaliação foi publicada sem o seu nome." }); setNonce((n) => n + 1); },
                      (err: unknown) => setNotice({ tone: "danger", text: explain(err) }));
                }}>
                  <p><strong>{p.service_name}</strong> · {p.tenant_name} · <span className="tn-num">{DAY.format(new Date(p.ended_at))}</span></p>
                  <fieldset className="tn-rev-stars">
                    <legend>Nota</legend>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n}><input type="radio" name={`r-${p.booking_id}`} checked={rating[p.booking_id] === n} onChange={() => setRating({ ...rating, [p.booking_id]: n })} /> {n}</label>
                    ))}
                  </fieldset>
                  <label className="tn-field"><span>Comentário (opcional)</span><textarea value={text[p.booking_id] ?? ""} maxLength={600} onChange={(e) => setText({ ...text, [p.booking_id]: e.target.value })} /></label>
                  <div><Button type="submit" disabled={!rating[p.booking_id]}>Publicar avaliação</Button></div>
                </form>
              </li>
            ))}
          </ul>
          {data.mine.length ? (
            <section aria-labelledby="rev-mine">
              <h2 id="rev-mine">Suas avaliações</h2>
              <ul className="tn-rev-list" aria-label="Suas avaliações">
                {data.mine.map((r) => (
                  <li key={r.id} className="tn-rev-item">
                    <ReviewView r={r} />
                    <p className="tn-rev-muted">{r.tenant_name} · {r.status === "published" ? "publicada" : r.status === "hidden" ? "oculta pela moderação" : "retirada por você"}</p>
                    {r.status === "published" ? <Button variant="ghost" onClick={() => void port.withdraw(r.id, newKey()).then(() => setNonce((n) => n + 1))}>Retirar avaliação</Button> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

/** Lista pública (/avaliacoes/:slug). */
export function PublicReviewsPage({ port }: { port: PublicReviewsPort }) {
  const { slug = "" } = useParams();
  const [data, setData] = useState<{ slug: string; list: ReviewPublicList | null } | null>(null);
  useEffect(() => {
    let alive = true;
    port.list(slug).then((l) => alive && setData({ slug, list: l }), () => alive && setData({ slug, list: null }));
    return () => { alive = false; };
  }, [port, slug]);
  const cur = data?.slug === slug ? data : null;
  return (
    <main className="tn-rev-page">
      <h1>Avaliações</h1>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Avaliações de exemplo.</StatusBanner> : null}
      {!cur ? <p role="status">Carregando…</p> : null}
      {cur && !cur.list ? <p>Perfil não encontrado.</p> : null}
      {cur?.list ? (
        <>
          <Badges s={cur.list.summary} />
          <ul className="tn-rev-list" aria-label="Avaliações publicadas">{cur.list.reviews.map((r) => <li key={r.id} className="tn-rev-item"><ReviewView r={r} /></li>)}</ul>
          <p><Link to={`/p/${slug}`}>Voltar ao perfil</Link></p>
        </>
      ) : null}
    </main>
  );
}

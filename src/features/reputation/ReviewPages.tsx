// Avaliações (P24): painel do dono (responder, denunciar), página do cliente para avaliar atendimentos concluídos e lista
// pública do perfil. Selos separados: identidade verificada, atendimentos verificados, competência certificada (ainda não).
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ActionsMenu, Button, Card, ConfirmAction, Field, Help, PageHeader, Segmented, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { useSession } from "../../app/session.tsx";
import { type CustomerReviewsPort, newKey, type OwnerReviewsPort, type PublicReviewsPort, type ReportReason, type ReviewOwnerList, type ReviewPending, type ReviewPublicList } from "./port.ts";
import { plural } from "../../lib/text/plural.ts";

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

function ReviewView({ r }: { r: ReviewPublicList["reviews"][number] }) {
  return (
    <>
      <p className="tn-rev-head"><span aria-label={`${r.rating} de 5`}>{stars(r.rating)}</span> <span className="tn-muted">· {r.service_name} · {monthLabel(r.service_month)} · cliente com atendimento verificado</span></p>
      {r.body ? <p className="tn-rev-body">{r.body}</p> : null}
      {r.reply ? <p className="tn-rev-reply"><strong>Resposta do profissional:</strong> {r.reply.body}</p> : null}
    </>
  );
}

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "offensive", label: "Ofensiva ou com xingamento" },
  { value: "personal_data", label: "Expõe dados pessoais" },
  { value: "not_a_customer", label: "Não foi atendimento meu" },
  { value: "conflict_of_interest", label: "Conflito de interesse (concorrente, parente)" },
  { value: "other", label: "Outro motivo" },
];

/** Inícios rápidos da resposta (item 44): tom conforme a nota; o profissional completa. */
const quickStarts = (rating: number) =>
  rating >= 4
    ? ["Obrigado pela avaliação! ", "Que bom que você gostou! ", "Foi um prazer atender você. "]
    : ["Obrigado pelo retorno. ", "Sinto muito que não foi como você esperava. ", "Quero entender melhor o que aconteceu. "];

const REPLY_MAX = 600;

function OwnerItem({ r, port, onDone }: { r: ReviewOwnerList["reviews"][number]; port: OwnerReviewsPort; onDone: (message: string) => void }) {
  const [text, setText] = useState(r.reply?.body ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { formRef, errors, show, clear } = useFormErrors<"text">();
  const replyButton = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const reportTitle = useRef<HTMLParagraphElement>(null);
  const reportOpener = useRef<HTMLElement | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const label = `a avaliação de ${plural(r.rating, "estrela")} sobre ${r.service_name}`;

  // Abriu "Responder": o foco vai direto para o campo.
  useEffect(() => {
    if (open) field.current?.querySelector("textarea")?.focus();
  }, [open]);
  useEffect(() => {
    if (reporting) reportTitle.current?.focus();
  }, [reporting]);

  function closeReply() {
    setOpen(false);
    clear();
    queueMicrotask(() => replyButton.current?.focus());
  }
  function closeReport() {
    setReporting(false);
    setReason("");
    setReasonError(null);
    const back = reportOpener.current;
    queueMicrotask(() => back?.focus());
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ text: text.trim().length < 2 && "Escreva a resposta (pelo menos 2 caracteres)." })) return;
    setBusy(true);
    setFailure(null);
    try {
      await port.reply(r.id, r.version, text, newKey());
      onDone("Resposta publicada.");
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  async function report() {
    if (!reason) {
      setReasonError("Escolha o motivo da denúncia.");
      document.getElementById(`rev-reason-${r.id}`)?.focus();
      return;
    }
    setReportBusy(true);
    try {
      await port.report(r.id, reason, newKey());
      onDone("Denúncia enviada. A avaliação continua visível até a moderação decidir.");
    } catch (e) {
      toast({ tone: "danger", message: explain(e) });
    } finally {
      setReportBusy(false);
    }
  }
  const canReport = r.status === "published" && !r.open_reports;
  return (
    <li className="tn-rev-item">
      <ReviewView r={r} />
      {r.status === "hidden" ? <StatusBanner tone="warning">Oculta pela moderação: {r.hidden_reason}</StatusBanner> : null}
      {r.open_reports ? <p className="tn-muted">Denúncia em análise pela moderação.</p> : null}
      <div className="tn-actions tn-rev-item__actions">
        {!open ? (
          <Button ref={replyButton} variant="secondary" onClick={() => setOpen(true)}>
            {r.reply ? "Editar resposta" : "Responder"}
          </Button>
        ) : null}
        {/* Denunciar fica no "⋯" (item 44): não tem o mesmo peso de responder. */}
        {canReport ? (
          <ActionsMenu
            label={`Mais ações para ${label}`}
            actions={[{ label: "Denunciar…", tone: "danger", onSelect: () => { reportOpener.current = document.activeElement as HTMLElement | null; setReporting(true); } }]}
          />
        ) : null}
      </div>
      {reporting ? (
        // Denúncia não tem como ser retirada no port: confirma com o motivo, dizendo o que acontece.
        <div className="tn-confirm" role="group" aria-labelledby={`rev-report-${r.id}`}>
          <p id={`rev-report-${r.id}`} ref={reportTitle} tabIndex={-1} className="tn-confirm__title">Denunciar esta avaliação?</p>
          <div className="tn-confirm__body"><p>A moderação analisa e decide se oculta. Até lá ela continua visível, e a denúncia não pode ser retirada.</p></div>
          <Field as="select" id={`rev-reason-${r.id}`} label="Motivo" value={reason} error={reasonError} onChange={(e) => { setReason(e.target.value as ReportReason | ""); setReasonError(null); }}>
            <option value="">Escolha o motivo</option>
            {REPORT_REASONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Field>
          <div className="tn-actions">
            <Button variant="danger" loading={reportBusy} onClick={() => void report()}>Sim, denunciar</Button>
            <Button variant="ghost" disabled={reportBusy} onClick={closeReport}>Voltar</Button>
          </div>
        </div>
      ) : null}
      {open ? (
        <form ref={formRef} className="tn-stack" data-gap="sm" aria-label="Responder avaliação" onSubmit={(e) => void submit(e)} noValidate>
          <div className="tn-actions" role="group" aria-label="Começar com">
            {quickStarts(r.rating).map((q) => (
              <Button key={q} variant="secondary" onClick={() => { setText((t) => (t.startsWith(q) ? t : (q + t).slice(0, REPLY_MAX))); clear("text"); field.current?.querySelector("textarea")?.focus(); }}>
                {q.trim()}
              </Button>
            ))}
          </div>
          <div ref={field}>
            <Field
              as="textarea"
              label="Sua resposta (pública)"
              hint={<span className="tn-num">{text.length}/{REPLY_MAX}</span>}
              rows={3}
              value={text}
              maxLength={REPLY_MAX}
              error={errors.text}
              onChange={(e) => { setText(e.target.value); clear("text"); }}
            />
          </div>
          {text.trim() ? (
            <section className="tn-rev-preview" aria-label="Prévia pública">
              <p className="tn-muted">Como aparece no seu perfil, embaixo da avaliação:</p>
              <p className="tn-rev-reply"><strong>Resposta do profissional:</strong> {text.trim()}</p>
            </section>
          ) : null}
          {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
          <div className="tn-actions">
            <Button type="submit" loading={busy} loadingText="Publicando…">Publicar resposta</Button>
            <Button variant="ghost" onClick={closeReply}>Cancelar</Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

export function OwnerReviewsPage({ port }: { port: OwnerReviewsPort }) {
  const [data, setData] = useState<ReviewOwnerList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    port.list().then((d) => { if (alive) { setData(d); setLoadError(null); } }, (e: unknown) => alive && setLoadError(explain(e)));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (message: string) => {
    toast(message);
    setNonce((n) => n + 1);
  };
  return (
    <div className="tn-stack tn-rev">
      <PageHeader id="rev-title" title="Avaliações" subtitle="Só clientes com atendimento concluído e vínculo verificado avaliam. Você responde; ninguém apaga." />
      <Help><p>Cada avaliação vem de um atendimento concluído de um cliente que entrou na Tinindo com o código do seu negócio, em até 30 dias. Você pode responder publicamente e denunciar o que for ofensivo ou trouxer dados pessoais; quem decide é a moderação. Não há como pagar por avaliação, e a média só aparece a partir de 3.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Avaliações de exemplo.</StatusBanner> : null}
      {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
      {data ? (
        <>
          <Card aria-labelledby="rev-badges-title">
            <div className="tn-stack" data-gap="sm">
              <h2 id="rev-badges-title">Seu perfil</h2>
              <ReviewSummary s={data.summary} min={data.rules.min_reviews_for_average} />
              <Badges s={data.summary} />
              {/* Sem verificação: vira uma tarefa, não um selo negativo. */}
              {!data.summary.identity_verified ? (
                <details className="tn-rev-task">
                  <summary>
                    Verifique sua identidade
                    <Icon name="seta" size={18} />
                  </summary>
                  <p>
                    A equipe da Tinindo confere a identidade de quem atende por videochamada com documento ou pelo gov.br.
                    Depois disso, o selo “Identidade verificada pela equipe” aparece no seu perfil. Nenhum documento fica
                    guardado. Para pedir a verificação, fale com a equipe da Tinindo.
                  </p>
                </details>
              ) : null}
            </div>
          </Card>
          <Card aria-labelledby="rev-list-title">
            <h2 id="rev-list-title">Recebidas</h2>
            {data.reviews.length === 0 ? <p className="tn-muted">Nenhuma avaliação ainda.</p> : null}
            <ul className="tn-rev-list" aria-label="Avaliações recebidas">{data.reviews.map((r) => <OwnerItem key={`${r.id}:${r.version}:${r.open_reports}`} r={r} port={port} onDone={done} />)}</ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Nota de 1 a 5: o número aparece no botão; o leitor de tela ouve "1 – Ruim" … "5 – Excelente". */
const RATING_WORDS = ["Ruim", "Regular", "Bom", "Muito bom", "Excelente"] as const;

type PendingRow = ReviewPending["pending"][number];

function PendingItem({ p, port, target, lock, onDone }: {
  p: PendingRow;
  port: CustomerReviewsPort;
  target: string | null;
  /** Uma publicação por vez na página: o clique duplo não manda a segunda (voltaria "já avaliado" por cima do sucesso). */
  lock: { take: () => boolean; release: () => void };
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const label = `Avaliar ${p.service_name} em ${p.tenant_name}, ${DAY.format(new Date(p.ended_at))}`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) {
      // Botão sempre ativo: sem nota, explica embaixo da nota e leva o foco até a primeira opção.
      setRatingError("Escolha uma nota de 1 a 5.");
      formRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();
      return;
    }
    if (!lock.take()) return;
    setBusy(true);
    setFailure(null);
    try {
      await port.submit(p.booking_id, rating, text.trim() || null, newKey());
      toast("Obrigado! Sua avaliação foi publicada sem o seu nome.");
      onDone();
    } catch (err) {
      setFailure(explain(err));
    } finally {
      lock.release();
      setBusy(false);
    }
  }
  return (
    <li id={`avaliar-${p.booking_id}`} className="tn-rev-item" data-target={p.booking_id === target ? "true" : undefined}>
      <form ref={formRef} aria-label={label} className="tn-stack" data-gap="sm" onSubmit={(e) => void submit(e)} noValidate>
        <p><strong>{p.service_name}</strong> · {p.tenant_name} · <span className="tn-num">{DAY.format(new Date(p.ended_at))}</span></p>
        <div className="tn-field tn-rev-rating" data-invalid={ratingError ? true : undefined}>
          <Segmented
            label="Nota"
            name={`r-${p.booking_id}`}
            value={rating ? String(rating) : ""}
            onChange={(v) => { setRating(Number(v)); setRatingError(null); }}
            options={RATING_WORDS.map((word, i) => ({
              value: String(i + 1),
              label: (
                <>
                  <span aria-hidden="true" className="tn-num">{i + 1}</span>
                  <span className="tn-visually-hidden">{i + 1} – {word}</span>
                </>
              ),
            }))}
          />
          <span className="tn-field__hint" aria-hidden="true">{rating ? `${rating} – ${RATING_WORDS[rating - 1]}` : "1 = Ruim · 5 = Excelente"}</span>
          {ratingError ? <span className="tn-field__error" role="alert">{ratingError}</span> : null}
        </div>
        <Field as="textarea" label="Comentário (opcional)" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
        {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
        <div><Button type="submit" loading={busy} loadingText="Publicando…">Publicar avaliação</Button></div>
      </form>
    </li>
  );
}

/** Página do cliente (/avaliar): atendimentos concluídos e vinculados, avaliáveis por 30 dias. */
export function CustomerReviewPage({ port }: { port: CustomerReviewsPort }) {
  const { state } = useSession();
  const [data, setData] = useState<ReviewPending | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const sending = useRef(false);
  const lock = useMemo(() => ({
    take: () => (sending.current ? false : (sending.current = true)),
    release: () => { sending.current = false; },
  }), []);
  const signedOut = state.status === "signed_out";
  const reload = () => setNonce((n) => n + 1);
  // Vindo de "Minhas reservas" (?atendimento=id): leva ao formulário daquele atendimento.
  const target = useSearchParams()[0].get("atendimento");
  const targetPending = target ? data?.pending.some((p) => p.booking_id === target) : undefined;
  useEffect(() => {
    if (!targetPending) return;
    const el = document.getElementById(`avaliar-${target}`);
    el?.scrollIntoView({ block: "center" });
    el?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();
  }, [target, targetPending]);
  useEffect(() => {
    if (signedOut) return;
    let alive = true;
    port.pending().then((d) => { if (alive) { setData(d); setLoadError(null); } }, (e: unknown) => alive && setLoadError(explain(e)));
    return () => { alive = false; };
  }, [port, nonce, signedOut]);
  return (
    <main className="tn-rev-page">
      <h1>Avaliar atendimentos</h1>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Você vê como a Cliente Exemplo Ana: aparecem os exemplos e os atendimentos dela concluídos na Agenda desta aba. Nada é publicado fora da aba.</StatusBanner> : null}
      {signedOut ? <p><Link to="/entrar">Entre na sua conta</Link> para avaliar os atendimentos que você fez.</p> : null}
      {!signedOut ? <p><Link to="/app/conta/reservas">Minhas reservas</Link></p> : null}
      {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
      {data && target && targetPending === false && !loadError ? (
        <StatusBanner tone="info">Esse atendimento não está mais para avaliar: já foi avaliado ou passou o prazo de {data.rules.window_days} dias.</StatusBanner>
      ) : null}
      {data ? (
        <>
          <p className="tn-muted">Aparecem só atendimentos concluídos nos negócios em que você tem vínculo, até {data.rules.window_days} dias depois. Seu nome não aparece na avaliação.</p>
          {data.pending.length === 0 ? <p>Nada para avaliar agora.</p> : null}
          <ul className="tn-rev-list" aria-label="Para avaliar">
            {data.pending.map((p) => <PendingItem key={p.booking_id} p={p} port={port} target={target} lock={lock} onDone={reload} />)}
          </ul>
          {data.mine.length ? (
            <section aria-labelledby="rev-mine">
              <h2 id="rev-mine">Suas avaliações</h2>
              <ul className="tn-rev-list" aria-label="Suas avaliações">
                {data.mine.map((r) => (
                  <li key={r.id} className="tn-rev-item">
                    <ReviewView r={r} />
                    <p className="tn-muted">{r.tenant_name} · {r.status === "published" ? "publicada" : r.status === "hidden" ? "oculta pela moderação" : "retirada por você"}</p>
                    {/* Retirar é definitivo no servidor (o atendimento não volta a ser avaliável): confirma antes. */}
                    {r.status === "published" ? (
                      <ConfirmAction
                        trigger="Retirar avaliação"
                        triggerLabel={`Retirar avaliação de ${r.service_name} em ${r.tenant_name}`}
                        title="Retirar sua avaliação?"
                        consequence={<p>Ela sai do perfil de {r.tenant_name} e este atendimento não pode ser avaliado de novo.</p>}
                        confirmLabel="Sim, retirar"
                        onConfirm={() =>
                          port.withdraw(r.id, newKey()).then(
                            () => { toast("Avaliação retirada."); reload(); },
                            (e: unknown) => toast({ tone: "danger", message: explain(e) }),
                          )
                        }
                      />
                    ) : null}
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
          <ReviewSummary s={cur.list.summary} min={cur.list.rules.min_reviews_for_average} />
          <Badges s={cur.list.summary} />
          <ul className="tn-rev-list" aria-label="Avaliações publicadas">{cur.list.reviews.map((r) => <li key={r.id} className="tn-rev-item"><ReviewView r={r} /></li>)}</ul>
          <p><Link to={`/p/${slug}`}>Voltar ao perfil</Link></p>
        </>
      ) : null}
    </main>
  );
}

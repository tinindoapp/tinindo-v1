// Lista de espera (P06), visão do dono. Uma pessoa de cada vez por horário; o dono aprova cada oferta.
// A Tinindo não envia mensagens: o dono compartilha o link, e compartilhar não confirma entrega.
import { createContext, type FormEvent, useContext, useEffect, useRef, useState } from "react";
import type { TimeRange, WaitlistEntry, WaitlistOffer } from "@contracts";
import { Button, CappedList, Card, ChipGroup, Field, FormPanel, PageHeader, Section, ShareActions, StatusBadge, StatusBanner, toast, useFormErrors, WEEKDAY_CHIPS, WEEKDAY_SHORTCUTS, type BadgeTone } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { InlineConfirm, Row } from "./rows.tsx";
import { endOfLocalDay, entriesForStart, formatDateTime, formatSlot, formatStart, localDate, windowsText } from "./format.ts";
import type { WaitlistBase, WaitlistPort } from "./port.ts";
import { errorExplainer } from "../../lib/errors.ts";
import { useCommand, useIdempotencyKey } from "../../lib/idempotency.ts";

const PortContext = createContext<WaitlistPort | null>(null);
export const WaitlistPortProvider = PortContext.Provider;
const usePort = () => useContext(PortContext)!;

const OFFER_STATUS: Record<WaitlistOffer["status"], string> = {
  pending_approval: "Aguardando aprovação", offered: "Oferta aberta", accepted: "Aceita: reserva confirmada",
  declined: "Recusada", expired: "Vencida", invalidated: "Retirada",
};
const OFFER_TONE: Record<WaitlistOffer["status"], BadgeTone> = {
  pending_approval: "warning", offered: "info", accepted: "success", declined: "neutral", expired: "neutral", invalidated: "neutral",
};
const DELIVERY: Record<string, string> = {
  prepared: "Link pronto, ainda não compartilhado",
  share_opened: "Compartilhamento aberto (a entrega não é confirmada)",
};

const explain = errorExplainer({
  SLOT_CONFLICT: "Esse horário já está reservado ou em oferta para outra pessoa. Uma pessoa de cada vez.",
  "POLICY_REJECTED.customer_id": "Este cliente já está na lista para este serviço.",
  POLICY_REJECTED: "As regras não permitem esta ação agora (entrada, consentimento ou cotação mudou). Nada foi alterado.",
  VALIDATION_ERROR: "Confira os campos. Nada foi gravado.",
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a lista.",
});

export function offerLink(token: string): string {
  return `${window.location.origin}/oferta#t=${token}`;
}

/**
 * `vaga`: início (ISO) de um horário que acabou de ser liberado, vindo do atendimento cancelado
 * (`/app/lista-de-espera?vaga=…`). A vaga vai para o topo de "Vagas para oferecer", com o foco em "Preparar oferta";
 * se ninguém da lista aceita aquele horário, a tela diz isso com o horário escrito.
 */
export function WaitlistPage({ vaga = null }: { vaga?: string | null } = {}) {
  const port = usePort();
  const [base, setBase] = useState<WaitlistBase | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<WaitlistPort["list"]>> | null>(null);
  const [nonce, setNonce] = useState(0);
  const [fresh, setFresh] = useState<{ offerId: string; token: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [joining, setJoining] = useState(false);
  // Linha com a confirmação aberta embaixo ("offer:<id>" ou "entry:<id>").
  const [confirming, setConfirming] = useState<string | null>(null);
  const command = useCommand();

  useEffect(() => {
    let alive = true;
    port.base().then((b) => alive && setBase(b), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port]);
  useEffect(() => {
    let alive = true;
    port.list().then((d) => alive && setData(d), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const reload = () => setNonce((n) => n + 1);

  const tz = base?.timezone ?? "America/Sao_Paulo";
  const customer = (id: string) => base?.customers.find((c) => c.id === id)?.name ?? "Cliente";
  const service = (id: string) => base?.services.find((s) => s.id === id)?.name ?? "Serviço";
  const entryOf = (id: string) => data?.entries.find((e) => e.id === id);

  async function prepare(entry: WaitlistEntry, slot: TimeRange) {
    try {
      const o = await command({ prepare: entry.id, version: entry.version, slot }, (key) => port.prepareOffer(entry, slot, key));
      if (o.token) setFresh({ offerId: o.id, token: o.token });
      if (target !== null && Date.parse(slot.starts_at) === target) setTargetDone(customer(entry.customer_id));
      toast(`Oferta preparada para ${customer(entry.customer_id)}. O horário fica guardado para ela até ${formatDateTime(o.expires_at, tz)}.`);
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      reload();
    }
  }
  /** Ação de um toque numa linha: o retorno (sucesso ou erro) sai no aviso curto. */
  async function run(intent: unknown, send: (key: string) => Promise<void>, ok: string) {
    try {
      await command(intent, send);
      toast(ok);
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      reload();
    }
  }

  // Candidatos agrupados por horário: só o primeiro da fila recebe o botão (uma pessoa de cada vez).
  const bySlot = new Map<string, NonNullable<typeof data>["candidates"]>();
  for (const c of data?.candidates ?? []) bySlot.set(c.slot.starts_at, [...(bySlot.get(c.slot.starts_at) ?? []), c]);

  // Vaga que chegou pela URL: os candidatos do servidor para esse início ou, se ainda não foram gerados, quem da lista
  // aceita esse horário (mesma regra do servidor). A duração da vaga é a do serviço de quem está na vez.
  const target = vaga && !Number.isNaN(Date.parse(vaga)) ? Date.parse(vaga) : null;
  const [targetDone, setTargetDone] = useState<string | null>(null);
  const targetKey = target === null ? null : [...bySlot.keys()].find((k) => Date.parse(k) === target) ?? null;
  const highlight: { slot: TimeRange; queue: WaitlistEntry[] } | null = (() => {
    if (target === null || !data || !base) return null;
    if (targetKey) {
      const queue = bySlot.get(targetKey)!.map((c) => entryOf(c.entry_id)).filter((e): e is WaitlistEntry => !!e);
      return queue.length ? { slot: bySlot.get(targetKey)![0]!.slot, queue } : null;
    }
    const starts = new Date(target).toISOString();
    const queue = entriesForStart(data.entries, starts, tz);
    const first = queue[0];
    if (!first) return null;
    const minutes = base.services.find((x) => x.id === first.service_id)?.duration_min ?? 30;
    return { slot: { starts_at: starts, ends_at: new Date(target + minutes * 60_000).toISOString() }, queue };
  })();
  const others = [...bySlot.entries()].filter(([start]) => start !== targetKey);
  // Rola até a vaga e foca "Preparar oferta" (ou a frase de que ninguém aceita) uma vez, quando a lista chega.
  const targetRef = useRef<HTMLElement | null>(null);
  const focused = useRef(false);
  const ready = target !== null && !!data && !!base;
  useEffect(() => {
    if (!ready || focused.current || !targetRef.current) return;
    focused.current = true;
    targetRef.current.focus();
    if (typeof targetRef.current.scrollIntoView === "function") targetRef.current.scrollIntoView({ block: "center" });
  }, [ready]);

  const openOffers = data?.offers.some((o) => o.status === "offered" || o.status === "pending_approval") ?? false;
  const slotCount = others.length + (highlight && !targetDone ? 1 : 0);

  return (
    <section aria-labelledby="wl-title" className="tn-wl tn-stack">
      <PageHeader
        id="wl-title"
        title="Lista de espera"
        subtitle="Ofereça o horário que ficou livre a quem está esperando."
        // Uma ação principal: com a vaga que chegou pela URL, a principal é "Preparar oferta" e esta fica secundária.
        actions={base ? (
          <Button variant={highlight && !targetDone ? "secondary" : "primary"} aria-expanded={joining} onClick={() => setJoining(true)}>
            <Icon name="mais" size={20} />
            Adicionar à lista
          </Button>
        ) : null}
        help={
          <>
            <p>Quando um atendimento é cancelado, o horário aparece em “Vagas para oferecer” para o primeiro da fila que aceita aquele dia e hora. Uma pessoa de cada vez: o horário fica guardado para ela até a oferta vencer.</p>
            <p>A Tinindo não envia mensagens: você copia o link ou abre o WhatsApp e manda. Abrir o link não reserva; o cliente aceita ou recusa.</p>
          </>
        }
      />
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {fresh ? <ShareCard token={fresh.token} onShared={() => run({ shared: fresh.offerId }, (key) => port.markShared(fresh.offerId, key), "Compartilhamento registrado. A entrega não é confirmada pela Tinindo.")} onClose={() => setFresh(null)} /> : null}
      {joining && base ? (
        <FormPanel title="Adicionar à lista" onClose={() => setJoining(false)}>
          <JoinForm base={base} onCancel={() => setJoining(false)} onDone={(text) => { setJoining(false); toast(text); reload(); }} />
        </FormPanel>
      ) : null}
      {!base || !data ? (
        <p role="status">Carregando a lista…</p>
      ) : (
        <>
          <Section id="wl-slots-title" title="Vagas para oferecer" count={slotCount || undefined}>
            {target !== null ? (
              targetDone ? (
                <p className="tn-wl-target" data-state="done" role="status">
                  Oferta preparada para {targetDone} na vaga de {formatStart(new Date(target).toISOString(), tz)}. Veja em “Ofertas”.
                </p>
              ) : highlight ? (
                <div className="tn-wl-target" data-state="open">
                  <div>
                    <span className="tn-wl-target__tag">Vaga liberada agora</span>
                    <strong>{formatSlot(highlight.slot, tz)}</strong>
                    <div className="tn-muted">
                      Próximo da fila: {customer(highlight.queue[0]!.customer_id)} · {service(highlight.queue[0]!.service_id)}
                      {highlight.queue.length > 1 ? ` · depois: ${highlight.queue.length - 1}` : ""}
                    </div>
                  </div>
                  <Button ref={(el) => { targetRef.current = el; }} onClick={() => void prepare(highlight.queue[0]!, highlight.slot)}>
                    Preparar oferta<span className="tn-visually-hidden"> para {customer(highlight.queue[0]!.customer_id)}</span>
                  </Button>
                </div>
              ) : (
                <p ref={(el) => { targetRef.current = el; }} tabIndex={-1} className="tn-wl-target" data-state="none">
                  Ninguém da lista aceita {formatStart(new Date(target).toISOString(), tz)}. A vaga continua livre na agenda.
                </p>
              )
            ) : null}
            {others.length === 0 ? (
              target === null ? (
                <p className="tn-muted">Nenhuma vaga liberada que sirva a alguém da lista. Quando um atendimento for cancelado, ela aparece aqui.</p>
              ) : null
            ) : (
              <CappedList
                items={others}
                label={target !== null ? "Outras vagas" : "Vagas"}
                render={([start, list]) => {
                  const first = list[0]!;
                  const entry = entryOf(first.entry_id);
                  return (
                    <Row
                      key={start}
                      title={formatSlot(first.slot, tz)}
                      meta={
                        <>
                          Próximo da fila: {entry ? `${customer(entry.customer_id)} · ${service(entry.service_id)}` : "—"}
                          {list.length > 1 ? ` · depois: ${list.length - 1}` : ""}
                        </>
                      }
                      action={entry ? (
                        <Button size="compact" variant="secondary" onClick={() => void prepare(entry, first.slot)}>
                          Preparar oferta<span className="tn-visually-hidden"> para {customer(entry.customer_id)}</span>
                        </Button>
                      ) : undefined}
                    />
                  );
                }}
              />
            )}
          </Section>

          {/* Histórico de ofertas: secundário. Nasce recolhido quando não há oferta em aberto. */}
          <Section id="wl-offers-title" title="Ofertas" count={data.offers.length} collapsed={!openOffers}>
            {data.offers.length === 0 ? (
              <p className="tn-muted">Nenhuma oferta feita.</p>
            ) : (
              <CappedList
                items={data.offers}
                label="Ofertas feitas"
                truncated={data.truncated?.offers}
                truncatedText="Mostrando as 50 ofertas mais recentes."
                render={(o) => {
                  const e = entryOf(o.entry_id);
                  const who = e ? customer(e.customer_id) : "Cliente";
                  return (
                    <Row
                      key={o.id}
                      title={who}
                      badge={<StatusBadge tone={OFFER_TONE[o.status]}>{OFFER_STATUS[o.status]}</StatusBadge>}
                      meta={(o.status === "offered" ? `Vale até ${formatDateTime(o.expires_at, tz)} · ` : "") + (o.delivery_state ? DELIVERY[o.delivery_state] ?? "" : "")}
                      // Retirar invalida o link que o cliente já pode ter recebido: não volta atrás, então confirma antes.
                      action={o.status === "offered" ? (
                        <Button size="compact" variant="ghost" data-return aria-label={`Retirar oferta${e ? ` de ${who}` : ""}`} onClick={() => setConfirming(`offer:${o.id}`)}>
                          Retirar oferta
                        </Button>
                      ) : undefined}
                      below={confirming === `offer:${o.id}` ? (
                        <InlineConfirm
                          title="Retirar oferta?"
                          consequence={`O link${e ? ` de ${who}` : ""} para de funcionar e o horário volta a ficar livre.`}
                          confirmLabel="Sim, retirar"
                          onClose={() => setConfirming(null)}
                          onConfirm={() => run({ cancelOffer: o.id, version: o.version }, (key) => port.cancelOffer(o.id, key), "Oferta retirada. O horário voltou a ficar livre.")}
                        />
                      ) : undefined}
                    />
                  );
                }}
              />
            )}
          </Section>

          <Section id="wl-entries-title" title="Na lista" count={data.entries.length}>
            {data.entries.length === 0 ? (
              <p className="tn-muted">Ninguém na lista.</p>
            ) : (
              <CappedList
                items={data.entries}
                label="Quem está na lista"
                truncated={data.truncated?.entries}
                truncatedText="Mostrando as 200 primeiras pessoas da fila."
                render={(e) => (
                  <Row
                    key={e.id}
                    title={<>{customer(e.customer_id)} · {service(e.service_id)}</>}
                    meta={`${windowsText(e.acceptable_windows)} · até ${formatDateTime(e.valid_until, tz)}`}
                    // Voltar exige novo cadastro com consentimento (e a vez na fila se perde): confirma antes.
                    action={
                      <Button size="compact" variant="ghost" data-return aria-label={`Tirar da lista ${customer(e.customer_id)}`} onClick={() => setConfirming(`entry:${e.id}`)}>
                        Tirar da lista
                      </Button>
                    }
                    below={confirming === `entry:${e.id}` ? (
                      <InlineConfirm
                        title={`Tirar ${customer(e.customer_id)} da lista?`}
                        consequence={`${customer(e.customer_id)} deixa de receber vagas de ${service(e.service_id)} e perde a vez na fila. Para voltar, é preciso adicionar de novo.`}
                        confirmLabel="Sim, tirar"
                        onClose={() => setConfirming(null)}
                        onConfirm={() => run({ withdraw: e.id, version: e.version }, (key) => port.withdraw(e, key), "Cliente saiu da lista.")}
                      />
                    ) : undefined}
                  />
                )}
              />
            )}
          </Section>
        </>
      )}
    </section>
  );
}

function ShareCard({ token, onShared, onClose }: { token: string; onShared: () => void; onClose: () => void }) {
  const link = offerLink(token);
  const text = `Abriu um horário para você. Veja e confirme se quiser: ${link}`;
  return (
    <Card aria-labelledby="wl-share-title">
      <h2 id="wl-share-title">Link da oferta</h2>
      <p className="tn-muted">
        O link aparece só agora. A Tinindo não envia mensagens: copie ou abra o WhatsApp e envie você mesmo. Compartilhar não confirma que o
        cliente recebeu.
      </p>
      <p className="tn-wl-link"><code>{link}</code></p>
      {/* Só registra o compartilhamento depois que a cópia deu certo (ou ao abrir o WhatsApp). */}
      <ShareActions message={text} copyText={link} copyLabel="Copiar link" onShared={onShared} />
      <div className="tn-actions">
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
      </div>
    </Card>
  );
}

function JoinForm({ base, onDone, onCancel }: { base: WaitlistBase; onDone: (t: string) => void; onCancel: () => void }) {
  const port = usePort();
  const today = localDate(port.now(), base.timezone);
  const [customer, setCustomer] = useState("");
  const [service, setService] = useState(base.services[0]?.id ?? "");
  const [days, setDays] = useState<number[]>([]);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("19:00");
  const [until, setUntil] = useState(() => new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));
  const [consent, setConsent] = useState(false);
  const { formRef, errors, show } = useFormErrors<"customer" | "days" | "to" | "until" | "consent">();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idem = useIdempotencyKey();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const ok = show({
      customer: !customer ? "Escolha o cliente." : null,
      days: days.length === 0 ? "Escolha pelo menos um dia." : null,
      to: !from || !to || to <= from ? "O fim da faixa deve ser depois do início." : null,
      until: !until || until < today ? "Escolha uma data a partir de hoje." : null,
      consent: !consent ? "Só entra na lista quem autorizou receber aviso de vaga." : null,
    });
    if (!ok) return;
    setPending(true);
    try {
      const body = { customer_id: customer, service_id: service, valid_until: endOfLocalDay(until, base.timezone),
        windows: [...days].sort().map((weekday) => ({ weekday, local_start: from, local_end: to })) };
      await port.join(body, idem.keyFor(body));
      idem.reset();
      onDone("Cliente entrou na lista de espera. Quando abrir uma vaga compatível, ela aparece em \"Vagas para oferecer\".");
      setDays([]);
      setConsent(false);
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="tn-form-grid" onSubmit={(e) => void submit(e)} noValidate aria-label="Adicionar à lista">
        <Field as="select" label="Cliente" id="wl-customer" value={customer} error={errors.customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">Escolha…</option>
          {base.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Field>
        <Field as="select" label="Serviço" id="wl-service" value={service} onChange={(e) => setService(e.target.value)}>
          {base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Field>
        <div data-span="full">
          <ChipGroup label="Dias que servem" options={WEEKDAY_CHIPS} shortcuts={WEEKDAY_SHORTCUTS} value={days} onChange={setDays}
            error={errors.days} errorId="wl-days-error" />
        </div>
        <Field label="A partir de" id="wl-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="Até as" id="wl-to" type="time" step={900} value={to} error={errors.to} onChange={(e) => setTo(e.target.value)} />
        <Field label="Fica na lista até" id="wl-until" type="date" min={today} value={until} error={errors.until} onChange={(e) => setUntil(e.target.value)} />
        <div className="tn-wl-consent" data-span="full">
          <label className="tn-wl-check">
            <input type="checkbox" checked={consent} aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? "wl-consent-error" : undefined} onChange={(e) => setConsent(e.target.checked)} />
            O cliente autorizou receber aviso de vaga por mensagem que eu mesmo vou enviar.
          </label>
          {errors.consent ? <span id="wl-consent-error" className="tn-field__error">{errors.consent}</span> : null}
        </div>
        {failure ? <div data-span="full"><StatusBanner tone="danger">{failure}</StatusBanner></div> : null}
        <div className="tn-actions" data-span="full" data-sheet-footer>
          <Button type="submit" loading={pending}>Adicionar</Button>
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
  );
}

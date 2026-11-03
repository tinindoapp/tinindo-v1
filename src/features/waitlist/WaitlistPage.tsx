// Lista de espera (P06), visão do dono. Uma pessoa de cada vez por horário; o dono aprova cada oferta.
// A Tinindo não envia mensagens: o dono compartilha o link, e compartilhar não confirma entrega.
import { createContext, type FormEvent, useContext, useEffect, useRef, useState } from "react";
import type { TimeRange, WaitlistEntry, WaitlistOffer } from "@contracts";
import { Button, Card, ChipGroup, ConfirmAction, Field, PageHeader, ShareActions, StatusBanner, toast, useFormErrors, WEEKDAY_CHIPS, WEEKDAY_SHORTCUTS } from "../../components/ui/index.tsx";
import { endOfLocalDay, entriesForStart, formatDateTime, formatSlot, formatStart, localDate, windowsText } from "./format.ts";
import { newKey, type WaitlistBase, type WaitlistPort } from "./port.ts";

const PortContext = createContext<WaitlistPort | null>(null);
export const WaitlistPortProvider = PortContext.Provider;
const usePort = () => useContext(PortContext)!;

const OFFER_STATUS: Record<WaitlistOffer["status"], string> = {
  pending_approval: "Aguardando aprovação", offered: "Oferta aberta", accepted: "Aceita: reserva confirmada",
  declined: "Recusada", expired: "Vencida", invalidated: "Retirada",
};
const DELIVERY: Record<string, string> = {
  prepared: "Link pronto, ainda não compartilhado",
  share_opened: "Compartilhamento aberto (a entrega não é confirmada)",
};

function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  if (e?.code === "SLOT_CONFLICT") return "Esse horário já está reservado ou em oferta para outra pessoa. Uma pessoa de cada vez.";
  if (e?.code === "POLICY_REJECTED" && e.field === "customer_id") return "Este cliente já está na lista para este serviço.";
  if (e?.code === "POLICY_REJECTED") return "As regras não permitem esta ação agora (entrada, consentimento ou cotação mudou). Nada foi alterado.";
  if (e?.code === "VALIDATION_ERROR") return "Confira os campos. Nada foi gravado.";
  if (e?.code === "STALE_VERSION") return "Isto mudou em outro lugar. Atualizamos a lista.";
  return "Não foi possível concluir agora. Tentar de novo é seguro.";
}

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
      const o = await port.prepareOffer(entry, slot, newKey());
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
  async function run(action: () => Promise<void>, ok: string) {
    try {
      await action();
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

  return (
    <section aria-labelledby="wl-title" className="tn-wl">
      <PageHeader id="wl-title" title="Lista de espera" subtitle="Quando um horário fica livre, ofereça a quem está esperando. Abrir o link não reserva; o cliente aceita ou recusa." />
      {port.kind === "demo" ? (
        <StatusBanner tone="info">
          <strong>Dados de exemplo.</strong> Demonstração sem servidor: esta tela ainda não guarda nem altera dados no servidor;
          as mudanças valem só nesta aba.
        </StatusBanner>
      ) : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {fresh ? <ShareCard token={fresh.token} onShared={() => run(() => port.markShared(fresh.offerId, newKey()), "Compartilhamento registrado. A entrega não é confirmada pela Tinindo.")} onClose={() => setFresh(null)} /> : null}
      {!base || !data ? (
        <p role="status">Carregando a lista…</p>
      ) : (
        <>
          <section aria-labelledby="wl-slots-title" className="tn-wl-section">
            <h2 id="wl-slots-title">Vagas para oferecer</h2>
            {target !== null ? (
              targetDone ? (
                <p className="tn-wl-target" data-state="done" role="status">
                  Oferta preparada para {targetDone} na vaga de {formatStart(new Date(target).toISOString(), tz)}. Veja em “Ofertas”.
                </p>
              ) : highlight ? (
                <div className="tn-wl-item tn-wl-target" data-state="open">
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
              <ul className="tn-item-list" aria-label={target !== null ? "Outras vagas" : undefined}>
                {others.map(([start, list]) => {
                  const first = list[0]!;
                  const entry = entryOf(first.entry_id);
                  return (
                    <li key={start} className="tn-wl-item">
                      <div>
                        <strong>{formatSlot(first.slot, tz)}</strong>
                        <div className="tn-muted">
                          Próximo da fila: {entry ? `${customer(entry.customer_id)} · ${service(entry.service_id)}` : "—"}
                          {list.length > 1 ? ` · depois: ${list.length - 1}` : ""}
                        </div>
                      </div>
                      {entry ? (
                        <Button onClick={() => void prepare(entry, first.slot)}>
                          Preparar oferta<span className="tn-visually-hidden"> para {customer(entry.customer_id)}</span>
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="wl-offers-title" className="tn-wl-section">
            <h2 id="wl-offers-title">Ofertas</h2>
            {data.offers.length === 0 ? (
              <p className="tn-muted">Nenhuma oferta feita.</p>
            ) : (
              <ul className="tn-item-list">
                {data.offers.map((o) => {
                  const e = entryOf(o.entry_id);
                  return (
                    <li key={o.id} className="tn-wl-item">
                      <div>
                        <strong>{OFFER_STATUS[o.status]}</strong>
                        {e ? ` · ${customer(e.customer_id)}` : ""}
                        <div className="tn-muted">
                          {o.status === "offered" ? `Vale até ${formatDateTime(o.expires_at, tz)} · ` : ""}
                          {o.delivery_state ? DELIVERY[o.delivery_state] ?? "" : ""}
                        </div>
                      </div>
                      {o.status === "offered" ? (
                        // Retirar invalida o link que o cliente já pode ter recebido: não volta atrás, então confirma antes.
                        <ConfirmAction
                          trigger="Retirar oferta"
                          triggerLabel={`Retirar oferta${e ? ` de ${customer(e.customer_id)}` : ""}`}
                          title="Retirar oferta?"
                          consequence={`O link${e ? ` de ${customer(e.customer_id)}` : ""} para de funcionar e o horário volta a ficar livre.`}
                          confirmLabel="Sim, retirar"
                          onConfirm={() => run(() => port.cancelOffer(o.id, newKey()), "Oferta retirada. O horário voltou a ficar livre.")}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="wl-entries-title" className="tn-wl-section">
            <h2 id="wl-entries-title">Na lista</h2>
            {data.entries.length === 0 ? (
              <p className="tn-muted">Ninguém na lista.</p>
            ) : (
              <ul className="tn-item-list">
                {data.entries.map((e) => (
                  <li key={e.id} className="tn-wl-item">
                    <div>
                      <strong>{customer(e.customer_id)}</strong> · {service(e.service_id)}
                      <div className="tn-muted">{windowsText(e.acceptable_windows)} · até {formatDateTime(e.valid_until, tz)}</div>
                    </div>
                    {/* Voltar exige novo cadastro com consentimento (e a vez na fila se perde): confirma antes. */}
                    <ConfirmAction
                      trigger="Tirar da lista"
                      triggerLabel={`Tirar da lista ${customer(e.customer_id)}`}
                      title={`Tirar ${customer(e.customer_id)} da lista?`}
                      consequence={`${customer(e.customer_id)} deixa de receber vagas de ${service(e.service_id)} e perde a vez na fila. Para voltar, é preciso adicionar de novo.`}
                      confirmLabel="Sim, tirar"
                      onConfirm={() => run(() => port.withdraw(e, newKey()), "Cliente saiu da lista.")}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <JoinForm base={base} onDone={(text) => { toast(text); reload(); }} />
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

function JoinForm({ base, onDone }: { base: WaitlistBase; onDone: (t: string) => void }) {
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
      await port.join({ customer_id: customer, service_id: service, valid_until: endOfLocalDay(until, base.timezone),
        windows: [...days].sort().map((weekday) => ({ weekday, local_start: from, local_end: to })) }, newKey());
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
    <section aria-labelledby="wl-join-title" className="tn-wl-section">
      <h2 id="wl-join-title">Adicionar à lista</h2>
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
        <div className="tn-actions" data-span="full">
          <Button type="submit" loading={pending}>Adicionar</Button>
        </div>
      </form>
    </section>
  );
}

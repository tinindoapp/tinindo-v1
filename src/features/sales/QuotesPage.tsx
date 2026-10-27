// Orçamentos (P11), visão do dono. Cada versão é imutável; o cliente aceita pelo link a versão que viu.
// A Tinindo não envia mensagens: o dono compartilha o link. Aceito não é pago: a cobrança fica no Caixa.
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useId, useState } from "react";
import type { SalesQuote } from "@contracts";
import { Button, Card, Help, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { ShareActions } from "./share.tsx";
import { newKey, type QuoteDetail, type QuoteDraft, type SalesBase, type SalesPort } from "./port.ts";
import {
  centsToInput,
  explain,
  formatCents,
  formatDateTime,
  formatSlot,
  localDate,
  localToIso,
  parseBRL,
  quoteTotal,
  STATUS_LABEL,
  validUntilInDays,
} from "./rules.ts";

const PortContext = createContext<SalesPort | null>(null);
export const SalesPortProvider = PortContext.Provider;
function usePort(): SalesPort {
  const p = useContext(PortContext);
  if (!p) throw new Error("usePort fora dos Orçamentos");
  return p;
}

/** Rótulo explícito (htmlFor): o nome acessível do campo não inclui o valor selecionado. */
function FieldBox({ label, className, children }: { label: string; className?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`tn-qt-field${className ? ` ${className}` : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

export function quoteLink(token: string): string {
  return `${window.location.origin}/orcamento#t=${token}`;
}

/** Mensagem curta e pronta para o cliente; o dono pode mudar antes de mandar. */
export function quoteMessage(title: string | null, link: string): string {
  return `Olá! Segue o orçamento${title ? ` "${title}"` : ""}. Para ver e aceitar, abra: ${link}`;
}

/** O telefone vem quando a base de clientes trouxer (hoje só id e nome). */
const phoneOf = (c: { id: string; phone?: string | null }) => c.phone ?? null;

interface ItemRow { key: string; service_id: string; description: string; quantity: string; price: string }
interface FormState {
  customer_id: string;
  title: string;
  items: ItemRow[];
  days: string;
  withSlot: boolean;
  slotService: string;
  slotDate: string;
  slotTime: string;
  notes: string;
}

const emptyItem = (): ItemRow => ({ key: newKey(), service_id: "", description: "", quantity: "1", price: "" });

function emptyForm(base: SalesBase, now: Date): FormState {
  return { customer_id: base.customers[0]?.id ?? "", title: "", items: [emptyItem()], days: "7", withSlot: false, slotService: "",
    slotDate: localDate(new Date(now.getTime() + 86_400_000), base.timezone), slotTime: "10:00", notes: "" };
}

function formFromQuote(q: SalesQuote, base: SalesBase): FormState {
  const v = q.current;
  return {
    customer_id: q.customer_id, title: v.title,
    items: v.items.map((i) => ({ key: newKey(), service_id: i.service_id ?? "", description: i.description, quantity: String(i.quantity),
      price: centsToInput(i.unit_price_cents) })),
    days: "7", withSlot: v.slot !== null, slotService: v.slot?.service_id ?? "",
    slotDate: v.slot ? localDate(v.slot.starts_at, base.timezone) : "",
    slotTime: v.slot ? new Intl.DateTimeFormat("en-GB", { timeZone: base.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(v.slot.starts_at)) : "10:00",
    notes: v.notes ?? "",
  };
}

/** Converte o formulário no rascunho do contrato; devolve a mensagem do primeiro problema. */
function toDraft(f: FormState, base: SalesBase, now: Date): QuoteDraft | string {
  if (!f.customer_id) return "Escolha o cliente.";
  if (!f.title.trim()) return "Dê um título ao orçamento.";
  const items: QuoteDraft["items"] = [];
  for (const [n, row] of f.items.entries()) {
    const price = parseBRL(row.price);
    const quantity = Number(row.quantity);
    if (!row.description.trim()) return `Item ${n + 1}: descreva o item.`;
    if (price === null) return `Item ${n + 1}: valor inválido (use 60 ou 60,50).`;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return `Item ${n + 1}: quantidade de 1 a 99.`;
    items.push({ service_id: row.service_id || null, description: row.description.trim(), quantity, unit_price_cents: price });
  }
  let slot: QuoteDraft["slot"] = null;
  if (f.withSlot) {
    if (!f.slotService || !items.some((i) => i.service_id === f.slotService)) return "O horário precisa ser de um serviço que está nos itens.";
    if (!f.slotDate || !f.slotTime) return "Informe dia e hora do horário proposto.";
    slot = { service_id: f.slotService, starts_at: localToIso(f.slotDate, f.slotTime, base.timezone) };
  }
  return { customer_id: f.customer_id, title: f.title.trim(), items, valid_until: validUntilInDays(now, Number(f.days), base.timezone), slot,
    notes: f.notes.trim() || null };
}

export function QuotesPage() {
  const port = usePort();
  const [base, setBase] = useState<SalesBase | null>(null);
  const [quotes, setQuotes] = useState<SalesQuote[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editing, setEditing] = useState<SalesQuote | null>(null);
  // Lista primeiro: o formulário abre por "Novo orçamento" ou "Revisar".
  const [composing, setComposing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ quoteId: string; token: string } | null>(null);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [keys, setKeys] = useState(() => ({ save: newKey() }));

  useEffect(() => {
    let alive = true;
    port.base().then((b) => { if (alive) { setBase(b); setForm(emptyForm(b, port.now())); } }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port]);
  useEffect(() => {
    let alive = true;
    port.list().then((q) => alive && setQuotes(q), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const reload = () => setNonce((n) => n + 1);

  const tz = base?.timezone ?? "America/Sao_Paulo";
  const customer = (id: string) => base?.customers.find((c) => c.id === id)?.name ?? "Cliente";
  const service = (id: string) => base?.services.find((s) => s.id === id)?.name ?? "Serviço";

  async function run(action: () => Promise<string>) {
    setPending(true);
    try {
      setNotice({ tone: "success", text: await action() });
    } catch (err) {
      setNotice({ tone: "danger", text: explain(err) });
    } finally {
      setPending(false);
      reload();
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !base) return;
    const draft = toDraft(form, base, port.now());
    if (typeof draft === "string") {
      setFormError(draft);
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      if (editing) {
        const q = await port.revise(editing, draft, keys.save);
        setNotice({ tone: "success", text: `Versão ${q.current.version_no} salva. Quem abrir o link vê esta versão; a anterior não pode mais ser aceita.` });
      } else {
        await port.create(draft, keys.save);
        setNotice({ tone: "success", text: "Rascunho salvo. Gere o link para o cliente quando estiver pronto." });
      }
      setForm(emptyForm(base, port.now()));
      setEditing(null);
      setComposing(false);
      setKeys({ save: newKey() });
    } catch (err) {
      setFormError(explain(err));
    } finally {
      setPending(false);
      reload();
    }
  }

  function startRevise(q: SalesQuote) {
    if (!base) return;
    setEditing(q);
    setComposing(true);
    setForm(formFromQuote(q, base));
    setKeys({ save: newKey() });
    setFormError(null);
    document.getElementById("qt-form-title")?.scrollIntoView?.({ block: "start" });
  }

  const update = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const updateItem = (key: string, patch: Partial<ItemRow>) =>
    setForm((f) => (f ? { ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : f));

  if (error && !quotes) {
    return (
      <div className="tn-qt">
        <PageHeader id="qt-title" title="Orçamentos" />
        <StatusBanner tone="danger">{explain(error)}</StatusBanner>
      </div>
    );
  }

  const freshQuote = fresh ? quotes?.find((q) => q.id === fresh.quoteId) ?? null : null;
  const freshCustomer = freshQuote ? base?.customers.find((c) => c.id === freshQuote.customer_id) ?? null : null;
  const draftTotal = form ? quoteTotal(form.items.map((i) => ({ quantity: Number(i.quantity) || 0, unit_price_cents: parseBRL(i.price) ?? 0 }))) : 0;
  const slotServices = form ? [...new Set(form.items.map((i) => i.service_id).filter(Boolean))] : [];

  return (
    <div className="tn-qt">
      <PageHeader
        id="qt-title"
        title="Orçamentos"
        subtitle={<><strong>Aceito não é pago:</strong> a cobrança fica no Caixa.</>}
        actions={form && base && !composing ? (
          <Button onClick={() => { setEditing(null); setForm(emptyForm(base, port.now())); setFormError(null); setComposing(true); }}>
            <Icon name="mais" size={20} />
            Novo orçamento
          </Button>
        ) : null}
      />
      <Help><p>Proposta com validade. O cliente aceita pelo link a versão que viu; se houver horário proposto, o aceite só vale se o horário ainda estiver livre.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor: nada sai do navegador.</StatusBanner> : null}
      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}

      {fresh ? (
        <Card aria-labelledby="qt-link-title">
          <div className="tn-qt-section">
            <h2 id="qt-link-title">Link do orçamento</h2>
            <p className="tn-qt-muted">A Tinindo não envia mensagens. Mande o link ao cliente pelo WhatsApp ou copie. Gerar outro link invalida este.</p>
            <code className="tn-qt-code">{quoteLink(fresh.token)}</code>
            <ShareActions
              message={quoteMessage(freshQuote?.current.title ?? null, quoteLink(fresh.token))}
              copyText={quoteLink(fresh.token)}
              copyLabel="Copiar link"
              phone={freshCustomer ? phoneOf(freshCustomer) : null}
            />
            <div className="tn-qt-actions">
              <Button variant="ghost" onClick={() => setFresh(null)}>Fechar</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {form && base && composing ? (
        <Card aria-labelledby="qt-form-title">
          <form aria-labelledby="qt-form-title" className="tn-qt-section" onSubmit={(e) => void save(e)} noValidate>
            <h2 id="qt-form-title">{editing ? `Revisar orçamento (nova versão ${editing.current_version + 1})` : "Novo orçamento"}</h2>
            <div className="tn-qt-grid">
              <FieldBox label="Cliente">{(id) => (
                <select id={id} value={form.customer_id} disabled={!!editing} onChange={(e) => update({ customer_id: e.target.value })}>
                  {base.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                  )}</FieldBox>
              <FieldBox label="Título">{(id) => (
                <input id={id} value={form.title} maxLength={120} onChange={(e) => update({ title: e.target.value })} />
                  )}</FieldBox>
            </div>
            <fieldset className="tn-qt-items">
              <legend>Itens</legend>
              {form.items.map((row, n) => (
                <div key={row.key} className="tn-qt-item" role="group" aria-label={`Item ${n + 1}`}>
                  <FieldBox label="Serviço">{(id) => (
                    <select id={id} value={row.service_id} onChange={(e) => {
                      const svc = base.services.find((s) => s.id === e.target.value);
                      updateItem(row.key, { service_id: e.target.value, ...(svc ? { description: svc.name, price: centsToInput(svc.base_price_cents) } : {}) });
                    }}>
                      <option value="">Outro item</option>
                      {base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}</FieldBox>
                  <FieldBox label="Descrição">{(id) => (
                    <input id={id} value={row.description} maxLength={120} onChange={(e) => updateItem(row.key, { description: e.target.value })} />
                  )}</FieldBox>
                  <FieldBox label="Qtd." className="tn-qt-field--small">{(id) => (
                    <input id={id} inputMode="numeric" value={row.quantity} onChange={(e) => updateItem(row.key, { quantity: e.target.value })} />
                  )}</FieldBox>
                  <FieldBox label="Valor (R$)" className="tn-qt-field--small">{(id) => (
                    <input id={id} inputMode="decimal" value={row.price} onChange={(e) => updateItem(row.key, { price: e.target.value })} />
                  )}</FieldBox>
                  {form.items.length > 1 ? (
                    <Button variant="ghost" onClick={() => update({ items: form.items.filter((i) => i.key !== row.key) })}>Remover item {n + 1}</Button>
                  ) : null}
                </div>
              ))}
              {form.items.length < 20 ? <Button variant="secondary" onClick={() => update({ items: [...form.items, emptyItem()] })}>Adicionar item</Button> : null}
              <p className="tn-qt-total">Total: <strong className="tn-num">{formatCents(draftTotal)}</strong> <span className="tn-qt-muted">(conferido de novo no servidor)</span></p>
            </fieldset>
            <div className="tn-qt-grid">
              <FieldBox label="Validade">{(id) => (
                <select id={id} value={form.days} onChange={(e) => update({ days: e.target.value })}>
                  {["3", "7", "15", "30"].map((d) => <option key={d} value={d}>{d} dias</option>)}
                </select>
                  )}</FieldBox>
              <label className="tn-qt-check">
                <input type="checkbox" checked={form.withSlot} onChange={(e) => update({ withSlot: e.target.checked, slotService: slotServices[0] ?? "" })} />
                Propor um horário
              </label>
            </div>
            {form.withSlot ? (
              <div className="tn-qt-grid">
                <FieldBox label="Serviço do horário">{(id) => (
                  <select id={id} value={form.slotService} onChange={(e) => update({ slotService: e.target.value })}>
                    <option value="">Escolha</option>
                    {slotServices.map((s) => <option key={s} value={s}>{service(s)}</option>)}
                  </select>
                  )}</FieldBox>
                <FieldBox label="Dia">{(id) => (
                  <input id={id} type="date" value={form.slotDate} onChange={(e) => update({ slotDate: e.target.value })} />
                  )}</FieldBox>
                <FieldBox label="Hora">{(id) => (
                  <input id={id} type="time" value={form.slotTime} onChange={(e) => update({ slotTime: e.target.value })} />
                  )}</FieldBox>
                <p className="tn-qt-muted">Propor não reserva. O horário é conferido agora e de novo quando o cliente aceitar.</p>
              </div>
            ) : null}
            <FieldBox label="Observações para o cliente (opcional)">{(id) => (
              <textarea id={id} value={form.notes} maxLength={500} rows={2} onChange={(e) => update({ notes: e.target.value })} />
                  )}</FieldBox>
            {formError ? <StatusBanner tone="danger">{formError}</StatusBanner> : null}
            <div className="tn-qt-actions">
              <Button type="submit" disabled={pending}>{editing ? "Salvar nova versão" : "Salvar rascunho"}</Button>
              <Button variant="ghost" onClick={() => { setEditing(null); setComposing(false); setFormError(null); setForm(emptyForm(base, port.now())); }}>
                {editing ? "Desistir da revisão" : "Cancelar"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card aria-labelledby="qt-list-title">
        <div className="tn-qt-section">
          <h2 id="qt-list-title">Seus orçamentos</h2>
          {quotes === null ? <p role="status">Carregando…</p> : null}
          {quotes?.length === 0 ? <p className="tn-qt-muted">Nenhum orçamento ainda.</p> : null}
          <ul className="tn-qt-list">
            {quotes?.map((q) => (
              <li key={q.id} className="tn-qt-row">
                <div>
                  <strong>{q.current.title}</strong> · {customer(q.customer_id)}
                  <div className="tn-qt-muted">
                    <span className="tn-num">{formatCents(q.current.total_cents)}</span> · versão {q.current.version_no} · {STATUS_LABEL[q.status]}
                    {q.status === "sent" || q.status === "draft" ? ` · vale até ${formatDateTime(q.current.valid_until, tz)}` : ""}
                  </div>
                  {q.current.slot ? <div className="tn-qt-muted">Horário proposto: {formatSlot(q.current.slot, tz)}</div> : null}
                  {q.status === "accepted" ? (
                    <div className="tn-qt-muted">
                      {q.booking_id ? "Horário reservado na agenda. " : ""}Aceito não é pago: registre a cobrança no Caixa quando for o caso.
                    </div>
                  ) : null}
                </div>
                <div className="tn-qt-actions">
                  {q.status === "draft" || q.status === "sent" ? (
                    <Button disabled={pending} onClick={() => void run(async () => {
                      const r = await port.send(q, newKey());
                      if (r.token) setFresh({ quoteId: q.id, token: r.token });
                      return q.status === "sent" ? "Novo link gerado. O link anterior não funciona mais." : "Link gerado. Compartilhe com o cliente.";
                    })}>{q.status === "sent" ? "Gerar novo link" : "Gerar link"}</Button>
                  ) : null}
                  {q.status === "draft" || q.status === "sent" || q.status === "expired" ? (
                    <Button variant="secondary" disabled={pending} onClick={() => startRevise(q)}>Revisar</Button>
                  ) : null}
                  {q.status === "draft" || q.status === "sent" || q.status === "expired" ? (
                    <Button variant="ghost" disabled={pending} onClick={() => void run(async () => {
                      await port.cancel(q.id, newKey());
                      return "Orçamento cancelado. O link deixou de funcionar.";
                    })}>Cancelar orçamento</Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => void port.get(q.id).then(setDetail, (e: unknown) => setNotice({ tone: "danger", text: explain(e) }))}>
                    Ver versões
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {detail ? (
        <Card aria-labelledby="qt-detail-title">
          <div className="tn-qt-section">
            <h2 id="qt-detail-title">Versões de “{detail.quote.current.title}”</h2>
            {detail.decision ? (
              <StatusBanner tone="info">
                {detail.decision.decision === "accepted" ? "Aceito" : "Recusado"} pelo cliente na versão {detail.decision.version_no} em{" "}
                {formatDateTime(detail.decision.decided_at, tz)} (código {detail.decision.snapshot_hash.slice(0, 8)}).
              </StatusBanner>
            ) : null}
            <ol className="tn-qt-list">
              {detail.versions.map((v) => (
                <li key={v.version_no} className="tn-qt-row">
                  <div>
                    <strong>Versão {v.version_no}</strong> · <span className="tn-num">{formatCents(v.total_cents)}</span> · criada em {formatDateTime(v.created_at, tz)}
                    <div className="tn-qt-muted">{v.items.map((i) => `${i.quantity}× ${i.description}`).join(", ")} · código {v.snapshot_hash.slice(0, 8)}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="tn-qt-actions"><Button variant="ghost" onClick={() => setDetail(null)}>Fechar</Button></div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

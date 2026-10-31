// Orçamentos (P11), visão do dono. Cada versão é imutável; o cliente aceita pelo link a versão que viu.
// A Tinindo não envia mensagens: o dono compartilha o link. Aceito não é pago: a cobrança fica no Caixa.
import { createContext, type FormEvent, useContext, useEffect, useState } from "react";
import type { SalesQuote } from "@contracts";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { ShareActions } from "./share.tsx";
import { newKey, type QuoteDetail, type QuoteDraft, type QuoteMaterialCost, type SalesBase, type SalesPort } from "./port.ts";
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

/** Chaves de erro por campo; itens usam a chave estável da linha. */
const itemErr = (key: string, field: "description" | "price" | "quantity") => `item-${key}-${field}`;

/** Converte o formulário no rascunho do contrato; sem rascunho, devolve todos os problemas, um por campo. */
function toDraft(f: FormState, base: SalesBase, now: Date): { draft: QuoteDraft } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!f.customer_id) errors.customer = "Escolha o cliente.";
  if (!f.title.trim()) errors.title = "Dê um título ao orçamento.";
  const items: QuoteDraft["items"] = [];
  for (const row of f.items) {
    const price = parseBRL(row.price);
    const quantity = Number(row.quantity);
    if (!row.description.trim()) errors[itemErr(row.key, "description")] = "Descreva o item.";
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) errors[itemErr(row.key, "quantity")] = "Quantidade de 1 a 99.";
    if (price === null) errors[itemErr(row.key, "price")] = "Valor inválido. Use 60 ou 60,50.";
    else items.push({ service_id: row.service_id || null, description: row.description.trim(), quantity, unit_price_cents: price });
  }
  let slot: QuoteDraft["slot"] = null;
  if (f.withSlot) {
    if (!f.slotService || !f.items.some((i) => i.service_id === f.slotService)) errors.slotService = "Escolha um serviço que está nos itens.";
    if (!f.slotDate) errors.slotDate = "Informe o dia do horário proposto.";
    if (!f.slotTime) errors.slotTime = "Informe a hora do horário proposto.";
    if (!errors.slotService && !errors.slotDate && !errors.slotTime) {
      slot = { service_id: f.slotService, starts_at: localToIso(f.slotDate, f.slotTime, base.timezone) };
    }
  }
  if (Object.keys(errors).length) return { errors };
  return { draft: { customer_id: f.customer_id, title: f.title.trim(), items, valid_until: validUntilInDays(now, Number(f.days), base.timezone), slot,
    notes: f.notes.trim() || null } };
}

export function QuotesPage() {
  const port = usePort();
  const [base, setBase] = useState<SalesBase | null>(null);
  const [quotes, setQuotes] = useState<SalesQuote[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editing, setEditing] = useState<SalesQuote | null>(null);
  // Lista primeiro: o formulário abre por "Novo orçamento" ou "Revisar".
  const [composing, setComposing] = useState(false);
  // Erro do servidor ao salvar: fica no formulário. Erros de campo ficam embaixo de cada campo.
  const [formError, setFormError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors();
  const [fresh, setFresh] = useState<{ quoteId: string; token: string } | null>(null);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  // Custo de materiais da versão atual (P30). "unavailable" = sem estoque cadastrado ou módulo fora do ar: o orçamento não depende disso.
  const [costOf, setCostOf] = useState<{ quoteId: string; value: QuoteMaterialCost | "unavailable" } | null>(null);
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
  useEffect(() => {
    if (!detail) return;
    let alive = true;
    const quoteId = detail.quote.id;
    port.materialCost(quoteId).then((value) => alive && setCostOf({ quoteId, value }), () => alive && setCostOf({ quoteId, value: "unavailable" }));
    return () => { alive = false; };
  }, [port, detail]);
  const cost = costOf && detail && costOf.quoteId === detail.quote.id ? costOf.value : null;

  const tz = base?.timezone ?? "America/Sao_Paulo";
  const customer = (id: string) => base?.customers.find((c) => c.id === id)?.name ?? "Cliente";
  const service = (id: string) => base?.services.find((s) => s.id === id)?.name ?? "Serviço";

  async function run(action: () => Promise<string>) {
    setPending(true);
    try {
      toast(await action());
    } catch (err) {
      toast({ tone: "danger", message: explain(err) });
    } finally {
      setPending(false);
      reload();
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !base) return;
    const out = toDraft(form, base, port.now());
    setFormError(null);
    if (!show("errors" in out ? out.errors : {}) || !("draft" in out)) return;
    const { draft } = out;
    setPending(true);
    try {
      if (editing) {
        const q = await port.revise(editing, draft, keys.save);
        toast(`Versão ${q.current.version_no} salva. Quem abrir o link vê esta versão; a anterior não pode mais ser aceita.`);
      } else {
        await port.create(draft, keys.save);
        toast("Rascunho salvo. Gere o link para o cliente quando estiver pronto.");
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
    show({});
    document.getElementById("qt-form-title")?.scrollIntoView?.({ block: "start" });
  }

  const update = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const updateItem = (key: string, patch: Partial<ItemRow>) =>
    setForm((f) => (f ? { ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : f));

  if (error && !quotes) {
    return (
      <div className="tn-stack">
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
    <div className="tn-stack">
      <PageHeader
        id="qt-title"
        title="Orçamentos"
        subtitle={<><strong>Aceito não é pago:</strong> a cobrança fica no Caixa.</>}
        actions={form && base && !composing ? (
          <Button onClick={() => { setEditing(null); setForm(emptyForm(base, port.now())); setFormError(null); show({}); setComposing(true); }}>
            <Icon name="mais" size={20} />
            Novo orçamento
          </Button>
        ) : null}
      />
      <Help><p>Proposta com validade. O cliente aceita pelo link a versão que viu; se houver horário proposto, o aceite só vale se o horário ainda estiver livre.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor: nada sai do navegador.</StatusBanner> : null}

      {fresh ? (
        <Card aria-labelledby="qt-link-title">
          <div className="tn-stack">
            <h2 id="qt-link-title">Link do orçamento</h2>
            <p className="tn-muted">A Tinindo não envia mensagens. Mande o link ao cliente pelo WhatsApp ou copie. Gerar outro link invalida este.</p>
            <code className="tn-qt-code">{quoteLink(fresh.token)}</code>
            <ShareActions
              message={quoteMessage(freshQuote?.current.title ?? null, quoteLink(fresh.token))}
              copyText={quoteLink(fresh.token)}
              copyLabel="Copiar link"
              phone={freshCustomer ? phoneOf(freshCustomer) : null}
            />
            <div className="tn-actions">
              <Button variant="ghost" onClick={() => setFresh(null)}>Fechar</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {form && base && composing ? (
        <Card aria-labelledby="qt-form-title">
          <form ref={formRef} aria-labelledby="qt-form-title" className="tn-stack" onSubmit={(e) => void save(e)} noValidate>
            <h2 id="qt-form-title">{editing ? `Revisar orçamento (nova versão ${editing.current_version + 1})` : "Novo orçamento"}</h2>
            <div className="tn-qt-grid">
              <Field as="select" label="Cliente" value={form.customer_id} disabled={!!editing} error={errors.customer} onChange={(e) => update({ customer_id: e.target.value })}>
                {base.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Field>
              <Field label="Título" value={form.title} maxLength={120} error={errors.title} onChange={(e) => update({ title: e.target.value })} />
            </div>
            <fieldset className="tn-qt-items">
              <legend>Itens</legend>
              {form.items.map((row, n) => (
                <div key={row.key} className="tn-qt-item" role="group" aria-label={`Item ${n + 1}`}>
                  <Field as="select" label="Serviço" value={row.service_id} onChange={(e) => {
                    const svc = base.services.find((s) => s.id === e.target.value);
                    updateItem(row.key, { service_id: e.target.value, ...(svc ? { description: svc.name, price: centsToInput(svc.base_price_cents) } : {}) });
                  }}>
                    <option value="">Outro item</option>
                    {base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Field>
                  <Field label="Descrição" value={row.description} maxLength={120} error={errors[itemErr(row.key, "description")]}
                    onChange={(e) => updateItem(row.key, { description: e.target.value })} />
                  <Field label="Qtd." className="tn-qt-field--small" inputMode="numeric" value={row.quantity} error={errors[itemErr(row.key, "quantity")]}
                    onChange={(e) => updateItem(row.key, { quantity: e.target.value })} />
                  <Field label="Valor (R$)" className="tn-qt-field--small" inputMode="decimal" value={row.price} error={errors[itemErr(row.key, "price")]}
                    onChange={(e) => updateItem(row.key, { price: e.target.value })} />
                  {form.items.length > 1 ? (
                    <Button variant="ghost" onClick={() => update({ items: form.items.filter((i) => i.key !== row.key) })}>Remover item {n + 1}</Button>
                  ) : null}
                </div>
              ))}
              {form.items.length < 20 ? <Button variant="secondary" onClick={() => update({ items: [...form.items, emptyItem()] })}>Adicionar item</Button> : null}
              <p className="tn-qt-total">Total: <strong className="tn-num">{formatCents(draftTotal)}</strong> <span className="tn-muted">(conferido de novo no servidor)</span></p>
            </fieldset>
            <div className="tn-qt-grid">
              <Field as="select" label="Validade" value={form.days} onChange={(e) => update({ days: e.target.value })}>
                {["3", "7", "15", "30"].map((d) => <option key={d} value={d}>{d} dias</option>)}
              </Field>
              <label className="tn-qt-check">
                <input type="checkbox" checked={form.withSlot} onChange={(e) => update({ withSlot: e.target.checked, slotService: slotServices[0] ?? "" })} />
                Propor um horário
              </label>
            </div>
            {form.withSlot ? (
              <div className="tn-qt-grid">
                <Field as="select" label="Serviço do horário" value={form.slotService} error={errors.slotService} onChange={(e) => update({ slotService: e.target.value })}>
                  <option value="">Escolha</option>
                  {slotServices.map((s) => <option key={s} value={s}>{service(s)}</option>)}
                </Field>
                <Field label="Dia" type="date" value={form.slotDate} error={errors.slotDate} onChange={(e) => update({ slotDate: e.target.value })} />
                <Field label="Hora" type="time" value={form.slotTime} error={errors.slotTime} onChange={(e) => update({ slotTime: e.target.value })} />
                <p className="tn-muted">Propor não reserva. O horário é conferido agora e de novo quando o cliente aceitar.</p>
              </div>
            ) : null}
            <Field as="textarea" label="Observações para o cliente (opcional)" value={form.notes} maxLength={500} rows={2} onChange={(e) => update({ notes: e.target.value })} />
            {formError ? <StatusBanner tone="danger">{formError}</StatusBanner> : null}
            <div className="tn-actions">
              <Button type="submit" loading={pending} loadingText="Salvando…">{editing ? "Salvar nova versão" : "Salvar rascunho"}</Button>
              <Button variant="ghost" onClick={() => { setEditing(null); setComposing(false); setFormError(null); show({}); setForm(emptyForm(base, port.now())); }}>
                {editing ? "Desistir da revisão" : "Cancelar"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card aria-labelledby="qt-list-title">
        <div className="tn-stack">
          <h2 id="qt-list-title">Seus orçamentos</h2>
          {quotes === null ? <p role="status">Carregando…</p> : null}
          {quotes?.length === 0 ? <p className="tn-muted">Nenhum orçamento ainda.</p> : null}
          <ul className="tn-qt-list">
            {quotes?.map((q) => (
              <li key={q.id} className="tn-qt-row">
                <div>
                  <strong>{q.current.title}</strong> · {customer(q.customer_id)}
                  <div className="tn-muted">
                    <span className="tn-num">{formatCents(q.current.total_cents)}</span> · versão {q.current.version_no} · {STATUS_LABEL[q.status]}
                    {q.status === "sent" || q.status === "draft" ? ` · vale até ${formatDateTime(q.current.valid_until, tz)}` : ""}
                  </div>
                  {q.current.slot ? <div className="tn-muted">Horário proposto: {formatSlot(q.current.slot, tz)}</div> : null}
                  {q.status === "accepted" ? (
                    <div className="tn-muted">
                      {q.booking_id ? "Horário reservado na agenda. " : ""}Aceito não é pago: registre a cobrança no Caixa quando for o caso.
                    </div>
                  ) : null}
                </div>
                <div className="tn-actions">
                  {q.status === "draft" ? (
                    <Button disabled={pending} onClick={() => void run(async () => {
                      const r = await port.send(q, newKey());
                      if (r.token) setFresh({ quoteId: q.id, token: r.token });
                      return "Link gerado. Compartilhe com o cliente.";
                    })}>Gerar link</Button>
                  ) : null}
                  {/* Novo link invalida o que o cliente já recebeu: não volta atrás, então confirma antes. */}
                  {q.status === "sent" ? (
                    <ConfirmAction
                      trigger="Gerar novo link"
                      triggerVariant="primary"
                      disabled={pending}
                      title="Gerar novo link?"
                      consequence={<p>O link que {customer(q.customer_id)} já recebeu para de funcionar. Você manda o novo em seguida.</p>}
                      confirmLabel="Sim, gerar novo link"
                      onConfirm={() => run(async () => {
                        const r = await port.send(q, newKey());
                        if (r.token) setFresh({ quoteId: q.id, token: r.token });
                        return "Novo link gerado. O link anterior não funciona mais.";
                      })}
                    />
                  ) : null}
                  {q.status === "draft" || q.status === "sent" || q.status === "expired" ? (
                    <Button variant="secondary" disabled={pending} onClick={() => startRevise(q)}>Revisar</Button>
                  ) : null}
                  {/* Cancelar não tem volta no port: confirma com a consequência para o cliente. */}
                  {q.status === "draft" || q.status === "sent" || q.status === "expired" ? (
                    <ConfirmAction
                      trigger="Cancelar orçamento"
                      triggerLabel={`Cancelar orçamento “${q.current.title}”`}
                      disabled={pending}
                      title={`Cancelar “${q.current.title}”?`}
                      consequence={
                        <p>
                          {q.status === "sent" ? `O link de ${customer(q.customer_id)} para de funcionar e ` : ""}o orçamento de{" "}
                          {formatCents(q.current.total_cents)} não pode mais ser aceito nem revisado.
                        </p>
                      }
                      confirmLabel="Sim, cancelar"
                      onConfirm={() => run(async () => {
                        await port.cancel(q.id, newKey());
                        return "Orçamento cancelado. O link deixou de funcionar.";
                      })}
                    />
                  ) : null}
                  <Button variant="ghost" onClick={() => void port.get(q.id).then(setDetail, (e: unknown) => toast({ tone: "danger", message: explain(e) }))}>
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
          <div className="tn-stack">
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
                    <div className="tn-muted">{v.items.map((i) => `${i.quantity}× ${i.description}`).join(", ")} · código {v.snapshot_hash.slice(0, 8)}</div>
                  </div>
                </li>
              ))}
            </ol>
            {cost && cost !== "unavailable" ? (
              <section aria-label="Custo de materiais" className="tn-stack">
                <h3>Materiais da versão {cost.version_no}</h3>
                <p>
                  Custo estimado de materiais <span className="tn-num">{formatCents(cost.material_cost_cents)}</span> · margem estimada{" "}
                  <span className="tn-num">{formatCents(cost.margin_cents)}</span> sobre <span className="tn-num">{formatCents(cost.total_cents)}</span>
                </p>
                {!cost.covered ? (
                  <p className="tn-muted">
                    Sem ficha de uso ou sem custo no estoque: {cost.lines.filter((l) => !l.covered).map((l) => l.description).join(", ")}. Esses itens entram como custo zero na estimativa.
                  </p>
                ) : null}
                <p className="tn-muted">Pela ficha de cada serviço e pelo custo médio do estoque hoje (Materiais). Não muda o preço nem o orçamento.</p>
              </section>
            ) : cost === "unavailable" ? <p className="tn-muted">Custo de materiais indisponível agora.</p> : null}
            <div className="tn-actions"><Button variant="ghost" onClick={() => setDetail(null)}>Fechar</Button></div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// Materiais (P30): estoque com custo médio, compras, fichas de uso por serviço, uso por atendimento e margem real. O que a
// tela promete é o que o banco garante: o uso de um atendimento sai do estoque uma vez, tudo ou nada; o estorno devolve
// exato, uma vez; a margem só é "real" nos atendimentos com uso registrado (os demais aparecem como não cobertos).
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, Help, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { explain, formatCents, formatDate, formatPercent, formatQty, KIND_LABEL, parseBRL, parseNumber, UNIT_LABEL } from "./labels.ts";
import {
  type MarginReport, type MaterialBooking, type MaterialItem, type MaterialPurchase, type MaterialsBase, type MaterialsPort, type MaterialUsage, newKey, type PurchaseLine,
} from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
const DAY = 86_400_000;
const isoOf = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function ItemForm({ port, item, onDone }: { port: MaterialsPort; item: MaterialItem | null; onDone: (n: Notice) => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState<MaterialItem["unit"]>(item?.unit ?? "un");
  const [kind, setKind] = useState<MaterialItem["kind"]>(item?.kind ?? "consumable");
  const [min, setMin] = useState(item?.min_qty != null ? String(item.min_qty).replace(".", ",") : "");
  const [active, setActive] = useState(item?.active ?? true);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = await port.saveItem({ item_id: item?.id ?? null, expected_version: item?.version ?? null, name: name.trim(), unit, kind, active,
        min_qty: min.trim() ? parseNumber(min) : null }, newKey());
      onDone({ tone: "success", text: item ? `“${saved.name}” atualizado.` : `“${saved.name}” cadastrado. O estoque entra pelas compras.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-mt-form" aria-label={item ? `Editar ${item.name}` : "Novo item"} onSubmit={(e) => void submit(e)}>
      <label className="tn-mt-field">Nome<input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="tn-mt-field">Unidade
        <select value={unit} onChange={(e) => setUnit(e.target.value as MaterialItem["unit"])}>
          {(["un", "ml", "g"] as const).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]} ({u})</option>)}
        </select>
      </label>
      <label className="tn-mt-field">Tipo
        <select value={kind} onChange={(e) => setKind(e.target.value as MaterialItem["kind"])}>
          <option value="consumable">Consumível (usado no atendimento)</option>
          <option value="product">Produto (revenda)</option>
        </select>
      </label>
      <label className="tn-mt-field">Avisar abaixo de<input inputMode="decimal" value={min} placeholder="sem aviso" onChange={(e) => setMin(e.target.value)} /></label>
      {item ? <label className="tn-mt-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativo</label> : null}
      <Button type="submit" variant={item ? "secondary" : "primary"} disabled={!name.trim()}>{item ? "Salvar" : "Cadastrar item"}</Button>
    </form>
  );
}

function AdjustForm({ port, item, onDone }: { port: MaterialsPort; item: MaterialItem; onDone: (n: Notice) => void }) {
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const i = await port.adjust(item, parseNumber(counted), reason.trim(), newKey());
      onDone({ tone: "success", text: `Contagem de “${i.name}” ajustada para ${formatQty(i.on_hand, i.unit)}.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-mt-form" aria-label={`Ajustar contagem de ${item.name}`} onSubmit={(e) => void submit(e)}>
      <label className="tn-mt-field">Quantidade contada ({item.unit})<input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></label>
      <label className="tn-mt-field">Motivo<input maxLength={140} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button type="submit" variant="secondary" disabled={!(parseNumber(counted) >= 0) || !reason.trim()}>Ajustar</Button>
    </form>
  );
}

function PurchaseForm({ port, base, items, onDone }: { port: MaterialsPort; base: MaterialsBase; items: MaterialItem[]; onDone: (n: Notice) => void }) {
  const active = items.filter((i) => i.active);
  const blank = () => ({ item_id: active[0]?.id ?? "", quantity: "", total: "" });
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState([blank()]);
  const [expense, setExpense] = useState(true);
  const [key, setKey] = useState(newKey);
  const set = (n: number, patch: Partial<ReturnType<typeof blank>>) => setLines(lines.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const parsed: PurchaseLine[] = lines.map((l) => ({ item_id: l.item_id, quantity: parseNumber(l.quantity), total_cents: parseBRL(l.total) }));
  const valid = parsed.every((l) => l.item_id && l.quantity > 0 && l.total_cents >= 0) && new Set(parsed.map((l) => l.item_id)).size === parsed.length;
  const total = parsed.reduce((t, l) => t + (Number.isFinite(l.total_cents) ? l.total_cents : 0), 0);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await port.purchase(supplier.trim() || null, base.now, parsed, expense, key);
      setKey(newKey());
      onDone({ tone: "success", text: `Compra de ${formatCents(p.total_cents)} lançada no estoque${p.expense_id ? " e como despesa de materiais no Caixa" : ""}.` });
    } catch (err) {
      setKey(newKey());
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-mt-form" aria-label="Nova compra" onSubmit={(e) => void submit(e)}>
      <label className="tn-mt-field">Fornecedor (opcional)<input maxLength={80} value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
      {lines.map((l, n) => (
        <fieldset key={n} className="tn-mt-fieldset">
          <legend>Item {n + 1}</legend>
          <label className="tn-mt-field">Item
            <select value={l.item_id} onChange={(e) => set(n, { item_id: e.target.value })}>{active.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select>
          </label>
          <label className="tn-mt-field">Quantidade<input inputMode="decimal" value={l.quantity} onChange={(e) => set(n, { quantity: e.target.value })} /></label>
          <label className="tn-mt-field">Valor pago (R$)<input inputMode="decimal" value={l.total} onChange={(e) => set(n, { total: e.target.value })} /></label>
          {lines.length > 1 ? <Button variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== n))}>Tirar item</Button> : null}
        </fieldset>
      ))}
      <div className="tn-mt-actions">
        {lines.length < 30 ? <Button variant="ghost" onClick={() => setLines([...lines, blank()])}>Mais um item</Button> : null}
      </div>
      <label className="tn-mt-check"><input type="checkbox" checked={expense} onChange={(e) => setExpense(e.target.checked)} /> Lançar como despesa de materiais no Caixa</label>
      <Button type="submit" disabled={!valid}>Registrar compra{valid ? ` de ${formatCents(total)}` : ""}</Button>
    </form>
  );
}

function UsageForm({ port, base, items, usage, onDone }: { port: MaterialsPort; base: MaterialsBase; items: MaterialItem[]; usage: MaterialUsage[]; onDone: (n: Notice) => void }) {
  const [serviceId, setServiceId] = useState(base.services[0]?.id ?? "");
  const [itemId, setItemId] = useState(items.find((i) => i.active)?.id ?? "");
  const [qty, setQty] = useState("");
  const item = (iid: string) => items.find((i) => i.id === iid);
  const save = (sid: string, iid: string, q: number | null) =>
    port.saveUsage(sid, iid, q, newKey()).then(() => onDone({ tone: "success", text: q === null ? "Item tirado da ficha." : "Ficha de uso atualizada." }),
      (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  return (
    <>
      {base.services.filter((s) => usage.some((u) => u.service_id === s.id)).map((s) => (
        <div key={s.id} className="tn-mt-item">
          <h3>{s.name}</h3>
          <ul className="tn-mt-list" aria-label={`Ficha de ${s.name}`}>
            {usage.filter((u) => u.service_id === s.id).map((u) => (
              <li key={u.item_id} className="tn-mt-row">{item(u.item_id)?.name}: {formatQty(u.quantity, item(u.item_id)?.unit ?? "un")}
                <Button variant="ghost" onClick={() => void save(s.id, u.item_id, null)}>Tirar</Button></li>
            ))}
          </ul>
        </div>
      ))}
      <form className="tn-mt-form" aria-label="Item na ficha de uso" onSubmit={(e) => { e.preventDefault(); void save(serviceId, itemId, parseNumber(qty)); }}>
        <label className="tn-mt-field">Serviço
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label className="tn-mt-field">Item
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>{items.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select>
        </label>
        <label className="tn-mt-field">Quantidade por atendimento<input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <Button type="submit" variant="secondary" disabled={!serviceId || !itemId || !(parseNumber(qty) > 0)}>Salvar na ficha</Button>
      </form>
    </>
  );
}

function BookingItem({ b, port, base, onDone }: { b: MaterialBooking; port: MaterialsPort; base: MaterialsBase; onDone: (n: Notice) => void }) {
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone({ tone: "success", text: ok }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  const c = b.consumption;
  return (
    <li className="tn-mt-item">
      <h3>{formatDate(b.starts_at, base.timezone)} · {b.service_name} · {b.customer_name ?? "sem cliente"}</h3>
      {c ? (
        <p>Materiais: {c.lines.map((l) => `${l.item_name} ${formatQty(l.quantity, l.unit)}`).join(", ")} · custo {formatCents(c.cost_cents)}
          {b.agreed_price_cents != null ? ` · margem ${formatCents(b.agreed_price_cents - c.cost_cents)}` : ""}</p>
      ) : <p className="tn-mt-muted">Uso de materiais não registrado{b.has_usage ? "" : " (o serviço não tem ficha)"}.</p>}
      <div className="tn-mt-actions">
        {!c && b.has_usage ? <Button variant="secondary" onClick={() => void act(() => port.consume(b.booking_id, null, newKey()), "Uso registrado pela ficha: saiu do estoque uma vez.")}>Registrar uso pela ficha</Button> : null}
        {c ? <Button variant="ghost" onClick={() => void act(() => port.reverseConsumption(c, newKey()), "Uso estornado: os materiais voltaram ao estoque.")}>Estornar uso</Button> : null}
      </div>
    </li>
  );
}

export function MaterialsPage({ port }: { port: MaterialsPort }) {
  const [base, setBase] = useState<MaterialsBase | null>(null);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [usage, setUsage] = useState<MaterialUsage[]>([]);
  const [bookings, setBookings] = useState<MaterialBooking[] | null>(null);
  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [margin, setMargin] = useState<MarginReport | null>(null);
  const [open, setOpen] = useState<"purchase" | "item" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const b = await port.base();
      const now = Date.parse(b.now);
      const last30 = { starts_at: isoOf(now - 30 * DAY), ends_at: isoOf(now + 60_000) };
      const [l, bk, pu, mg] = await Promise.all([port.list(), port.bookings(last30), port.purchases(last30), port.margin(last30)]);
      if (!alive) return;
      setBase(b);
      setItems(l.items);
      setUsage(l.usage);
      setBookings(bk);
      setPurchases(pu);
      setMargin(mg);
      setError(null);
    })().catch((e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (n: Notice) => {
    setNotice(n);
    if (n?.tone === "success") { setOpen(null); setEditing(null); }
    setNonce((x) => x + 1);
  };

  return (
    <div className="tn-mt">
      <PageHeader id="mt-title" title="Materiais"
        actions={base && items.some((i) => i.active) && open !== "purchase" ? <Button onClick={() => setOpen("purchase")}><Icon name="mais" size={20} />Nova compra</Button> : null} />
      <Help><p>Produtos e consumíveis com estoque e custo médio. As compras entram pelo valor pago (e podem virar despesa no Caixa). Cada serviço tem uma ficha de uso; ao registrar o uso num atendimento concluído, os materiais saem do estoque uma vez, e a margem real aparece. Estornar devolve exatamente o que saiu.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Estoque e atendimentos de exemplo; nada é cobrado nem lançado de verdade.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}

      {open === "purchase" && base ? (
        <Card aria-labelledby="mt-new-purchase">
          <h2 id="mt-new-purchase">Nova compra</h2>
          <PurchaseForm key={`p:${nonce}`} port={port} base={base} items={items} onDone={done} />
          <div className="tn-mt-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
        </Card>
      ) : null}

      <Card aria-labelledby="mt-margin">
        <h2 id="mt-margin">Margem real (últimos 30 dias)</h2>
        {margin && margin.services.length === 0 ? <p className="tn-mt-muted">Nenhum atendimento concluído no período.</p> : null}
        <ul className="tn-mt-list" aria-label="Margem por serviço">
          {margin?.services.map((s) => (
            <li key={s.service_id} className="tn-mt-row"><strong>{s.service_name}</strong>:
              {s.with_materials ? ` ${formatCents(s.covered_revenue_cents)} combinados − ${formatCents(s.material_cost_cents)} em materiais = ${formatCents(s.margin_cents)}${s.margin_bps != null ? ` (${formatPercent(s.margin_bps)})` : ""}` : " sem uso registrado"}
              {" · "}{s.with_materials} de {s.completed} atendimento(s) com materiais</li>
          ))}
        </ul>
        {margin && margin.totals.completed > margin.totals.with_materials ? (
          <p className="tn-mt-muted">{margin.totals.completed - margin.totals.with_materials} atendimento(s) sem uso registrado ficam fora da margem real.</p>
        ) : null}
      </Card>

      <Card aria-labelledby="mt-bookings">
        <h2 id="mt-bookings">Atendimentos concluídos</h2>
        {bookings && bookings.length === 0 ? <p className="tn-mt-muted">Nenhum atendimento concluído nos últimos 30 dias.</p> : null}
        <ul className="tn-mt-list" aria-label="Uso por atendimento">
          {base && bookings?.map((b) => <BookingItem key={`${b.booking_id}:${b.consumption?.id ?? ""}`} b={b} port={port} base={base} onDone={done} />)}
        </ul>
      </Card>

      <Card aria-labelledby="mt-stock">
        <div className="tn-mt-head">
          <h2 id="mt-stock">Estoque</h2>
          {open !== "item" ? <Button variant="secondary" onClick={() => setOpen("item")}><Icon name="mais" size={20} />Novo item</Button> : null}
        </div>
        {open === "item" ? (
          <div className="tn-mt-new">
            <ItemForm key={`i:${nonce}`} port={port} item={null} onDone={done} />
            <div className="tn-mt-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
          </div>
        ) : null}
        {items.length === 0 ? <p className="tn-mt-muted">Cadastre o primeiro item em “Novo item”.</p> : null}
        <ul className="tn-mt-list" aria-label="Itens em estoque">
          {items.map((i) => (
            <li key={i.id} className="tn-mt-item">
              <p><strong>{i.name}</strong>{i.active ? "" : " (inativo)"} · {KIND_LABEL[i.kind]} · {formatQty(i.on_hand, i.unit)} · {formatCents(i.stock_value_cents)}
                {i.unit_cost_cents != null ? ` · custo médio ${formatCents(i.unit_cost_cents)}/${i.unit}` : ""}{i.low_stock ? " · abaixo do mínimo" : ""}</p>
              <div className="tn-mt-actions"><Button variant="ghost" onClick={() => setEditing(editing === i.id ? null : i.id)}>{editing === i.id ? "Fechar" : "Editar ou contar"}</Button></div>
              {editing === i.id ? <><ItemForm port={port} item={i} onDone={done} /><AdjustForm port={port} item={i} onDone={done} /></> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="mt-usage">
        <h2 id="mt-usage">Fichas de uso</h2>
        {base && items.some((i) => i.active) ? <UsageForm key={`u:${nonce}`} port={port} base={base} items={items} usage={usage} onDone={done} /> : <p className="tn-mt-muted">Cadastre itens para montar as fichas.</p>}
      </Card>

      <Card aria-labelledby="mt-purchases">
        <h2 id="mt-purchases">Compras (últimos 30 dias)</h2>
        {purchases.length === 0 ? <p className="tn-mt-muted">Nenhuma compra no período.</p> : null}
        <ul className="tn-mt-list" aria-label="Compras">
          {base && purchases.map((p) => (
            <li key={p.id} className="tn-mt-row">
              {formatDate(p.purchased_at, base.timezone)} · {p.supplier ?? "sem fornecedor"} · {formatCents(p.total_cents)} · {p.lines.map((l) => `${l.item_name} ${formatQty(l.quantity, l.unit)}`).join(", ")}
              {p.status === "reversed" ? " · estornada" : (
                <Button variant="ghost" onClick={() => void port.reversePurchase(p, newKey()).then(() => done({ tone: "success", text: "Compra estornada: saiu do estoque pelo custo médio." }), (e: unknown) => done({ tone: "danger", text: explain(e) }))}>Estornar compra</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

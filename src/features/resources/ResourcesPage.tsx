// Equipe (P28): profissionais, salas, cadeiras e equipamentos; reserva composta; turmas; comissões. O que a tela promete é
// o que o banco garante: a reserva prende a profissional e todos os recursos juntos ou nenhum; a comissão fica congelada
// na reserva e é lançada uma vez ao concluir; concluir abre a cobrança no Caixa (não é receber).
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import {
  BOOKING_STATUS, CLASS_STATUS, explain, formatCents, formatDay, formatPercent, formatTime, KIND_LABEL, KIND_PLURAL, localDate, localInstant, localMidnight, SEAT_STATUS,
} from "./labels.ts";
import {
  newKey, type ResourcesPort, type TeamBase, type TeamBooking, type TeamClass, type TeamCommissionRule, type TeamCommissions, type TeamResource, type TimeRange,
} from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string; undo?: () => void } | null;
const KINDS = ["professional", "room", "chair", "equipment"] as const;
const parsePercent = (v: string) => (v.trim() === "" ? null : Math.round(Number(v.replace(",", ".")) * 100));
const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
const plusDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

function ResourceForm({ port, resource, onDone }: { port: ResourcesPort; resource: TeamResource | null; onDone: (n: Notice) => void }) {
  const [kind, setKind] = useState<TeamResource["kind"]>(resource?.kind ?? "professional");
  const [name, setName] = useState(resource?.name ?? "");
  const [pct, setPct] = useState(resource?.commission_bps != null ? String(resource.commission_bps / 100).replace(".", ",") : "");
  const [linked, setLinked] = useState(resource?.agenda_linked ?? false);
  const [active, setActive] = useState(resource?.active ?? true);
  const pro = kind === "professional";
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"name" | "pct">();
  const pctBad = pro && pct.trim() !== "" && !(parsePercent(pct)! >= 0 && parsePercent(pct)! <= 10000);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({ name: name.trim() ? null : "Informe o nome.", pct: pctBad ? "Use um número de 0 a 100." : null })) return;
    setBusy(true);
    try {
      const saved = await port.save({ resource_id: resource?.id ?? null, expected_version: resource?.version ?? null, kind, name: name.trim(), active,
        commission_bps: pro ? parsePercent(pct) : null, agenda_linked: pro && linked }, newKey());
      onDone({ tone: "success", text: resource ? `${KIND_LABEL[saved.kind]} “${saved.name}” atualizado.` : `${KIND_LABEL[saved.kind]} “${saved.name}” cadastrado.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} noValidate className="tn-rs-form" aria-label={resource ? `Editar ${resource.name}` : "Novo recurso"} onSubmit={(e) => void submit(e)}>
      {!resource ? (
        <Field as="select" label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as TeamResource["kind"])}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Field>
      ) : null}
      <Field label="Nome" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      {pro ? (
        <Field label="Comissão padrão (%)" inputMode="decimal" value={pct} placeholder="sem comissão" onChange={(e) => setPct(e.target.value)} error={errors.pct} />
      ) : null}
      {pro ? <label className="tn-rs-check"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} /> É a minha agenda (uma não reserva por cima da outra)</label> : null}
      {resource ? <label className="tn-rs-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativo</label> : null}
      <Button type="submit" variant={resource ? "secondary" : "primary"} loading={busy}>{resource ? "Salvar" : "Cadastrar"}</Button>
    </form>
  );
}

function RuleForm({ port, base, pro, rules, onDone }: { port: ResourcesPort; base: TeamBase; pro: TeamResource; rules: TeamCommissionRule[]; onDone: (n: Notice) => void }) {
  const [serviceId, setServiceId] = useState(base.services[0]?.id ?? "");
  const [pct, setPct] = useState("");
  const mine = rules.filter((r) => r.professional_id === pro.id);
  const svcName = (sid: string) => base.services.find((s) => s.id === sid)?.name ?? "serviço";
  const { formRef, errors, show } = useFormErrors<"pct">();
  const save = (bps: number | null, sid: string, undoBps?: number) =>
    port.saveRule(pro.id, sid, bps, newKey()).then(
      () => onDone(bps === null
        ? { tone: "success", text: `Regra de ${svcName(sid)} removida: vale a comissão padrão.`,
            // Remover a regra volta atrás gravando o mesmo percentual de antes.
            undo: undoBps === undefined ? undefined : () => void save(undoBps, sid) }
        : { tone: "success", text: `${pro.name}: ${formatPercent(bps)} em ${svcName(sid)} nas próximas reservas.` }),
      (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  const pctOk = pct.trim() !== "" && parsePercent(pct)! >= 0 && parsePercent(pct)! <= 10000;
  return (
    <div className="tn-rs-rules">
      {mine.length ? (
        <ul className="tn-rs-list" aria-label={`Comissões por serviço de ${pro.name}`}>
          {mine.map((r) => (
            <li key={r.service_id} className="tn-rs-row">{svcName(r.service_id)}: {formatPercent(r.bps)}
              <Button variant="ghost" aria-label={`Remover comissão de ${svcName(r.service_id)}`} onClick={() => void save(null, r.service_id, r.bps)}>Remover</Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form ref={formRef} noValidate className="tn-rs-form" aria-label={`Comissão por serviço de ${pro.name}`}
        onSubmit={(e) => { e.preventDefault(); if (show({ pct: pctOk ? null : "Informe a comissão, de 0 a 100." })) void save(parsePercent(pct), serviceId); }}>
        <Field as="select" label="Serviço" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Field>
        <Field label="Comissão neste serviço (%)" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} error={errors.pct} />
        <Button type="submit" variant="secondary">Salvar comissão</Button>
      </form>
    </div>
  );
}

function BookingForm({ port, base, resources, onDone }: { port: ResourcesPort; base: TeamBase; resources: TeamResource[]; onDone: (n: Notice) => void }) {
  const pros = resources.filter((r) => r.active && r.kind === "professional");
  const others = resources.filter((r) => r.active && r.kind !== "professional");
  const [serviceId, setServiceId] = useState(base.services[0]?.id ?? "");
  const [proId, setProId] = useState(pros[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [day, setDay] = useState(() => localDate(plusDays(base.now, 1), base.timezone));
  const [slots, setSlots] = useState<TimeRange[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const reset = () => { setSlots(null); setSlot(null); setSlotError(null); };
  async function look() {
    try {
      const from = localMidnight(day, base.timezone);
      setSlots(await port.availability(serviceId, proId, picked, { starts_at: from, ends_at: plusDays(from, 1) }));
      setSlot(null);
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  async function book(e: FormEvent) {
    e.preventDefault();
    if (!slot) {
      setSlotError(slots ? "Escolha um dos horários livres." : "Toque em “Ver horários livres” e escolha um horário.");
      return;
    }
    setBusy(true);
    try {
      const b = await port.book({ service_id: serviceId, professional_id: proId, resource_ids: picked, customer_id: customerId || null, starts_at: slot }, key);
      setKey(newKey());
      reset();
      onDone({ tone: "success", text: `Reservado: ${b.service_name} com ${b.resources.map((r) => r.name).join(" + ")}, ${formatDay(b.starts_at, base.timezone)} às ${formatTime(b.starts_at, base.timezone)}. Comissão de ${formatPercent(b.commission_bps)} congelada.` });
    } catch (err) {
      setKey(newKey());
      reset();
      onDone({ tone: "danger", text: explain(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="tn-rs-form" aria-label="Nova reserva da equipe" onSubmit={(e) => void book(e)}>
      <Field as="select" label="Serviço" value={serviceId} onChange={(e) => { setServiceId(e.target.value); reset(); }}>
          {base.services.map((s) => <option key={s.id} value={s.id}>{s.name} · {formatCents(s.base_price_cents)}</option>)}
        </Field>
      <Field as="select" label="Profissional" value={proId} onChange={(e) => { setProId(e.target.value); reset(); }}>
          {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Field>
      <Field as="select" label="Cliente" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Sem cliente cadastrada</option>
          {base.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Field>
      <Field label="Dia" type="date" value={day} onChange={(e) => { setDay(e.target.value); reset(); }} />
      {others.length ? (
        <fieldset className="tn-rs-fieldset">
          <legend>Recursos junto (até 4)</legend>
          {others.map((r) => (
            <label key={r.id} className="tn-rs-check">
              <input type="checkbox" checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= 4}
                onChange={(e) => { setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id)); reset(); }} />
              {KIND_LABEL[r.kind]}: {r.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="tn-actions">
        <Button type="button" variant="secondary" disabled={!serviceId || !proId || !day} onClick={() => void look()}>Ver horários livres</Button>
      </div>
      {slots ? (
        slots.length === 0 ? <p className="tn-muted">Nenhum horário com a profissional e todos os recursos livres neste dia.</p> : (
          <div className="tn-rs-slots" role="group" aria-label="Horários livres">
            {slots.slice(0, 48).map((s) => (
              <Button key={s.starts_at} type="button" variant={slot === s.starts_at ? "primary" : "ghost"} aria-pressed={slot === s.starts_at} onClick={() => { setSlot(s.starts_at); setSlotError(null); }}>
                {formatTime(s.starts_at, base.timezone)}
              </Button>
            ))}
          </div>
        )
      ) : null}
      {slotError ? <p className="tn-field__error" role="alert">{slotError}</p> : null}
      <Button type="submit" loading={busy}>{slot ? `Reservar às ${formatTime(slot, base.timezone)}` : "Reservar"}</Button>
    </form>
  );
}

function BookingItem({ b, port, base, onDone }: { b: TeamBooking; port: ResourcesPort; base: TeamBase; onDone: (n: Notice) => void }) {
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone({ tone: "success", text: ok }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  const started = Date.parse(b.starts_at) <= Date.parse(base.now);
  return (
    <li className="tn-rs-item">
      <h3>{formatDay(b.starts_at, base.timezone)} {formatTime(b.starts_at, base.timezone)} · {b.service_name} · {b.professional_name}</h3>
      <p><strong>{BOOKING_STATUS[b.status]}</strong> · {b.resources.filter((r) => r.kind !== "professional").map((r) => r.name).join(", ") || "sem recursos extras"}
        {" · "}{b.customer_name ?? "sem cliente"} · {formatCents(b.agreed_price_cents)} · comissão {formatPercent(b.commission_bps)}
        {b.status === "completed" ? ` (${formatCents(b.commission_cents)} lançada; cobrança no Caixa)` : ""}</p>
      {b.status === "confirmed" ? (
        <div className="tn-actions">
          {started ? <Button variant="secondary" onClick={() => void act(() => port.completeBooking(b, newKey()), `Concluída. Cobrança de ${formatCents(b.agreed_price_cents)} aberta no Caixa e comissão lançada.`)}>Concluir</Button> : null}
          <ConfirmAction trigger="Cancelar" triggerLabel={`Cancelar a reserva de ${b.service_name} com ${b.professional_name}`}
            title={`Cancelar ${b.service_name} com ${b.professional_name}?`}
            consequence={`${b.customer_name ?? "O horário"} das ${formatTime(b.starts_at, base.timezone)} sai da agenda e a profissional e os recursos ficam livres. Não dá para desfazer.`}
            confirmLabel="Sim, cancelar" onConfirm={() => act(() => port.cancelBooking(b, null, newKey()), "Reserva cancelada: a profissional e todos os recursos foram liberados.")} />
        </div>
      ) : null}
    </li>
  );
}

function ClassForm({ port, base, resources, onDone }: { port: ResourcesPort; base: TeamBase; resources: TeamResource[]; onDone: (n: Notice) => void }) {
  const pros = resources.filter((r) => r.active && r.kind === "professional");
  const rooms = resources.filter((r) => r.active && r.kind === "room");
  const [title, setTitle] = useState("");
  const [serviceId, setServiceId] = useState(base.services[0]?.id ?? "");
  const [proId, setProId] = useState(pros[0]?.id ?? "");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [day, setDay] = useState(() => localDate(plusDays(base.now, 1), base.timezone));
  const [time, setTime] = useState("10:00");
  const [capacity, setCapacity] = useState("6");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"title" | "pro" | "capacity">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!show({
      title: title.trim() ? null : "Informe o título da turma.",
      pro: proId ? null : "Cadastre uma profissional antes.",
      capacity: Number(capacity) >= 1 && Number(capacity) <= 200 ? null : "Use de 1 a 200 vagas.",
    })) return;
    setBusy(true);
    try {
      const c = await port.createClass({ title: title.trim(), service_id: serviceId, professional_id: proId, room_id: roomId || null, starts_at: localInstant(day, time, base.timezone),
        capacity: Number(capacity), seat_price_cents: price.trim() ? parseBRL(price) : null }, newKey());
      onDone({ tone: "success", text: `Turma “${c.title}” criada com ${c.professional_name}${c.room_name ? ` na ${c.room_name}` : ""}: ${c.capacity} vagas.` });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} noValidate className="tn-rs-form" aria-label="Nova turma" onSubmit={(e) => void submit(e)}>
      <Field label="Título" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <Field as="select" label="Serviço" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{base.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Field>
      <Field as="select" label="Profissional" value={proId} onChange={(e) => setProId(e.target.value)} error={errors.pro}>{pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Field>
      <Field as="select" label="Sala" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Sem sala</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Field>
      <Field label="Dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      <Field label="Início" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
      <Field label="Vagas" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} error={errors.capacity} />
      <Field label="Preço por vaga (R$)" inputMode="decimal" placeholder="preço do serviço" value={price} onChange={(e) => setPrice(e.target.value)} />
      <Button type="submit" loading={busy}>Criar turma</Button>
    </form>
  );
}

function ClassItem({ c, port, base, onDone }: { c: TeamClass; port: ResourcesPort; base: TeamBase; onDone: (n: Notice) => void }) {
  const [customerId, setCustomerId] = useState(base.customers[0]?.id ?? "");
  const [present, setPresent] = useState<string[]>([]);
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone({ tone: "success", text: ok }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  const live = c.seats.filter((s) => s.status !== "cancelled");
  const started = Date.parse(c.starts_at) <= Date.parse(base.now);
  return (
    <li className="tn-rs-item">
      <h3>{c.title} · {formatDay(c.starts_at, base.timezone)} {formatTime(c.starts_at, base.timezone)}</h3>
      <p><strong>{CLASS_STATUS[c.status]}</strong> · {c.professional_name}{c.room_name ? ` · ${c.room_name}` : ""} · {c.booked} de {c.capacity} vagas · {formatCents(c.seat_price_cents)} por vaga
        {c.status === "completed" ? ` · comissão ${formatCents(c.commission_cents)}` : ""}</p>
      {live.length ? (
        <ul className="tn-rs-list" aria-label={`Vagas de ${c.title}`}>
          {live.map((s) => (
            <li key={s.id} className="tn-rs-row">
              {c.status === "scheduled" && started ? (
                <label className="tn-rs-check"><input type="checkbox" checked={present.includes(s.id)} onChange={(e) => setPresent(e.target.checked ? [...present, s.id] : present.filter((x) => x !== s.id))} />
                  {s.customer_name} esteve presente</label>
              ) : <span>{s.customer_name} · {SEAT_STATUS[s.status]}</span>}
              {c.status === "scheduled" && s.status === "booked" && !started ? (
                <Button variant="ghost" aria-label={`Liberar a vaga de ${s.customer_name}`} onClick={() => void port.cancelSeat(s.id, s.version, newKey()).then(
                  // A vaga volta inscrevendo a mesma cliente de novo (se ainda houver lugar).
                  () => onDone({ tone: "success", text: `Vaga de ${s.customer_name} liberada.`, undo: () => void act(() => port.enroll(c.id, s.customer_id, newKey()), `${s.customer_name} voltou para a turma.`) }),
                  (e: unknown) => onDone({ tone: "danger", text: explain(e) }))}>Liberar vaga</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {c.status === "scheduled" ? (
        <div className="tn-actions">
          {!started ? (
            <>
              <Field as="select" label="Inscrever cliente" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{base.customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Field>
              <Button variant="secondary" onClick={() => void act(() => port.enroll(c.id, customerId, newKey()), "Vaga reservada.")}>Inscrever</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => void act(() => port.completeClass(c, present, newKey()), `Turma concluída: ${present.length} presença(s) com cobrança no Caixa; as demais viraram falta.`)}>Concluir turma</Button>
          )}
          <ConfirmAction trigger="Cancelar turma" triggerLabel={`Cancelar a turma ${c.title}`} title={`Cancelar a turma “${c.title}”?`}
            consequence={`${live.length ? `As ${live.length} vagas reservadas são canceladas. ` : ""}A profissional e a sala ficam livres. Não dá para desfazer.`}
            confirmLabel="Sim, cancelar turma" onConfirm={() => act(() => port.cancelClass(c, newKey()), "Turma cancelada: profissional e sala liberadas, vagas canceladas.")} />
        </div>
      ) : null}
    </li>
  );
}

export function ResourcesPage({ port }: { port: ResourcesPort }) {
  const [base, setBase] = useState<TeamBase | null>(null);
  const [resources, setResources] = useState<TeamResource[]>([]);
  const [rules, setRules] = useState<TeamCommissionRule[]>([]);
  const [agenda, setAgenda] = useState<{ bookings: TeamBooking[]; classes: TeamClass[] } | null>(null);
  const [commissions, setCommissions] = useState<TeamCommissions | null>(null);
  const [open, setOpen] = useState<"booking" | "class" | "resource" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const b = await port.base();
      const today = localMidnight(localDate(b.now, b.timezone), b.timezone);
      const monthStart = localMidnight(`${localDate(b.now, b.timezone).slice(0, 8)}01`, b.timezone);
      const [l, s, c] = await Promise.all([port.list(), port.schedule({ starts_at: plusDays(today, -1), ends_at: plusDays(today, 8) }),
        port.commissions({ starts_at: monthStart, ends_at: plusDays(today, 1) })]);
      if (!alive) return;
      setBase(b);
      setResources(l.resources);
      setRules(l.commission_rules);
      setAgenda(s);
      setCommissions(c);
      setError(null);
    })().catch((e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  // Retorno das ações no Toast (sempre à vista, acima da barra de abas), com Desfazer quando a ação volta atrás.
  const done = (n: Notice) => {
    if (n) toast({ message: n.text, tone: n.tone, action: n.undo ? { label: "Desfazer", onAction: n.undo } : undefined });
    if (n?.tone === "success") { setOpen(null); setEditing(null); }
    setNonce((x) => x + 1);
  };
  const byKind = useMemo(() => KINDS.map((k) => [k, resources.filter((r) => r.kind === k)] as const), [resources]);
  const hasPro = resources.some((r) => r.active && r.kind === "professional");

  return (
    <div className="tn-rs">
      <PageHeader id="rs-title" title="Equipe"
        actions={base && hasPro && open !== "booking" ? <Button onClick={() => setOpen("booking")}><Icon name="mais" size={20} />Nova reserva</Button> : null} />
      <Help><p>Profissionais, salas, cadeiras e equipamentos do seu negócio. Uma reserva prende a profissional e todos os recursos juntos: se um deles estiver ocupado, nada é reservado. A comissão fica congelada na reserva e é lançada uma vez ao concluir; concluir abre a cobrança no Caixa.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Equipe e horários de exemplo; nada é cobrado nem enviado.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}

      {open === "booking" && base ? (
        <Card aria-labelledby="rs-new-booking">
          <h2 id="rs-new-booking">Nova reserva da equipe</h2>
          <BookingForm key={`b:${nonce}`} port={port} base={base} resources={resources} onDone={done} />
          <div className="tn-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
        </Card>
      ) : null}

      <Card aria-labelledby="rs-agenda">
        <h2 id="rs-agenda">Agenda da equipe</h2>
        {agenda && agenda.bookings.length === 0 ? <p className="tn-muted">Nenhuma reserva da equipe nos próximos dias.</p> : null}
        <ul className="tn-rs-list" aria-label="Reservas da equipe">
          {base && agenda?.bookings.map((b) => <BookingItem key={b.id} b={b} port={port} base={base} onDone={done} />)}
        </ul>
      </Card>

      <Card aria-labelledby="rs-classes">
        <div className="tn-rs-head">
          <h2 id="rs-classes">Turmas</h2>
          {base && hasPro && open !== "class" ? <Button variant="secondary" onClick={() => setOpen("class")}><Icon name="mais" size={20} />Nova turma</Button> : null}
        </div>
        {open === "class" && base ? (
          <div className="tn-rs-new">
            <ClassForm key={`c:${nonce}`} port={port} base={base} resources={resources} onDone={done} />
            <div className="tn-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
          </div>
        ) : null}
        {agenda && agenda.classes.length === 0 ? <p className="tn-muted">Nenhuma turma nos próximos dias.</p> : null}
        <ul className="tn-rs-list" aria-label="Turmas">
          {base && agenda?.classes.map((c) => <ClassItem key={`${c.id}:${c.version}`} c={c} port={port} base={base} onDone={done} />)}
        </ul>
      </Card>

      <Card aria-labelledby="rs-team">
        <div className="tn-rs-head">
          <h2 id="rs-team">Equipe e recursos</h2>
          {open !== "resource" ? <Button variant="secondary" onClick={() => setOpen("resource")}><Icon name="mais" size={20} />Novo recurso</Button> : null}
        </div>
        {open === "resource" ? (
          <div className="tn-rs-new">
            <ResourceForm key={`r:${nonce}`} port={port} resource={null} onDone={done} />
            <div className="tn-actions"><Button variant="ghost" onClick={() => setOpen(null)}>Fechar</Button></div>
          </div>
        ) : null}
        {resources.length === 0 ? <p className="tn-muted">Cadastre a primeira profissional em “Novo recurso”.</p> : null}
        {byKind.filter(([, list]) => list.length).map(([k, list]) => (
          <section key={k} aria-label={KIND_PLURAL[k]}>
            <h3 className="tn-rs-kind">{KIND_PLURAL[k]}</h3>
            <ul className="tn-rs-list" aria-label={`Lista de ${KIND_PLURAL[k].toLowerCase()}`}>
              {list.map((r) => (
                <li key={r.id} className="tn-rs-item">
                  <p><strong>{r.name}</strong>{r.active ? "" : " (inativo)"}
                    {r.kind === "professional" ? ` · comissão padrão ${r.commission_bps != null ? formatPercent(r.commission_bps) : "nenhuma"}` : ""}
                    {r.agenda_linked ? " · vinculada à sua agenda" : ""}</p>
                  <div className="tn-actions"><Button variant="ghost" onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? "Fechar" : "Editar"}</Button></div>
                  {editing === r.id ? (
                    <>
                      <ResourceForm port={port} resource={r} onDone={done} />
                      {r.kind === "professional" && base ? <RuleForm port={port} base={base} pro={r} rules={rules} onDone={done} /> : null}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Card>

      <Card aria-labelledby="rs-commissions">
        <h2 id="rs-commissions">Comissões do mês</h2>
        {commissions && commissions.professionals.length === 0 ? <p className="tn-muted">Nenhuma comissão lançada neste mês. Ela entra quando um atendimento ou turma é concluído.</p> : null}
        <ul className="tn-rs-list" aria-label="Comissões por profissional">
          {commissions?.professionals.map((p) => (
            <li key={p.professional_id} className="tn-rs-row"><strong>{p.professional_name}</strong>: {formatCents(p.net_cents)} a pagar
              {p.reversed_cents ? ` (${formatCents(p.accrued_cents)} lançados, ${formatCents(-p.reversed_cents)} estornados)` : ""} sobre {formatCents(p.base_cents)} atendidos</li>
          ))}
        </ul>
        {commissions?.entries.length ? (
          <ul className="tn-rs-list" aria-label="Lançamentos de comissão">
            {commissions.entries.map((e) => (
              <li key={e.id} className="tn-rs-row">
                {e.kind === "accrual" ? "Lançada" : "Estorno"} · {e.professional_name} · {formatCents(e.amount_cents)} ({formatPercent(e.bps)} de {formatCents(e.base_cents)})
                {e.kind === "accrual" && !e.reversed ? (
                  <ConfirmAction trigger="Estornar" triggerLabel={`Estornar a comissão de ${e.professional_name}`}
                    title={`Estornar ${formatCents(e.amount_cents)} de comissão de ${e.professional_name}?`}
                    consequence="Sai do valor a pagar no mês. O lançamento original continua no histórico."
                    confirmLabel="Sim, estornar" onConfirm={() => port.reverseCommission(e.id, newKey()).then(() => done({ tone: "success", text: "Comissão estornada." }), (x: unknown) => done({ tone: "danger", text: explain(x) }))} />
                ) : null}
                {e.reversed ? " · estornada" : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

// Domicílio (P29): área de atendimento por zona (bairro e CEP de 5 dígitos), deslocamento que ocupa a agenda, janela de
// chegada para o cliente e roteiro do dia em ordem. O que a tela promete é o que o banco garante: o deslocamento vira
// bloqueio da agenda; se não der tempo de chegar, nada muda. Localização só como zona e CEP de 5 dígitos: sem endereço,
// sem mapa, sem rastreamento. Contratação pelo marketplace (P25) fica fora.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, Segmented, ShareActions, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { plural } from "../../lib/text/plural.ts";
import { addDays, arrivalMessage, cep5Of, dayLabel, explain, hhmm, minutes, parseNumber, parsePrefixes } from "./labels.ts";
import { type FieldConfig, type FieldPort, type FieldRoute, type FieldStop, type FieldZone, newKey } from "./port.ts";

type Tab = "route" | "zones" | "rules";
const fail = (err: unknown) => toast({ tone: "danger", message: explain(err) });

function StopItem({ stop, route, port, onChange }: { stop: FieldStop; route: FieldRoute; port: FieldPort; onChange: () => void }) {
  const tz = route.timezone;
  const [share, setShare] = useState(false);
  async function detach() {
    try {
      await port.detach(stop.booking_id, newKey());
      onChange();
      toast({ message: `${stop.customer_name ?? "Atendimento"} saiu do roteiro; o deslocamento foi solto na agenda.`, action: { label: "Desfazer", onAction: async () => {
        try {
          await port.attach(stop.booking_id, stop.zone_id, stop.cep5, newKey());
          toast("Visita de volta ao roteiro.");
        } catch (err) {
          fail(err);
        }
        onChange();
      } } });
    } catch (err) {
      fail(err);
    }
  }
  return (
    <li className="tn-fs-stop">
      <h3>{hhmm(stop.starts_at, tz)} · {stop.customer_name ?? "Cliente"} · {stop.zone_name}</h3>
      <p className="tn-fs-travel">
        {stop.travel_min === null ? "Deslocamento: recalcular" : stop.travel_min === 0 ? "Sem deslocamento" : `Sair ${stop.depart_at ? `às ${hhmm(stop.depart_at, tz)}` : ""} · ${minutes(stop.travel_min)} de deslocamento`}
        {stop.cep5 ? ` · CEP ${stop.cep5}-…` : ""}
      </p>
      <p className="tn-fs-window">Chegada entre {hhmm(stop.arrival_from, tz)} e {hhmm(stop.arrival_to, tz)}</p>
      <p className="tn-muted">{stop.service_name ?? "Serviço"} das {hhmm(stop.starts_at, tz)} às {hhmm(stop.ends_at, tz)}{stop.status === "completed" ? " · concluído" : ""}</p>
      <div className="tn-actions">
        <Button variant="secondary" onClick={() => setShare((v) => !v)} aria-expanded={share}>Avisar a janela</Button>
        <ConfirmAction trigger="Tirar do domicílio" triggerLabel={`Tirar ${stop.customer_name ?? "atendimento"} do domicílio`} title="Tirar do domicílio?"
          consequence="O atendimento continua na agenda; só o deslocamento sai e o horário dele fica livre." confirmLabel="Tirar" onConfirm={detach} />
      </div>
      {share ? <ShareActions message={arrivalMessage(stop, route.day, tz)} copyText={arrivalMessage(stop, route.day, tz)} copyLabel="Copiar mensagem" /> : null}
    </li>
  );
}

function AttachForm({ port, config, booking, onDone }: { port: FieldPort; config: FieldConfig; booking: FieldRoute["bookings"][number]; onDone: () => void }) {
  const zones = config.zones.filter((z) => z.in_area);
  const [cep, setCep] = useState("");
  const [zone, setZone] = useState(zones[0]?.id ?? "");
  const [hint, setHint] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"cep" | "zone">();
  async function lookup(v: string) {
    setCep(v);
    const c5 = cep5Of(v);
    if (!c5) return setHint(undefined);
    try {
      const r = await port.zoneFor(v);
      if (r.zone && r.in_area) {
        setZone(r.zone.id);
        setHint(`CEP ${r.cep5}: ${r.zone.name}.`);
      } else setHint(r.zone ? `CEP ${r.cep5}: ${r.zone.name}, fora da área.` : `CEP ${r.cep5} não está em nenhuma zona.`);
    } catch {
      setHint(undefined);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = show({ cep: cep.trim() !== "" && !cep5Of(cep) && "CEP com pelo menos 5 dígitos (ex.: 01310-100).", zone: !zone && "Escolha a zona." });
    if (!ok) return;
    setBusy(true);
    try {
      const s = await port.attach(booking.booking_id, zone, cep5Of(cep), newKey());
      toast(`${booking.customer_name ?? "Atendimento"} a domicílio: chegada entre ${hhmm(s.arrival_from, config.timezone)} e ${hhmm(s.arrival_to, config.timezone)}.`);
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  if (zones.length === 0) return <p className="tn-muted">Cadastre uma zona dentro da área para marcar visitas.</p>;
  return (
    <form ref={formRef} className="tn-fs-form" aria-label={`Marcar ${booking.customer_name ?? "atendimento"} como domicílio`} onSubmit={(e) => void submit(e)} noValidate>
      <Field label="CEP (opcional)" inputMode="numeric" value={cep} maxLength={9} error={errors.cep} hint={hint ?? "Só os 5 primeiros dígitos são guardados."}
        onChange={(e) => void lookup(e.target.value)} />
      <Field as="select" label="Zona" value={zone} error={errors.zone} onChange={(e) => setZone(e.target.value)}>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
      </Field>
      <Button type="submit" disabled={busy}>Marcar domicílio</Button>
    </form>
  );
}

function RouteTab({ port, config }: { port: FieldPort; config: FieldConfig }) {
  const [day, setDay] = useState(port.today());
  const [route, setRoute] = useState<FieldRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    port.route(day).then((r) => { setRoute(r); setError(null); }, (err) => setError(explain(err)));
  }, [port, day]);
  useEffect(load, [load]);
  async function rebuild() {
    try {
      const n = await port.rebuild(day, newKey());
      toast(`Deslocamentos recalculados: ${plural(n, "visita", "visitas")}.`);
    } catch (err) {
      fail(err);
    }
    load();
  }
  const others = route?.bookings.filter((b) => !b.is_visit) ?? [];
  return (
    <>
      <div className="tn-fs-day">
        <Field label="Dia" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <Button variant="secondary" onClick={() => setDay(addDays(day, -1))}>Dia anterior</Button>
        <Button variant="secondary" onClick={() => setDay(addDays(day, 1))}>Próximo dia</Button>
      </div>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      {route?.needs_rebuild ? (
        <StatusBanner tone="warning">
          Um atendimento mudou na agenda e os deslocamentos precisam ser recalculados. <Button variant="secondary" onClick={() => void rebuild()}>Recalcular deslocamentos</Button>
        </StatusBanner>
      ) : null}
      <Card aria-labelledby="fs-route-title">
        <h2 id="fs-route-title">Roteiro de {dayLabel(day)}</h2>
        {route && route.stops.length > 0 ? (
          <ol className="tn-fs-route" aria-label="Visitas em ordem">
            {route.stops.map((s) => <StopItem key={s.visit_id} stop={s} route={route} port={port} onChange={load} />)}
          </ol>
        ) : <p className="tn-muted">{route ? "Nenhuma visita a domicílio neste dia." : "Carregando…"}</p>}
      </Card>
      <Card aria-labelledby="fs-others-title">
        <h2 id="fs-others-title">Atendimentos do dia no salão</h2>
        <p className="tn-muted">Marque como domicílio: o deslocamento entra na agenda antes do horário e o cliente recebe a janela de chegada.</p>
        {others.length === 0 ? <p className="tn-muted">Nenhum outro atendimento neste dia.</p> : (
          <ul className="tn-fs-list">
            {others.map((b) => (
              <li key={b.booking_id} className="tn-fs-item">
                <h3>{hhmm(b.starts_at, config.timezone)} · {b.customer_name ?? "Cliente"} · {b.service_name ?? "Serviço"}</h3>
                <AttachForm port={port} config={config} booking={b} onDone={load} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function ZoneForm({ port, zone, onDone }: { port: FieldPort; zone: FieldZone | null; onDone: () => void }) {
  const [name, setName] = useState(zone?.name ?? "");
  const [ceps, setCeps] = useState(zone?.cep_prefixes.join(", ") ?? "");
  const [km, setKm] = useState(zone ? String(zone.distance_km).replace(".", ",") : "");
  const [base, setBase] = useState(zone ? String(zone.travel_from_base_min) : "");
  const [active, setActive] = useState(zone?.active ?? true);
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"name" | "ceps" | "km" | "base">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const prefixes = parsePrefixes(ceps);
    const distance = parseNumber(km);
    const minutesFromBase = parseNumber(base);
    const ok = show({
      name: !name.trim() && "Dê um nome à zona (ex.: o bairro).",
      ceps: prefixes === null && "Use CEPs com 5 dígitos (ou o CEP inteiro), separados por vírgula.",
      km: !(distance >= 0 && distance <= 200) && "Distância aproximada da base, de 0 a 200 km.",
      base: !(Number.isInteger(minutesFromBase) && minutesFromBase >= 0 && minutesFromBase <= 240) && "Minutos da base até a zona, de 0 a 240.",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const z = await port.saveZone({ zone_id: zone?.id ?? null, expected_version: zone?.version ?? null, name: name.trim(), cep_prefixes: prefixes!, distance_km: distance,
        travel_from_base_min: minutesFromBase, active }, newKey());
      toast(z.in_area ? `Zona “${z.name}” salva, dentro da área.` : `Zona “${z.name}” salva, fora da área: visitas nela são recusadas.`);
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-fs-form" aria-label={zone ? `Editar ${zone.name}` : "Nova zona"} onSubmit={(e) => void submit(e)} noValidate>
      <Field label="Nome (bairro ou região)" value={name} maxLength={60} error={errors.name} onChange={(e) => setName(e.target.value)} />
      <Field label="CEPs (5 dígitos)" value={ceps} error={errors.ceps} hint="Ex.: 01310, 01311" onChange={(e) => setCeps(e.target.value)} />
      <Field label="Distância da base (km)" inputMode="decimal" value={km} error={errors.km} onChange={(e) => setKm(e.target.value)} />
      <Field label="Minutos da base" inputMode="numeric" value={base} error={errors.base} onChange={(e) => setBase(e.target.value)} />
      <label className="tn-fs-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Atendo nesta zona</label>
      <Button type="submit" disabled={busy}>{zone ? "Salvar zona" : "Criar zona"}</Button>
    </form>
  );
}

function TravelForm({ port, config, onDone }: { port: FieldPort; config: FieldConfig; onDone: () => void }) {
  const [a, setA] = useState(config.zones[0]?.id ?? "");
  const [b, setB] = useState(config.zones[1]?.id ?? "");
  const [min, setMin] = useState("");
  const { formRef, errors, show } = useFormErrors<"b" | "min">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = min.trim() === "" ? null : parseNumber(min);
    if (!show({ b: a === b && "Escolha duas zonas diferentes.", min: m !== null && !(Number.isInteger(m) && m >= 0 && m <= 240) && "Minutos de 0 a 240 (vazio volta ao padrão)." })) return;
    try {
      await port.saveTravel(a, b, m, newKey());
      toast(m === null ? "Tempo entre as zonas voltou ao padrão." : `Tempo entre as zonas: ${minutes(m)}.`);
      onDone();
    } catch (err) {
      fail(err);
    }
  }
  if (config.zones.length < 2) return null;
  return (
    <form ref={formRef} className="tn-fs-form" aria-label="Tempo entre zonas" onSubmit={(e) => void submit(e)} noValidate>
      <Field as="select" label="De" value={a} onChange={(e) => setA(e.target.value)}>{config.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Field>
      <Field as="select" label="Até" value={b} error={errors.b} onChange={(e) => setB(e.target.value)}>{config.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Field>
      <Field label="Minutos" inputMode="numeric" value={min} error={errors.min} hint={`Vazio = padrão (${minutes(config.settings.default_travel_min)})`} onChange={(e) => setMin(e.target.value)} />
      <Button type="submit" variant="secondary">Salvar tempo</Button>
    </form>
  );
}

function ZonesTab({ port, config, reload }: { port: FieldPort; config: FieldConfig; reload: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const name = (id: string) => config.zones.find((z) => z.id === id)?.name ?? "—";
  return (
    <>
      <Card aria-labelledby="fs-zones-title">
        <h2 id="fs-zones-title">Zonas de atendimento</h2>
        <ul className="tn-fs-list">
          {config.zones.map((z) => (
            <li key={z.id} className="tn-fs-item">
              <h3>{z.name} · {z.in_area ? "dentro da área" : "fora da área"}</h3>
              <p className="tn-muted">{z.cep_prefixes.length ? `CEPs ${z.cep_prefixes.join(", ")}` : "Sem CEP cadastrado"} · {String(z.distance_km).replace(".", ",")} km · {minutes(z.travel_from_base_min)} da base{z.active ? "" : " · inativa"}</p>
              {editing === z.id ? <ZoneForm port={port} zone={z} onDone={() => { setEditing(null); reload(); }} />
                : <div className="tn-actions"><Button variant="secondary" onClick={() => setEditing(z.id)} aria-label={`Editar ${z.name}`}>Editar</Button></div>}
            </li>
          ))}
        </ul>
        <h3>Nova zona</h3>
        <ZoneForm key={config.zones.length} port={port} zone={null} onDone={reload} />
      </Card>
      <Card aria-labelledby="fs-travel-title">
        <h2 id="fs-travel-title">Tempo entre zonas</h2>
        <p className="tn-muted">Mesma zona: {minutes(config.settings.same_zone_travel_min)}. Sem tempo cadastrado: {minutes(config.settings.default_travel_min)}.</p>
        <ul className="tn-fs-list">
          {config.travel_times.map((t) => <li key={`${t.zone_a}-${t.zone_b}`} className="tn-muted">{name(t.zone_a)} ↔ {name(t.zone_b)}: {minutes(t.minutes)}</li>)}
        </ul>
        <TravelForm port={port} config={config} onDone={reload} />
      </Card>
    </>
  );
}

function RulesTab({ port, config, reload }: { port: FieldPort; config: FieldConfig; reload: () => void }) {
  const s = config.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [def, setDef] = useState(String(s.default_travel_min));
  const [same, setSame] = useState(String(s.same_zone_travel_min));
  const [win, setWin] = useState(String(s.arrival_window_min));
  const [max, setMax] = useState(s.max_km === null ? "" : String(s.max_km).replace(".", ","));
  const { formRef, errors, show } = useFormErrors<"def" | "same" | "win" | "max">();
  const int = (v: string, hi: number) => Number.isInteger(parseNumber(v)) && parseNumber(v) >= 0 && parseNumber(v) <= hi;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const maxKm = max.trim() === "" ? null : parseNumber(max);
    const ok = show({
      def: !int(def, 240) && "De 0 a 240 minutos.",
      same: !int(same, 120) && "De 0 a 120 minutos.",
      win: !int(win, 120) && "De 0 a 120 minutos.",
      max: maxKm !== null && !(maxKm > 0 && maxKm <= 200) && "De 0,1 a 200 km (vazio = sem limite).",
    });
    if (!ok) return;
    try {
      await port.saveSettings({ expected_version: s.version, enabled, default_travel_min: parseNumber(def), same_zone_travel_min: parseNumber(same),
        arrival_window_min: parseNumber(win), max_km: maxKm }, newKey());
      toast("Regras do domicílio salvas. Valem para os próximos recálculos.");
      reload();
    } catch (err) {
      fail(err);
      reload();
    }
  }
  return (
    <Card aria-labelledby="fs-rules-title">
      <h2 id="fs-rules-title">Regras</h2>
      <form ref={formRef} className="tn-fs-form" aria-label="Regras do domicílio" onSubmit={(e) => void submit(e)} noValidate>
        <label className="tn-fs-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Atendo a domicílio</label>
        <Field label="Deslocamento padrão (min)" inputMode="numeric" value={def} error={errors.def} onChange={(e) => setDef(e.target.value)} />
        <Field label="Na mesma zona (min)" inputMode="numeric" value={same} error={errors.same} onChange={(e) => setSame(e.target.value)} />
        <Field label="Janela de chegada (min)" inputMode="numeric" value={win} error={errors.win} hint="O cliente recebe “chego entre X e Y”." onChange={(e) => setWin(e.target.value)} />
        <Field label="Distância máxima (km)" inputMode="decimal" value={max} error={errors.max} hint="Vazio = sem limite" onChange={(e) => setMax(e.target.value)} />
        <Button type="submit">Salvar regras</Button>
      </form>
    </Card>
  );
}

export function FieldPage({ port }: { port: FieldPort }) {
  const [tab, setTab] = useState<Tab>("route");
  const [config, setConfig] = useState<FieldConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => {
    port.config().then((c) => { setConfig(c); setTick((t) => t + 1); setError(null); }, (err) => setError(explain(err)));
  }, [port]);
  useEffect(reload, [reload]);
  return (
    <div className="tn-fs">
      <PageHeader id="fs-title" title="Domicílio" subtitle="Área de atendimento, deslocamento na agenda e roteiro do dia." />
      {port.kind === "demo" ? <StatusBanner tone="info">Demonstração: dados de exemplo nesta aba, com as mesmas regras do servidor.</StatusBanner> : null}
      <Help>
        A área é feita de zonas (bairro e CEPs de 5 dígitos) com a distância que você informa. Guardamos só a zona e os 5 primeiros dígitos do CEP: nada de
        endereço, mapa ou localização em tempo real. Ao marcar um atendimento como domicílio, o deslocamento entra na agenda antes do horário; se não der tempo
        de chegar, nada muda.
      </Help>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <Segmented label="Ver" hideLabel value={tab} onChange={setTab}
        options={[{ value: "route", label: "Roteiro" }, { value: "zones", label: "Zonas" }, { value: "rules", label: "Regras" }]} />
      {config ? (
        tab === "route" ? <RouteTab key={tick} port={port} config={config} />
          : tab === "zones" ? <ZonesTab port={port} config={config} reload={reload} />
            : <RulesTab key={tick} port={port} config={config} reload={reload} />
      ) : <p className="tn-muted">Carregando…</p>}
    </div>
  );
}

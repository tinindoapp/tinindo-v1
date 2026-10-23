// Campanhas (P19): segmento por dados existentes, público autorizado (consentimento de marketing), limites de envio e
// gasto aplicados no servidor, oferta vinculada, grupo de controle sorteado e resultado por braço com intervalo.
// O que a tela promete é o que o banco garante; sem controle, o resultado é observação, não efeito.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, Help, StatusBanner } from "../../components/ui/index.tsx";
import { ci, DESIGN, explain, formatCents, formatDate, offerLabel, pct, segmentLabel, STATUS, VERDICT } from "./labels.ts";
import { type Campaign, type CampaignDetail, type CampaignSegment, type CampaignsPort, newKey, type Preview } from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

function NewCampaign({ port, services, onDone }: { port: CampaignsPort; services: { id: string; name: string }[]; onDone: (n: Notice) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CampaignSegment["kind"]>("inactive_days");
  const [days, setDays] = useState("30");
  const [control, setControl] = useState("20");
  const [maxSends, setMaxSends] = useState("50");
  const [cap, setCap] = useState("");
  const [windowDays, setWindowDays] = useState("14");
  const [offerKind, setOfferKind] = useState<"none" | "discount_pct">("none");
  const [pctValue, setPctValue] = useState("10");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [key, setKey] = useState(newKey);
  const segment: CampaignSegment = kind === "inactive_days" ? { kind, days: Number(days) || 0 } : { kind };
  const segKey = JSON.stringify(segment);
  useEffect(() => {
    let alive = true;
    const seg = JSON.parse(segKey) as CampaignSegment;
    if (seg.kind === "inactive_days" && !(seg.days >= 14 && seg.days <= 365)) return;
    port.preview(seg).then((p) => alive && setPreview(p), () => alive && setPreview(null));
    return () => { alive = false; };
  }, [port, segKey]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    try {
      const c = await port.approve({ name: name.trim(), segment, audience_hash: preview.audience_hash, control_pct: Number(control), max_sends: Number(maxSends),
        spend_cap_cents: cap.trim() ? parseBRL(cap) : null, window_days: Number(windowDays),
        offer: offerKind === "none" ? { kind: "none" } : { kind: "discount_pct", pct: Number(pctValue), service_id: serviceId || null } }, key);
      setKey(newKey());
      setName("");
      onDone({ tone: "success", text: `Campanha “${c.name}” aprovada: ${c.treatment_count} cliente(s) recebem a oferta, ${c.control_count} no grupo de controle. Janela de ${c.window_days} dias; ${DESIGN[c.result.design]}.` });
    } catch (err) {
      setKey(newKey());
      const p = await port.preview(segment).catch(() => null);
      setPreview(p);
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-cp-form" aria-label="Nova campanha" onSubmit={(e) => void submit(e)}>
      <label className="tn-cp-field">Nome
        <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="tn-cp-field">Segmento
        <select value={kind} onChange={(e) => setKind(e.target.value as CampaignSegment["kind"])}>
          <option value="inactive_days">Sem atendimento há N dias</option>
          <option value="credit_remaining">Com sessões sobrando no pacote</option>
          <option value="marketing_all">Todas com consentimento de marketing</option>
        </select>
      </label>
      {kind === "inactive_days" ? <label className="tn-cp-field">Dias sem atendimento (14–365)
        <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      </label> : null}
      <p className="tn-cp-muted" aria-live="polite">
        {preview ? `Público autorizado agora: ${preview.audience_count} cliente(s) com consentimento de marketing, sem atendimento futuro e fora de outra campanha.` : "Calculando o público…"}
      </p>
      <label className="tn-cp-field">Grupo de controle (%)
        <input inputMode="numeric" value={control} onChange={(e) => setControl(e.target.value)} />
      </label>
      <label className="tn-cp-field">Teto de envios
        <input inputMode="numeric" value={maxSends} onChange={(e) => setMaxSends(e.target.value)} />
      </label>
      <label className="tn-cp-field">Teto de gasto com a oferta (R$, opcional)
        <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
      </label>
      <label className="tn-cp-field">Janela de medição (dias)
        <input inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
      </label>
      <label className="tn-cp-field">Oferta
        <select value={offerKind} onChange={(e) => setOfferKind(e.target.value as "none" | "discount_pct")}>
          <option value="none">Sem oferta (só o convite)</option>
          <option value="discount_pct">Desconto em um serviço</option>
        </select>
      </label>
      {offerKind === "discount_pct" ? (
        <>
          <label className="tn-cp-field">Desconto (%)
            <input inputMode="numeric" value={pctValue} onChange={(e) => setPctValue(e.target.value)} />
          </label>
          <label className="tn-cp-field">Serviço
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </>
      ) : null}
      <Button type="submit" disabled={!name.trim() || !preview || preview.audience_count === 0}>Aprovar campanha</Button>
    </form>
  );
}

function Result({ c }: { c: Campaign }) {
  const r = c.result;
  const t = r.arms.treatment, k = r.arms.control;
  return (
    <div className="tn-cp-result">
      <p><strong>{r.final ? "Resultado final" : "Resultado parcial"}</strong> · {DESIGN[r.design]} · janela {formatDate(r.window.starts_at)} a {formatDate(r.window.ends_at)}</p>
      <ul className="tn-cp-arms" aria-label={`Braços de ${c.name}`}>
        <li>Receberam a oferta: {t.converted} de {t.n} agendaram ({pct(t.rate)}; intervalo {ci(t.ci)}) · {formatCents(t.revenue_cents)} em atendimentos concluídos · {t.manual} para compartilhar, {t.sent} enviadas, {t.skipped} puladas</li>
        {r.design === "randomized_control" ? <li>Grupo de controle: {k.converted} de {k.n} agendaram ({pct(k.rate)}; intervalo {ci(k.ci)})</li> : null}
      </ul>
      {r.difference ? <p>Diferença (oferta − controle): {Math.round(r.difference.value * 100)} pontos; intervalo {Math.round(r.difference.ci[0] * 100)} a {Math.round(r.difference.ci[1] * 100)} pontos.</p> : null}
      <p className="tn-cp-verdict">{VERDICT[r.verdict]}</p>
    </div>
  );
}

function CampaignItem({ c, port, onDone }: { c: Campaign; port: CampaignsPort; onDone: (n: Notice) => void }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone({ tone: "success", text: ok }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  return (
    <li className="tn-cp-item">
      <h3>{c.name}</h3>
      <p><strong>{STATUS[c.status]}</strong> · {segmentLabel(c.segment)} · {offerLabel(c.offer)} · público {c.audience_count}: {c.treatment_count} recebem, {c.control_count} controle · teto {c.max_sends} envios{c.spend_cap_cents != null ? ` e ${formatCents(c.spend_cap_cents)}` : ""} · custo estimado {formatCents(c.estimated_cost_cents)}</p>
      <Result c={c} />
      <div className="tn-cp-actions">
        {c.status === "running" ? <Button variant="secondary" onClick={() => void act(() => port.cancel(c, newKey()), "Campanha cancelada: o que ainda não saiu parou; o que saiu não muda. Resultado congelado como observação parcial.")}>Cancelar campanha</Button> : null}
        {c.status === "running" && port.simulate ? <Button variant="ghost" onClick={() => void act(() => port.simulate!(c.id), "Simulação: parte das clientes agendou e a janela fechou pelo worker.")}>Simular janela (demonstração)</Button> : null}
        <Button variant="ghost" onClick={() => void port.get(c.id).then(setDetail, (e: unknown) => onDone({ tone: "danger", text: explain(e) }))}>Ver participantes</Button>
      </div>
      {detail ? (
        <ul className="tn-cp-list" aria-label={`Participantes de ${c.name}`}>
          {detail.members.map((m) => <li key={m.customer_id}>{m.customer_name} · {m.arm === "treatment" ? "recebe a oferta" : "controle"}{m.step_status ? ` · passo ${m.step_status}` : ""} · {m.converted ? "agendou" : "não agendou"}</li>)}
        </ul>
      ) : null}
    </li>
  );
}

export function CampaignsPage({ port }: { port: CampaignsPort }) {
  const [services, setServices] = useState<{ id: string; name: string }[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([port.services(), port.list()]).then(([s, c]) => {
      if (!alive) return;
      setServices(s);
      setCampaigns(c);
      setError(null);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (n: Notice) => {
    setNotice(n);
    setNonce((x) => x + 1);
  };
  return (
    <div className="tn-cp">
      <Card aria-labelledby="cp-title">
        <h1 id="cp-title">Campanhas</h1>
        <Help><p>Convide um grupo de clientes com uma oferta e meça o que aconteceu. Só entra quem consentiu receber marketing (Relacionamento), sem atendimento marcado e fora de outra campanha. Os tetos de envio e de gasto valem no servidor. Sem canal conectado, as mensagens ficam para você compartilhar.</p></Help>
        <StatusBanner tone="info"><strong>Medição honesta.</strong> Um grupo de controle sorteado fica sem a oferta; o resultado compara os dois grupos com intervalo. Sem controle, o que você vê é observação, não efeito da campanha.</StatusBanner>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é enviado. "Simular janela" fecha a medição como o worker faria.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
      </Card>
      <Card aria-labelledby="cp-new-title">
        <h2 id="cp-new-title">Nova campanha</h2>
        {services ? <NewCampaign key={`new:${nonce}`} port={port} services={services} onDone={done} /> : null}
      </Card>
      <Card aria-labelledby="cp-list-title">
        <h2 id="cp-list-title">Campanhas</h2>
        {campaigns && campaigns.length === 0 ? <p className="tn-cp-muted">Nenhuma campanha ainda.</p> : null}
        <ul className="tn-cp-list" aria-label="Campanhas">
          {campaigns?.map((c) => <CampaignItem key={c.id} c={c} port={port} onDone={done} />)}
        </ul>
      </Card>
    </div>
  );
}

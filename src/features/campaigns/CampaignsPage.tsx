// Campanhas (P19): segmento por dados existentes, público autorizado (consentimento de marketing), limites de envio e
// gasto aplicados no servidor, oferta vinculada, grupo de controle sorteado e resultado por braço com intervalo.
// O que a tela promete é o que o banco garante; sem controle, o resultado é observação, não efeito.
import { type ComponentProps, type FormEvent, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, type ToastInput, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { ci, DESIGN, explain, formatCents, formatDate, offerLabel, pct, segmentLabel, STATUS, VERDICT } from "./labels.ts";
import { type Campaign, type CampaignDetail, type CampaignSegment, type CampaignsPort, newKey, type Preview } from "./port.ts";

/** Retorno de uma ação: aviso curto (Toast), sempre à vista; `null` só atualiza a tela. */
type Notice = ToastInput | string | null;
const failed = (e: unknown): Notice => ({ tone: "danger", message: explain(e) });

/** Botão de ação de um toque: mostra o carregando enquanto a ação roda. */
function ActButton({ onAct, ...props }: Omit<ComponentProps<typeof Button>, "onClick" | "loading"> & { onAct: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return <Button {...props} loading={busy} onClick={() => { setBusy(true); void onAct().finally(() => setBusy(false)); }} />;
}
const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

function NewCampaign({ port, services, onDone }: { port: CampaignsPort; services: { id: string; name: string }[]; onDone: (n: Notice, close?: boolean) => void }) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"name" | "kind" | "days">();
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
    const d = Number(days);
    const daysOk = kind !== "inactive_days" || (Number.isInteger(d) && d >= 14 && d <= 365);
    const ok = show({
      name: !name.trim() && "Informe o nome da campanha.",
      days: !daysOk && "Informe de 14 a 365 dias.",
      kind: daysOk && preview?.audience_count === 0 && "Ninguém no público autorizado agora: escolha outro segmento.",
    });
    if (!ok) return;
    if (!preview) return setError("Ainda calculando o público. Tente de novo em instantes.");
    setBusy(true);
    setError(null);
    try {
      const c = await port.approve({ name: name.trim(), segment, audience_hash: preview.audience_hash, control_pct: Number(control), max_sends: Number(maxSends),
        spend_cap_cents: cap.trim() ? parseBRL(cap) : null, window_days: Number(windowDays),
        offer: offerKind === "none" ? { kind: "none" } : { kind: "discount_pct", pct: Number(pctValue), service_id: serviceId || null } }, key);
      setKey(newKey());
      setName("");
      onDone(`Campanha “${c.name}” aprovada: ${c.treatment_count} cliente(s) recebem a oferta, ${c.control_count} no grupo de controle. Janela de ${c.window_days} dias; ${DESIGN[c.result.design]}.`, true);
    } catch (err) {
      setKey(newKey());
      const p = await port.preview(segment).catch(() => null);
      setPreview(p);
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-cp-form" aria-label="Nova campanha" onSubmit={(e) => void submit(e)} noValidate>
      <Field label="Nome" maxLength={80} value={name} error={errors.name} onChange={(e) => setName(e.target.value)} />
      <Field as="select" label="Segmento" value={kind} error={errors.kind} onChange={(e) => setKind(e.target.value as CampaignSegment["kind"])}>
        <option value="inactive_days">Sem atendimento há N dias</option>
        <option value="credit_remaining">Com sessões sobrando no pacote</option>
        <option value="marketing_all">Todas com consentimento de marketing</option>
      </Field>
      {kind === "inactive_days" ? <Field label="Dias sem atendimento (14–365)" inputMode="numeric" value={days} error={errors.days} onChange={(e) => setDays(e.target.value)} /> : null}
      <p className="tn-muted tn-cp-audience" aria-live="polite">
        {preview ? `Público autorizado agora: ${preview.audience_count} cliente(s) com consentimento de marketing, sem atendimento futuro e fora de outra campanha.` : "Calculando o público…"}
      </p>
      <Field label="Grupo de controle (%)" inputMode="numeric" value={control} onChange={(e) => setControl(e.target.value)} />
      <Field label="Teto de envios" inputMode="numeric" value={maxSends} onChange={(e) => setMaxSends(e.target.value)} />
      <Field label="Teto de gasto com a oferta (R$, opcional)" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
      <Field label="Janela de medição (dias)" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
      <Field as="select" label="Oferta" value={offerKind} onChange={(e) => setOfferKind(e.target.value as "none" | "discount_pct")}>
        <option value="none">Sem oferta (só o convite)</option>
        <option value="discount_pct">Desconto em um serviço</option>
      </Field>
      {offerKind === "discount_pct" ? (
        <>
          <Field label="Desconto (%)" inputMode="numeric" value={pctValue} onChange={(e) => setPctValue(e.target.value)} />
          <Field as="select" label="Serviço" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Field>
        </>
      ) : null}
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <Button type="submit" loading={busy}>Aprovar campanha</Button>
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
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone(ok), (e: unknown) => onDone(failed(e)));
  return (
    <li className="tn-cp-item">
      <h3>{c.name}</h3>
      <p><strong>{STATUS[c.status]}</strong> · {segmentLabel(c.segment)} · {offerLabel(c.offer)} · público {c.audience_count}: {c.treatment_count} recebem, {c.control_count} controle · teto {c.max_sends} envios{c.spend_cap_cents != null ? ` e ${formatCents(c.spend_cap_cents)}` : ""} · custo estimado {formatCents(c.estimated_cost_cents)}</p>
      <Result c={c} />
      <div className="tn-actions">
        {c.status === "running" ? (
          // Não há como retomar uma campanha cancelada: confirma com a consequência.
          <ConfirmAction
            trigger="Cancelar campanha"
            triggerVariant="secondary"
            triggerLabel={`Cancelar a campanha ${c.name}`}
            title={`Cancelar a campanha “${c.name}”?`}
            consequence="As mensagens que ainda não saíram param e não dá para retomar; as que saíram não mudam. O resultado fica congelado como observação parcial."
            confirmLabel="Sim, cancelar"
            onConfirm={() => act(() => port.cancel(c, newKey()), "Campanha cancelada: o que ainda não saiu parou; o que saiu não muda. Resultado congelado como observação parcial.")}
          />
        ) : null}
        {c.status === "running" && port.simulate ? <ActButton variant="ghost" onAct={() => act(() => port.simulate!(c.id), "Simulação: parte das clientes agendou e a janela fechou pelo worker.")}>Simular janela (demonstração)</ActButton> : null}
        <ActButton variant="ghost" onAct={() => port.get(c.id).then(setDetail, (e: unknown) => onDone(failed(e)))}>Ver participantes</ActButton>
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
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  // Lista primeiro: o formulário abre por "Nova campanha" e fecha quando a campanha é aprovada.
  const [composing, setComposing] = useState(false);
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
  const done = (n: Notice, close = false) => {
    if (n) toast(n);
    if (close) setComposing(false);
    setNonce((x) => x + 1);
  };
  return (
    <div className="tn-cp">
      <PageHeader
        id="cp-title"
        title="Campanhas"
        actions={services && !composing ? (
          <Button onClick={() => setComposing(true)}>
            <Icon name="mais" size={20} />
            Nova campanha
          </Button>
        ) : null}
      />
      <Help><p>Convide um grupo de clientes com uma oferta e meça o que aconteceu. Só entra quem consentiu receber marketing (Relacionamento), sem atendimento marcado e fora de outra campanha. Os tetos de envio e de gasto valem no servidor. Sem canal conectado, as mensagens ficam para você compartilhar.</p></Help>
      <StatusBanner tone="info"><strong>Medição honesta.</strong> Um grupo de controle sorteado fica sem a oferta; o resultado compara os dois grupos com intervalo. Sem controle, o que você vê é observação, não efeito da campanha.</StatusBanner>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é enviado. "Simular janela" fecha a medição como o worker faria.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {composing && services ? (
        <Card aria-labelledby="cp-new-title">
          <h2 id="cp-new-title">Nova campanha</h2>
          <NewCampaign key={`new:${nonce}`} port={port} services={services} onDone={done} />
          <div className="tn-actions"><Button variant="ghost" onClick={() => setComposing(false)}>Fechar</Button></div>
        </Card>
      ) : null}
      <Card aria-labelledby="cp-list-title">
        <h2 id="cp-list-title">Campanhas</h2>
        {campaigns && campaigns.length === 0 ? <p className="tn-muted">Nenhuma campanha ainda. Comece em “Nova campanha”.</p> : null}
        <ul className="tn-cp-list" aria-label="Campanhas">
          {campaigns?.map((c) => <CampaignItem key={c.id} c={c} port={port} onDone={done} />)}
        </ul>
      </Card>
    </div>
  );
}

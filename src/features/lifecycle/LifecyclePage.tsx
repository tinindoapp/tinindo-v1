// Relacionamento (P13): réguas (confirmação, lembretes, acompanhamento de orçamento, lembrete de cobrança) com cada
// passo visível e por palavra; textos prontos para compartilhar quando não há canal; consentimento por finalidade;
// reativação só como campanha com público visto e teto. O que a tela promete é o que o banco garante.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, StatusBanner } from "../../components/ui/index.tsx";
import { explain, formatDate, formatDateTime, MESSAGE_STATUS, RULE_LABEL, SKIP_REASON, STEP_STATUS } from "./labels.ts";
import { type Audience, type LifecycleCampaign, type LifecyclePort, type LifecycleSettings, type LifecycleStep, type LifecycleStepStatus, newKey, type StepsList } from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
const HOURS = [1, 2, 3, 6, 12, 24, 48];

function SettingsForm({ port, data, onDone }: { port: LifecyclePort; data: { settings: LifecycleSettings; sent_today: number }; onDone: (n: Notice) => void }) {
  const [s, setS] = useState(data.settings);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const { version: _v, ...patch } = s;
      await port.saveSettings(patch, data.settings.version, newKey());
      onDone({ tone: "success", text: "Réguas salvas. Valem para os próximos agendamentos e passos; o que já saiu não muda." });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  const toggleHour = (h: number) => setS((x) => ({ ...x, reminder_hours: x.reminder_hours.includes(h) ? x.reminder_hours.filter((y) => y !== h) : [...x.reminder_hours, h].sort((a, b) => b - a) }));
  return (
    <form className="tn-lc-form" aria-label="Réguas" onSubmit={(e) => void submit(e)}>
      <label className="tn-lc-check"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Réguas ligadas</label>
      <label className="tn-lc-check"><input type="checkbox" checked={s.confirmation} onChange={(e) => setS({ ...s, confirmation: e.target.checked })} /> Confirmar ao agendar</label>
      <fieldset className="tn-lc-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Lembretes antes do atendimento</legend>
        <div className="tn-lc-actions">
          {HOURS.map((h) => <label key={h} className="tn-lc-check"><input type="checkbox" checked={s.reminder_hours.includes(h)} onChange={() => toggleHour(h)} /> {h} h</label>)}
        </div>
      </fieldset>
      <label className="tn-lc-field">Acompanhar orçamento sem decisão após (dias)
        <input inputMode="numeric" value={s.quote_followup_days} onChange={(e) => setS({ ...s, quote_followup_days: Number(e.target.value) || 0 })} />
      </label>
      <label className="tn-lc-check"><input type="checkbox" checked={s.receivable_reminder} onChange={(e) => setS({ ...s, receivable_reminder: e.target.checked })} /> Lembrar cobrança vencida</label>
      <label className="tn-lc-field">Reativação: sem visita há (dias)
        <input inputMode="numeric" value={s.reactivation_days} onChange={(e) => setS({ ...s, reactivation_days: Number(e.target.value) || 0 })} />
      </label>
      <label className="tn-lc-field">Teto de envios por dia
        <input inputMode="numeric" value={s.daily_budget} onChange={(e) => setS({ ...s, daily_budget: Number(e.target.value) || 0 })} />
      </label>
      <p className="tn-lc-muted">Hoje já saíram {data.sent_today} pelo canal. Além do teto, o passo é adiado para o dia seguinte, nunca descartado.</p>
      <Button type="submit">Salvar réguas</Button>
    </form>
  );
}

function StepItem({ step, timezone, port, onDone }: { step: LifecycleStep; timezone: string; port: LifecyclePort; onDone: (n: Notice) => void }) {
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => onDone({ tone: "success", text: ok }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  return (
    <li className="tn-lc-item">
      <h3>{RULE_LABEL[step.rule]} · {step.customer_name ?? "cliente"}</h3>
      <p>
        <strong>{STEP_STATUS[step.status]}</strong>
        {step.skip_reason ? ` (${SKIP_REASON[step.skip_reason] ?? step.skip_reason})` : ""}
        {step.status === "sent" && step.message_status ? ` · mensagem ${MESSAGE_STATUS[step.message_status] ?? step.message_status}` : ""}
        {" · "}{step.status === "scheduled" || step.status === "deferred" ? `sai em ${formatDateTime(step.due_at, timezone)}` : `previsto ${formatDateTime(step.due_at, timezone)}`}
      </p>
      {step.status === "manual" || step.status === "shared" ? <span className="tn-lc-body">{step.body}</span> : null}
      <div className="tn-lc-actions">
        {step.status === "manual" ? (
          <Button onClick={() => { void navigator.clipboard?.writeText(step.body).catch(() => undefined); void act(() => port.markShared(step.id, newKey()), "Texto copiado e passo marcado como compartilhado. Compartilhar não confirma entrega."); }}>Copiar e marcar como compartilhado</Button>
        ) : null}
        {step.status === "scheduled" || step.status === "deferred" || step.status === "manual" ? (
          <Button variant="ghost" onClick={() => void act(() => port.cancelStep(step.id, newKey()), "Passo cancelado.")}>Cancelar</Button>
        ) : null}
      </div>
    </li>
  );
}

export function LifecyclePage({ port, timezone }: { port: LifecyclePort; timezone: string }) {
  const [settings, setSettings] = useState<{ settings: LifecycleSettings; sent_today: number } | null>(null);
  const [list, setList] = useState<StepsList | null>(null);
  const [filter, setFilter] = useState<LifecycleStepStatus | "">("");
  const [audience, setAudience] = useState<Audience | null>(null);
  const [campaigns, setCampaigns] = useState<LifecycleCampaign[]>([]);
  const [maxSends, setMaxSends] = useState("20");
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([port.settings(), port.steps(filter || null), port.audience(), port.campaigns()]).then(([s, l, a, c]) => {
      if (!alive) return;
      setSettings(s);
      setList(l);
      setAudience(a);
      setCampaigns(c);
      setError(null);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, filter, nonce]);
  const done = (n: Notice) => {
    setNotice(n);
    setNonce((x) => x + 1);
  };
  async function approve(e: FormEvent) {
    e.preventDefault();
    if (!audience) return;
    try {
      const c = await port.approveCampaign(audience.audience_hash, Number(maxSends), newKey());
      done({ tone: "success", text: `Campanha aprovada para ${c.audience_count} cliente(s), até ${c.max_sends} envio(s). Os passos saem dentro do teto diário.` });
    } catch (err) {
      done({ tone: "danger", text: explain(err) });
    }
  }

  return (
    <div className="tn-lc">
      <Card aria-labelledby="lc-title">
        <h1 id="lc-title">Relacionamento</h1>
        <p className="tn-lc-muted">Confirmação e lembretes do agendamento, acompanhamento de orçamento parado e lembrete de cobrança vencida, com cada passo visível. A régua para sozinha no aceite, cancelamento, pagamento ou quando a cliente pede SAIR. Sem canal conectado, o texto fica pronto para você compartilhar.</p>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Agenda de exemplo; nada é enviado. Use "Rodar a régua" para ver os passos vencidos saírem.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
        {port.tick ? <div className="tn-lc-actions"><Button variant="secondary" onClick={() => void port.tick!().then((r) => done({ tone: "info", text: `Régua (simulação): ${r.sent} enviado(s) ao canal, ${r.manual} para compartilhar, ${r.deferred} adiado(s), ${r.skipped} pulado(s).` }))}>Rodar a régua (simulação)</Button></div> : null}
      </Card>

      <Card aria-labelledby="lc-steps-title">
        <h2 id="lc-steps-title">Fila de mensagens</h2>
        {list ? (
          <ul className="tn-lc-counts" aria-label="Contagem por estado">
            {Object.entries(list.counts).sort().map(([k, n]) => <li key={k}>{STEP_STATUS[k as LifecycleStepStatus] ?? k}: {n}</li>)}
          </ul>
        ) : null}
        <label className="tn-lc-field">Mostrar
          <select value={filter} onChange={(e) => setFilter(e.target.value as LifecycleStepStatus | "")}>
            <option value="">Todos</option>
            {(Object.keys(STEP_STATUS) as LifecycleStepStatus[]).map((k) => <option key={k} value={k}>{STEP_STATUS[k]}</option>)}
          </select>
        </label>
        {list && list.steps.length === 0 ? <p className="tn-lc-muted">Nenhum passo. Eles nascem dos agendamentos, orçamentos e cobranças.</p> : null}
        <ul className="tn-lc-list" aria-label="Passos">
          {list?.steps.map((s) => <StepItem key={s.id} step={s} timezone={timezone} port={port} onDone={done} />)}
        </ul>
      </Card>

      <Card aria-labelledby="lc-settings-title">
        <h2 id="lc-settings-title">Réguas</h2>
        {settings ? <SettingsForm key={settings.settings.version} port={port} data={settings} onDone={done} /> : null}
      </Card>

      <Card aria-labelledby="lc-react-title">
        <h2 id="lc-react-title">Reativação (campanha)</h2>
        <p className="tn-lc-muted">Só clientes com consentimento de marketing registrado por você e sem visita há {audience?.reactivation_days ?? "…"} dias. Você vê o público e aprova um teto; mudou o público, a aprovação é recusada.</p>
        {audience ? (
          <>
            <ul className="tn-lc-list" aria-label="Público elegível">
              {audience.customers.length === 0 ? <li className="tn-lc-muted">Ninguém elegível agora.</li> : null}
              {audience.customers.map((c) => (
                <li key={c.customer_id} className="tn-lc-item">
                  <h3>{c.name}</h3>
                  <p className="tn-lc-muted">{c.last_visit_at ? `Última visita ${formatDate(c.last_visit_at, timezone)}` : "Sem visita registrada"} · {c.has_channel ? "com canal" : "sem canal (texto para compartilhar)"}</p>
                  <div className="tn-lc-actions">
                    <Button variant="ghost" onClick={() => void port.setConsent(c.customer_id, "marketing", false, newKey()).then(() => done({ tone: "success", text: `${c.name} fora da reativação (consentimento revogado).` }), (e: unknown) => done({ tone: "danger", text: explain(e) }))}>Revogar consentimento</Button>
                  </div>
                </li>
              ))}
            </ul>
            <form className="tn-lc-form" aria-label="Aprovar campanha" onSubmit={(e) => void approve(e)}>
              <label className="tn-lc-field">Teto de envios desta campanha
                <input inputMode="numeric" value={maxSends} onChange={(e) => setMaxSends(e.target.value)} />
              </label>
              <Button type="submit" disabled={audience.customers.length === 0 || !(Number(maxSends) >= 1)}>Aprovar campanha para {audience.customers.length} cliente(s)</Button>
            </form>
          </>
        ) : null}
        {campaigns.length > 0 ? (
          <ul className="tn-lc-list" aria-label="Campanhas">
            {campaigns.map((c) => <li key={c.id} className="tn-lc-item"><h3>Reativação · {formatDate(c.created_at, timezone)}</h3><p>{c.audience_count} no público · teto {c.max_sends} · {c.scheduled ?? 0} agendado(s) · {c.sent ?? 0} enviado(s)/compartilhado(s) · {c.skipped ?? 0} pulado(s)</p></li>)}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

/** Consentimento rápido para a demonstração e para o CRM futuro: registrado pelo dono, por finalidade. */
export function ConsentButtons({ port, customerId, name, onDone }: { port: LifecyclePort; customerId: string; name: string; onDone: (n: Notice) => void }) {
  return (
    <div className="tn-lc-actions">
      <Button variant="secondary" onClick={() => void port.setConsent(customerId, "marketing", true, newKey()).then(() => onDone({ tone: "success", text: `Consentimento de marketing de ${name} registrado (declarado por você).` }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }))}>Registrar consentimento de marketing</Button>
    </div>
  );
}

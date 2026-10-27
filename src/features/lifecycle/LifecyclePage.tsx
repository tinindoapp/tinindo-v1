// Relacionamento (P13): réguas (confirmação, lembretes, acompanhamento de orçamento, lembrete de cobrança) com cada
// passo visível e por palavra; textos prontos para compartilhar quando não há canal; consentimento por finalidade;
// reativação só como campanha com público visto e teto. O que a tela promete é o que o banco garante.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { type ShareHow, ShareActions } from "./share.tsx";
import { explain, formatDate, formatDateTime, MESSAGE_STATUS, RULE_LABEL, SKIP_REASON, STEP_STATUS } from "./labels.ts";
import { type Audience, type LifecycleCampaign, type LifecyclePort, type LifecycleSettings, type LifecycleStep, type LifecycleStepStatus, newKey, type StepsList } from "./port.ts";

/** Depois de uma ação: o sucesso sai no toast e a tela recarrega. */
type Done = (message: string) => void;
const HOURS = [1, 2, 3, 6, 12, 24, 48];

function SettingsForm({ port, data, onDone }: { port: LifecyclePort; data: { settings: LifecycleSettings; sent_today: number }; onDone: Done }) {
  const [s, setS] = useState(data.settings);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const { version: _v, ...patch } = s;
      await port.saveSettings(patch, data.settings.version, newKey());
      onDone("Réguas salvas. Valem para os próximos agendamentos e passos; o que já saiu não muda.");
    } catch (err) {
      setFailure(explain(err));
    } finally {
      setBusy(false);
    }
  }
  const toggleHour = (h: number) => setS((x) => ({ ...x, reminder_hours: x.reminder_hours.includes(h) ? x.reminder_hours.filter((y) => y !== h) : [...x.reminder_hours, h].sort((a, b) => b - a) }));
  return (
    <form className="tn-lc-form" aria-label="Réguas" onSubmit={(e) => void submit(e)} noValidate>
      <label className="tn-lc-check"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Réguas ligadas</label>
      <label className="tn-lc-check"><input type="checkbox" checked={s.confirmation} onChange={(e) => setS({ ...s, confirmation: e.target.checked })} /> Confirmar ao agendar</label>
      <fieldset className="tn-lc-hours">
        <legend>Lembretes antes do atendimento</legend>
        <div className="tn-actions">
          {HOURS.map((h) => <label key={h} className="tn-lc-check"><input type="checkbox" checked={s.reminder_hours.includes(h)} onChange={() => toggleHour(h)} /> {h} h</label>)}
        </div>
      </fieldset>
      <Field label="Acompanhar orçamento sem decisão após (dias)" inputMode="numeric" value={s.quote_followup_days} onChange={(e) => setS({ ...s, quote_followup_days: Number(e.target.value) || 0 })} />
      <label className="tn-lc-check"><input type="checkbox" checked={s.receivable_reminder} onChange={(e) => setS({ ...s, receivable_reminder: e.target.checked })} /> Lembrar cobrança vencida</label>
      <Field label="Reativação: sem visita há (dias)" inputMode="numeric" value={s.reactivation_days} onChange={(e) => setS({ ...s, reactivation_days: Number(e.target.value) || 0 })} />
      <Field label="Teto de envios por dia" inputMode="numeric" value={s.daily_budget} onChange={(e) => setS({ ...s, daily_budget: Number(e.target.value) || 0 })} />
      <p className="tn-muted">Hoje já saíram {data.sent_today} pelo canal. Além do teto, o passo é adiado para o dia seguinte, nunca descartado.</p>
      {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
      <Button type="submit" loading={busy} loadingText="Salvando…">Salvar réguas</Button>
    </form>
  );
}

const SHARED_OK: Record<ShareHow, string> = { copy: "Texto copiado.", share: "Texto compartilhado.", whatsapp: "WhatsApp aberto com o texto." };

function StepItem({ step, timezone, port, onDone }: { step: LifecycleStep; timezone: string; port: LifecyclePort; onDone: Done }) {
  const fail = (e: unknown) => toast({ tone: "danger", message: explain(e) });
  const who = step.customer_name ?? "a cliente";
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
      {step.status === "manual" ? (
        // Só marca como compartilhado depois que a cópia/compartilhamento deu certo (ou ao abrir o WhatsApp).
        <ShareActions
          message={step.body}
          copyText={step.body}
          copyLabel="Copiar e marcar como compartilhado"
          onShared={(how) => void port.markShared(step.id, newKey()).then(() => onDone(`${SHARED_OK[how]} Passo marcado como compartilhado. Compartilhar não confirma entrega.`), fail)}
        />
      ) : null}
      {/* Passo cancelado não volta para a fila (o port não reabre): confirma antes. */}
      {step.status === "scheduled" || step.status === "deferred" || step.status === "manual" ? (
        <div className="tn-actions">
          <ConfirmAction
            trigger="Cancelar"
            triggerLabel={`Cancelar ${RULE_LABEL[step.rule]} · ${step.customer_name ?? "cliente"}`}
            title="Cancelar este passo?"
            consequence={<p>{RULE_LABEL[step.rule]} para {who} não sai, e o passo não volta para a fila.</p>}
            confirmLabel="Sim, cancelar passo"
            onConfirm={() => port.cancelStep(step.id, newKey()).then(() => onDone("Passo cancelado."), fail)}
          />
        </div>
      ) : null}
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
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveFailure, setApproveFailure] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"maxSends">();
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
  const refresh = () => setNonce((x) => x + 1);
  const done: Done = (message) => {
    toast(message);
    refresh();
  };
  async function approve(e: FormEvent) {
    e.preventDefault();
    if (!audience) return;
    const n = Number(maxSends);
    if (!show({ maxSends: !(Number.isInteger(n) && n >= 1) && "Informe um teto de pelo menos 1 envio." })) return;
    setApproveBusy(true);
    setApproveFailure(null);
    try {
      const c = await port.approveCampaign(audience.audience_hash, n, newKey());
      done(`Campanha aprovada para ${c.audience_count} cliente(s), até ${c.max_sends} envio(s). Os passos saem dentro do teto diário.`);
    } catch (err) {
      // Público mudou ou regra recusou: o motivo fica no formulário e a tela recarrega o público.
      setApproveFailure(explain(err));
      refresh();
    } finally {
      setApproveBusy(false);
    }
  }

  return (
    <div className="tn-stack">
      <div className="tn-page-intro">
        <PageHeader id="lc-title" title="Relacionamento" />
        <Help><p>Confirmação e lembretes do agendamento, acompanhamento de orçamento parado e lembrete de cobrança vencida, com cada passo visível. A régua para sozinha no aceite, cancelamento, pagamento ou quando a cliente pede SAIR. Sem canal conectado, o texto fica pronto para você compartilhar.</p></Help>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Agenda de exemplo; nada é enviado. Use "Rodar a régua" para ver os passos vencidos saírem.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {port.tick ? <div className="tn-actions"><Button variant="secondary" onClick={() => void port.tick!().then((r) => { toast({ tone: "info", message: `Régua (simulação): ${r.sent} enviado(s) ao canal, ${r.manual} para compartilhar, ${r.deferred} adiado(s), ${r.skipped} pulado(s).` }); refresh(); }, (e: unknown) => toast({ tone: "danger", message: explain(e) }))}>Rodar a régua (simulação)</Button></div> : null}
      </div>

      <Card aria-labelledby="lc-steps-title">
        <h2 id="lc-steps-title">Fila de mensagens</h2>
        {list ? (
          <ul className="tn-lc-counts" aria-label="Contagem por estado">
            {Object.entries(list.counts).sort().map(([k, n]) => <li key={k}>{STEP_STATUS[k as LifecycleStepStatus] ?? k}: {n}</li>)}
          </ul>
        ) : null}
        <Field as="select" label="Mostrar" className="tn-lc-filter" value={filter} onChange={(e) => setFilter(e.target.value as LifecycleStepStatus | "")}>
          <option value="">Todos</option>
          {(Object.keys(STEP_STATUS) as LifecycleStepStatus[]).map((k) => <option key={k} value={k}>{STEP_STATUS[k]}</option>)}
        </Field>
        {list && list.steps.length === 0 ? <p className="tn-muted">Nenhum passo. Eles nascem dos agendamentos, orçamentos e cobranças.</p> : null}
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
        <p className="tn-muted">Só clientes com consentimento de marketing registrado por você e sem visita há {audience?.reactivation_days ?? "…"} dias. Você vê o público e aprova um teto; mudou o público, a aprovação é recusada.</p>
        {audience ? (
          <>
            <ul className="tn-lc-list" aria-label="Público elegível">
              {audience.customers.length === 0 ? <li className="tn-muted">Ninguém elegível agora.</li> : null}
              {audience.customers.map((c) => (
                <li key={c.customer_id} className="tn-lc-item">
                  <h3>{c.name}</h3>
                  <p className="tn-muted">{c.last_visit_at ? `Última visita ${formatDate(c.last_visit_at, timezone)}` : "Sem visita registrada"} · {c.has_channel ? "com canal" : "sem canal (texto para compartilhar)"}</p>
                  {/* Revogar não tem desfazer automático: o consentimento só volta declarado de novo pela cliente. */}
                  <div className="tn-actions">
                    <ConfirmAction
                      trigger="Revogar consentimento"
                      triggerLabel={`Revogar consentimento de ${c.name}`}
                      title={`Revogar o consentimento de ${c.name}?`}
                      consequence={
                        <p>
                          {c.name} sai da reativação e os passos de marketing já agendados para ela são cancelados. Para voltar, só com um
                          novo consentimento que ela der a você.
                        </p>
                      }
                      confirmLabel="Sim, revogar"
                      onConfirm={() =>
                        port.setConsent(c.customer_id, "marketing", false, newKey()).then(
                          () => done(`${c.name} fora da reativação (consentimento revogado).`),
                          (e: unknown) => toast({ tone: "danger", message: explain(e) }),
                        )
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
            <form ref={formRef} className="tn-lc-form" aria-label="Aprovar campanha" onSubmit={(e) => void approve(e)} noValidate>
              <Field label="Teto de envios desta campanha" inputMode="numeric" value={maxSends} error={errors.maxSends} onChange={(e) => setMaxSends(e.target.value)} />
              {/* Sem público elegível não há o que aprovar (regra, não validação). */}
              <Button type="submit" loading={approveBusy} loadingText="Aprovando…" disabled={audience.customers.length === 0}>Aprovar campanha para {audience.customers.length} cliente(s)</Button>
              {approveFailure ? <StatusBanner tone="danger">{approveFailure}</StatusBanner> : null}
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
export function ConsentButtons({ port, customerId, name, onDone }: { port: LifecyclePort; customerId: string; name: string; onDone: Done }) {
  return (
    <div className="tn-actions">
      <Button variant="secondary" onClick={() => void port.setConsent(customerId, "marketing", true, newKey()).then(() => onDone(`Consentimento de marketing de ${name} registrado (declarado por você).`), (e: unknown) => toast({ tone: "danger", message: explain(e) }))}>Registrar consentimento de marketing</Button>
    </div>
  );
}

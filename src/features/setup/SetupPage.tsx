// Configuração (P44): os 8 passos com por quê e a tela que resolve; "descreva seu negócio em uma frase" (analisador
// por regras → rascunho que o dono revisa campo a campo); modelos de serviço da profissão como sugestão marcável.
// O que a tela promete é o que o banco garante: nenhum serviço, horário ou preço é gravado sem a confirmação explícita,
// e cada confirmação passa pelas mesmas regras do catálogo (P02) e da agenda (P03).
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import type { Profession, WeeklyWindow } from "@contracts";
import { Button, Card, ChipGroup, ChoiceCard, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors, WEEKDAY_CHIPS, WEEKDAY_SHORTCUTS } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { describeBusiness, draftToWeeklyWindows } from "../../../supabase/functions/_shared/domain/setup/describe.ts";
import { plural } from "../../lib/text/plural.ts";
import { explain, formatCents, parseCents, priceRange, PROFESSION_LABEL, specOf, summarizeHours } from "./labels.ts";
import { newKey, type SetupDescribeDraft, type SetupPort, type SetupProgress, type SetupServiceDraft, type SetupStepCode, type SetupTemplate } from "./port.ts";
import "./setup.css";

const fail = (err: unknown) => toast({ tone: "danger", message: explain(err) });
const PROFESSIONS = ["barber", "hairdresser", "personal_trainer", "other"] as const satisfies readonly Profession[];

function Steps({ progress, port, onChange }: { progress: SetupProgress; port: SetupPort; onChange: (p: SetupProgress) => void }) {
  const [busy, setBusy] = useState<SetupStepCode | null>(null);
  async function toggle(step: SetupStepCode, dismissed: boolean) {
    setBusy(step);
    try {
      onChange(await port.dismiss(step, dismissed, newKey()));
      toast(dismissed ? "Passo dispensado. Ele continua aqui, sem destaque." : "O passo volta a aparecer na Home.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card aria-labelledby="setup-steps-title">
      <h2 id="setup-steps-title">
        Passos <span className="tn-num tn-muted">· {progress.done_count} de {progress.total} feitos</span>
      </h2>
      {progress.ready ? (
        <StatusBanner tone="success">Seu negócio está pronto para receber reservas pelo link. Os passos que faltam são opcionais.</StatusBanner>
      ) : (
        <p className="tn-muted">Os quatro primeiros deixam o link público funcionando. Os outros podem ficar para depois.</p>
      )}
      <ol className="tn-setup-steps" aria-label="Passos da configuração">
        {progress.steps.map((s, i) => {
          const spec = specOf(s.step);
          return (
            <li key={s.step} className="tn-setup-step" data-done={s.done || undefined} data-dismissed={s.dismissed || undefined} data-next={progress.next === s.step || undefined}>
              <span className="tn-setup-step__mark" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
              <div className="tn-setup-step__body">
                <p className="tn-setup-step__title">
                  {s.title}
                  {s.done ? <span className="tn-visually-hidden"> (feito)</span> : null}
                  {!s.required ? <span className="tn-setup-step__tag">opcional</span> : null}
                  {s.dismissed ? <span className="tn-setup-step__tag">dispensado</span> : null}
                </p>
                {s.why ? <p className="tn-setup-step__why">{s.why}</p> : null}
                {!s.done ? (
                  <div className="tn-setup-step__actions">
                    <Link to={s.link} className="tn-setup-step__go">{spec.cta}<Icon name="seta" size={16} /></Link>
                    {!s.required ? (
                      <Button variant="ghost" loading={busy === s.step} onClick={() => void toggle(s.step, !s.dismissed)}>
                        {s.dismissed ? "Voltar a mostrar" : "Agora não"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

type ServiceRow = { key: string; template_code: string | null; name: string; duration: string; price: string };
const rowOf = (name: string, duration = "", price = "", template_code: string | null = null): ServiceRow => ({ key: newKey(), template_code, name, duration, price });

/** Rascunho da frase, campo a campo. Nada é salvo até "Salvar" e a confirmação. */
function DraftReview({ draft, port, onSaved }: { draft: SetupDescribeDraft; port: SetupPort; onSaved: (p: SetupProgress) => void }) {
  const [profession, setProfession] = useState<Profession | "">(draft.profession ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(draft.weekdays);
  const [start, setStart] = useState(draft.start ?? "");
  const [end, setEnd] = useState(draft.end ?? "");
  const [pauseStart, setPauseStart] = useState(draft.pause?.start ?? "");
  const [pauseEnd, setPauseEnd] = useState(draft.pause?.end ?? "");
  const [rows, setRows] = useState<ServiceRow[]>(draft.services.map((n) => rowOf(n)));
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"profession" | "weekdays" | "hours" | "services">();

  const hours: WeeklyWindow[] = useMemo(() => {
    const pause = pauseStart && pauseEnd && pauseEnd > pauseStart ? { start: pauseStart, end: pauseEnd } : null;
    return draftToWeeklyWindows({ weekdays, start: start || null, end: end || null, pause });
  }, [weekdays, start, end, pauseStart, pauseEnd]);
  const services = rows.filter((r) => r.name.trim());
  const parsed: SetupServiceDraft[] = services.map((r) => ({ template_code: r.template_code, name: r.name.trim(), duration_min: Number(r.duration), base_price_cents: parseCents(r.price) ?? -1 }));
  const servicesOk = parsed.every((s) => Number.isInteger(s.duration_min) && s.duration_min >= 5 && s.duration_min <= 1440 && s.base_price_cents >= 0);

  const wantsHours = weekdays.length > 0 || !!start || !!end;
  const problems = {
    profession: !profession && "Escolha a profissão.",
    weekdays: wantsHours && weekdays.length === 0 && "Marque os dias de atendimento.",
    hours: wantsHours && (!start || !end || end <= start) && "Informe início e fim; o fim vem depois do início.",
    services: services.length > 0 && !servicesOk && "Cada serviço precisa de duração entre 5 e 1440 minutos e preço em reais (ex.: 35,00).",
  };
  const problem = Object.values(problems).find((v): v is string => typeof v === "string") ?? null;
  const validate = () => show(problems);
  async function save() {
    setBusy(true);
    try {
      const out = await port.applyDraft({ profession: profession || null, hours: hours.length ? hours : null, services: parsed }, newKey());
      const parts = [out.hours ? `expediente de ${plural(new Set(out.hours.map((h) => h.weekday)).size, "dia")}` : null, out.created.length ? plural(out.created.length, "serviço criado", "serviços criados") : null].filter(Boolean);
      toast(parts.length ? `Salvo: ${parts.join(" e ")}.` : "Profissão salva.");
      onSaved(out.progress);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  const consequence = [
    profession ? `Profissão: ${PROFESSION_LABEL[profession]}.` : null,
    hours.length ? `Expediente: ${summarizeHours(hours)} (substitui o atual da agenda principal).` : "Expediente: não muda.",
    parsed.length ? `Serviços: ${parsed.map((s) => `${s.name} (${s.duration_min} min, ${formatCents(Math.max(0, s.base_price_cents))})`).join("; ")}.` : "Serviços: nenhum.",
  ].filter(Boolean).join(" ");

  return (
    <form ref={formRef} className="tn-setup-draft" aria-label="Rascunho do seu negócio" onSubmit={(e) => e.preventDefault()} noValidate>
      {draft.unknown.length ? (
        <StatusBanner tone="info">
          Não entendi {draft.unknown.map((u) => ({ profession: "a profissão", weekdays: "os dias", hours: "o horário" })[u]).join(", ")}. Complete abaixo.
        </StatusBanner>
      ) : null}
      {draft.team_size !== null && draft.team_size > 1 ? (
        <p className="tn-muted">{plural(draft.team_size, "pessoa atende", "pessoas atendem")}. A agenda principal é uma; outros profissionais entram em Negócio → Equipe.</p>
      ) : null}
      <Field as="select" label="Profissão" value={profession} error={errors.profession} onChange={(e) => setProfession(e.target.value as Profession | "")}>
        <option value="">Escolha…</option>
        {PROFESSIONS.map((p) => <option key={p} value={p}>{PROFESSION_LABEL[p]}</option>)}
      </Field>
      <ChipGroup label="Dias de atendimento" options={WEEKDAY_CHIPS} shortcuts={WEEKDAY_SHORTCUTS} value={weekdays} onChange={setWeekdays} error={errors.weekdays} errorId="setup-draft-weekdays-error" />
      <div className="tn-form-grid">
        <Field label="Início" type="time" value={start} error={errors.hours} onChange={(e) => setStart(e.target.value)} />
        <Field label="Fim" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        <Field label="Pausa: de (opcional)" type="time" value={pauseStart} onChange={(e) => setPauseStart(e.target.value)} />
        <Field label="Pausa: até" type="time" value={pauseEnd} onChange={(e) => setPauseEnd(e.target.value)} />
      </div>
      <fieldset className="tn-setup-services">
        <legend>Serviços (você põe duração e preço)</legend>
        {errors.services ? <p className="tn-field__error" id="setup-draft-services-error">{errors.services}</p> : null}
        {rows.map((r, i) => (
          <div key={r.key} className="tn-setup-services__row">
            <Field label={`Serviço ${i + 1}`} value={r.name} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
            <Field label="Minutos" inputMode="numeric" value={r.duration} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, duration: e.target.value } : x)))} />
            <Field label="Preço (R$)" inputMode="decimal" value={r.price} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))} />
            <Button variant="ghost" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Tirar ${r.name || `serviço ${i + 1}`}`}>Tirar</Button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setRows([...rows, rowOf("")])}>Adicionar serviço</Button>
      </fieldset>
      <div className="tn-actions">
        {/* Os erros aparecem embaixo dos campos ao tocar em Salvar; a confirmação só abre com tudo válido. */}
        <ConfirmAction triggerVariant="primary" trigger="Salvar expediente e serviços" title="Salvar o rascunho?" consequence={consequence} confirmLabel="Salvar"
          onConfirm={save} disabled={busy} beforeOpen={validate} canConfirm={problem === null} missingHint={problem ?? undefined} />
      </div>
    </form>
  );
}

function Describe({ port, onSaved }: { port: SetupPort; onSaved: (p: SetupProgress) => void }) {
  const [sentence, setSentence] = useState("");
  const [draft, setDraft] = useState<SetupDescribeDraft | null>(null);
  const { formRef, errors, show } = useFormErrors<"sentence">();
  function build(e: FormEvent) {
    e.preventDefault();
    if (!show({ sentence: sentence.trim().length < 8 && "Escreva uma frase sobre o seu negócio." })) return;
    setDraft(describeBusiness(sentence));
  }
  return (
    <Card aria-labelledby="setup-describe-title">
      <h2 id="setup-describe-title" tabIndex={-1}>Descreva seu negócio em uma frase</h2>
      <p className="tn-muted">Exemplo: “Sou barbeiro, sozinho, de terça a sábado das 9 às 19”. Montamos um rascunho e você revisa cada campo antes de salvar.</p>
      <form ref={formRef} aria-label="Descrever o negócio" onSubmit={build} noValidate>
        <Field as="textarea" label="Sua frase" rows={2} value={sentence} error={errors.sentence} onChange={(e) => setSentence(e.target.value)} />
        <div className="tn-actions">
          <Button type="submit" variant={draft ? "secondary" : "primary"}>{draft ? "Montar de novo" : "Montar rascunho"}</Button>
        </div>
      </form>
      {draft ? <DraftReview key={sentence} draft={draft} port={port} onSaved={onSaved} /> : null}
    </Card>
  );
}

function Templates({ port, onSaved }: { port: SetupPort; onSaved: (p: SetupProgress) => void }) {
  const [data, setData] = useState<{ profession: Profession; templates: SetupTemplate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show } = useFormErrors<"pick">();
  const load = useCallback(() => {
    port.templates().then((d) => { setData(d); setError(null); }, (err) => setError(explain(err)));
  }, [port]);
  useEffect(load, [load]);
  if (error) return <StatusBanner tone="danger">{error}</StatusBanner>;
  if (!data) return <p role="status" className="tn-muted">Carregando modelos…</p>;
  const chosen = data.templates.filter((t) => t.kind === "service" && t.code in picked);
  const drafts: SetupServiceDraft[] = chosen.map((t) => ({ template_code: t.code, name: t.name, duration_min: t.duration_min, base_price_cents: parseCents(picked[t.code] ?? "") ?? -1 }));
  const problem = chosen.length === 0 ? "Marque pelo menos um modelo." : drafts.some((d) => d.base_price_cents < 0) ? "Informe o preço de cada serviço marcado, em reais (ex.: 35,00)." : null;
  const validate = () => show({ pick: problem ?? false });
  async function create() {
    setBusy(true);
    try {
      const out = await port.applyServices(drafts, newKey());
      toast(`${plural(out.created.length, "serviço criado", "serviços criados")}: ${out.created.map((c) => c.name).join(", ")}.`);
      setPicked({});
      onSaved(out.progress);
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  const services = data.templates.filter((t) => t.kind === "service");
  const packages = data.templates.filter((t) => t.kind === "package");
  return (
    <Card aria-labelledby="setup-templates-title">
      <h2 id="setup-templates-title" tabIndex={-1}>Modelos de serviço · {PROFESSION_LABEL[data.profession]}</h2>
      <p className="tn-muted">Marque os que você faz e confirme o preço. A faixa é um ponto de partida, não uma média de mercado. Nada é criado antes de você confirmar.</p>
      <form ref={formRef} aria-label="Modelos de serviço" onSubmit={(e) => e.preventDefault()} noValidate>
        {errors.pick ? <p className="tn-field__error" id="setup-templates-error">{errors.pick}</p> : null}
        <div className="tn-setup-templates">
          {services.map((t) => {
            const range = priceRange(t.price_from_cents, t.price_to_cents);
            const checked = t.code in picked;
            return (
              <div key={t.code} className="tn-setup-template">
                <ChoiceCard type="checkbox" name="template" value={t.code} checked={checked} disabled={t.exists || busy}
                  onChange={(on) => setPicked((p) => {
                    const next = { ...p };
                    if (on) next[t.code] = t.price_from_cents === null ? "" : (t.price_from_cents / 100).toFixed(2).replace(".", ",");
                    else delete next[t.code];
                    return next;
                  })}
                  title={t.exists ? `${t.name} · já no catálogo` : t.name}
                  description={`${t.duration_min} min${range ? ` · faixa ${range}` : ""}`} invalid={!!errors.pick} describedBy={errors.pick ? "setup-templates-error" : undefined} />
                {checked ? (
                  <Field label={`Preço de ${t.name} (R$)`} inputMode="decimal" value={picked[t.code] ?? ""} hint={range ? `Sugestão: ${range}.` : "Preço é seu."}
                    onChange={(e) => setPicked((p) => ({ ...p, [t.code]: e.target.value }))} />
                ) : null}
              </div>
            );
          })}
        </div>
        {packages.length ? (
          <p className="tn-muted">{packages.map((p) => `${p.name}: vende-se no Caixa como pacote${p.price_from_cents !== null ? ` (faixa ${priceRange(p.price_from_cents, p.price_to_cents)})` : ""}, depois de criar o serviço avulso.`).join(" ")}</p>
        ) : null}
        <div className="tn-actions">
          <ConfirmAction triggerVariant="primary" trigger={chosen.length ? `Criar ${plural(chosen.length, "serviço", "serviços")}` : "Criar serviços"} title="Criar os serviços marcados?"
            consequence={drafts.length ? `Entram no catálogo: ${drafts.map((d) => `${d.name} (${d.duration_min} min, ${d.base_price_cents >= 0 ? formatCents(d.base_price_cents) : "sem preço"})`).join("; ")}.` : "Nenhum modelo marcado."}
            confirmLabel="Criar" onConfirm={create} disabled={busy} beforeOpen={validate} canConfirm={problem === null} missingHint={problem ?? undefined} />
        </div>
      </form>
    </Card>
  );
}

export function SetupPage({ port }: { port: SetupPort }) {
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { hash } = useLocation();
  const load = useCallback(() => {
    port.progress().then((p) => { setProgress(p); setError(null); }, (err) => setError(explain(err)));
  }, [port]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1) === "descrever" ? "setup-describe-title" : hash.slice(1) === "modelos" ? "setup-templates-title" : "");
    el?.scrollIntoView?.();
    el?.focus();
  }, [hash]);
  return (
    <div className="tn-setup">
      <div className="tn-page-intro">
        <PageHeader id="setup-title" title="Deixe seu negócio pronto" eyebrow="Configuração"
          subtitle={progress ? `${progress.business_name}: ${progress.done_count} de ${progress.total} passos feitos.` : "Cada passo diz por que importa e leva à tela certa."} />
        {port.kind === "demo" ? <StatusBanner tone="info">Demonstração: o que você salvar aqui vale só nesta aba.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <Help label="Como funciona">
          O estado de cada passo é lido dos seus dados: feito é o que existe de verdade (serviço com preço, expediente, perfil publicado). Nenhum serviço, horário ou preço é gravado sem a sua confirmação.
        </Help>
      </div>
      {progress ? <Steps progress={progress} port={port} onChange={setProgress} /> : <p role="status" className="tn-muted">Carregando os passos…</p>}
      <Describe port={port} onSaved={setProgress} />
      <Templates port={port} onSaved={setProgress} />
    </div>
  );
}

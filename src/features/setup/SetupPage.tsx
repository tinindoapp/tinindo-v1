// Configuração (P44): os 8 passos com por quê e a tela que resolve; "descreva seu negócio em uma frase" (regras
// primeiro, assistente só para o que faltar → rascunho que o dono revisa campo a campo); modelos de serviço da
// profissão como sugestão marcável.
// P50: o rascunho aceita mais de um período por dia e dias com horários diferentes; os serviços vêm com a duração e a
// faixa de preço do modelo da profissão; cada campo recusado diz o motivo; campo preenchido pelo assistente leva selo.
// O que a tela promete é o que o banco garante: nenhum serviço, horário ou preço é gravado sem a confirmação explícita,
// e cada confirmação passa pelas mesmas regras do catálogo (P02) e da agenda (P03).
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import type { Profession, WeeklyWindow } from "@contracts";
import { Button, Card, ChipGroup, ChoiceCard, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors, WEEKDAY_CHIPS, WEEKDAY_SHORTCUTS } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { useScope } from "../../app/scope.tsx";
import { useCommand } from "../../lib/idempotency.ts";
import { centsToInput, parseBRL } from "../../lib/money.ts";
import { setupView } from "../../lib/setup/steps.ts";
import { plural } from "../../lib/text/plural.ts";
import { explain, priceRange, priceText, PROFESSION_LABEL, specOf, stepWhy, summarizeHours } from "./labels.ts";
import { type BusinessDescription, type SetupDescribeOutput, type SetupPort, type SetupProgress, type SetupServiceDraft, type SetupStepCode, type SetupTemplate } from "./port.ts";
import "./setup.css";

const fail = (err: unknown) => toast({ tone: "danger", message: explain(err) });
const PROFESSIONS = ["barber", "hairdresser", "personal_trainer", "other"] as const satisfies readonly Profession[];

function Steps({ progress, port, onChange }: { progress: SetupProgress; port: SetupPort; onChange: (p: SetupProgress) => void }) {
  const [busy, setBusy] = useState<SetupStepCode | null>(null);
  const command = useCommand();
  // P51: passo cuja tela não aparece para o negócio fica fora da lista e da conta.
  const view = setupView(progress, useScope().canOpen);
  async function toggle(step: SetupStepCode, dismissed: boolean) {
    setBusy(step);
    try {
      onChange(await command({ dismiss: [step, dismissed] }, (key) => port.dismiss(step, dismissed, key)));
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
        Passos <span className="tn-num tn-muted">· {view.done} de {view.total} feitos</span>
      </h2>
      {progress.ready ? (
        <StatusBanner tone="success">Seu negócio está pronto para receber reservas pelo link. Os passos que faltam são opcionais.</StatusBanner>
      ) : (
        <p className="tn-muted">Os quatro primeiros deixam o link público funcionando. Os outros podem ficar para depois.</p>
      )}
      <ol className="tn-setup-steps" aria-label="Passos da configuração">
        {view.steps.map((s, i) => {
          const spec = specOf(s.step);
          return (
            <li key={s.step} className="tn-setup-step" data-done={s.done || undefined} data-dismissed={s.dismissed || undefined} data-next={view.next?.step === s.step || undefined}>
              <span className="tn-setup-step__mark" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
              <div className="tn-setup-step__body">
                <p className="tn-setup-step__title">
                  {s.title}
                  {s.done ? <span className="tn-visually-hidden"> (feito)</span> : null}
                  {!s.required ? <span className="tn-setup-step__tag">opcional</span> : null}
                  {s.dismissed ? <span className="tn-setup-step__tag">dispensado</span> : null}
                </p>
                {stepWhy(s) ? <p className="tn-setup-step__why">{stepWhy(s)}</p> : null}
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

/** Chave de lista do React (linhas, períodos e grupos da tela): só identifica a linha na tela, não vai ao servidor. */
let localSeq = 0;
const localKey = () => `k${++localSeq}`;

type ServiceRow = { key: string; template_code: string | null; name: string; duration: string; price: string; range: string | null };
const rowOf = (name: string, duration = "", price = "", template_code: string | null = null, range: string | null = null): ServiceRow =>
  ({ key: localKey(), template_code, name, duration, price, range });
const sameName = (a: string, b: string) => a.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === b.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Dias que compartilham os mesmos períodos. O primeiro grupo é o expediente principal; os outros, dias com horário próprio. */
type PeriodRow = { key: string; start: string; end: string };
type DayGroup = { key: string; weekdays: number[]; periods: PeriodRow[] };
const periodOf = (start = "", end = ""): PeriodRow => ({ key: localKey(), start, end });
const MAX_PERIODS = 3;
const MAX_GROUPS = 4;
const ORDINAL = ["", "2º", "3º"];

function groupsOf(draft: BusinessDescription): DayGroup[] {
  const byDay = new Map<number, PeriodRow[]>();
  for (const w of draft.windows) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), periodOf(w.local_start, w.local_end)]);
  const groups: DayGroup[] = [];
  const signature = (ps: PeriodRow[]) => ps.map((p) => `${p.start}-${p.end}`).join("|");
  for (const [day, periods] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const g = groups.find((x) => signature(x.periods) === signature(periods));
    if (g) g.weekdays.push(day);
    else groups.push({ key: localKey(), weekdays: [day], periods: periods.slice(0, MAX_PERIODS) });
  }
  // O grupo com mais dias vem primeiro (é o "expediente principal" da tela).
  groups.sort((a, b) => b.weekdays.length - a.weekdays.length);
  // Sem expediente lido: um grupo com os dias e o horário soltos que a frase trouxe, para o dono completar.
  if (groups.length === 0) groups.push({ key: localKey(), weekdays: draft.weekdays, periods: [periodOf(draft.start ?? "", draft.end ?? "")] });
  return groups.slice(0, MAX_GROUPS);
}

/** Selo do campo que o assistente preencheu (o resto veio das regras ou do próprio dono). */
function Seal({ on }: { on: boolean }) {
  return on ? <span className="tn-setup-seal">preenchido pelo assistente</span> : null;
}

/** Ressalvas e recusas de um campo, com o motivo, logo acima dele. */
function FieldNotes({ draft, field }: { draft: BusinessDescription; field: BusinessDescription["notes"][number]["field"] }) {
  const notes = draft.notes.filter((n) => n.field === field);
  if (notes.length === 0) return null;
  return (
    <ul className="tn-setup-notes" aria-label={`Avisos de ${{ profession: "profissão", team_size: "equipe", weekdays: "dias", hours: "horário", services: "serviços" }[field]}`}>
      {notes.map((n, i) => <li key={i} data-level={n.level}>{n.text}</li>)}
    </ul>
  );
}

/** Rascunho da frase, campo a campo. Nada é salvo até "Salvar" e a confirmação. */
function DraftReview({ draft, port, onSaved }: { draft: SetupDescribeOutput; port: SetupPort; onSaved: (p: SetupProgress) => void }) {
  const [profession, setProfession] = useState<Profession | "">(draft.profession ?? "");
  const [groups, setGroups] = useState<DayGroup[]>(() => groupsOf(draft));
  const command = useCommand();
  const cited = draft.service_drafts.filter((d) => d.cited);
  const [rows, setRows] = useState<ServiceRow[]>(() => cited.map((d) =>
    rowOf(d.name, d.duration_min === null ? "" : String(d.duration_min), d.price_cents === null ? "" : centsToInput(d.price_cents), d.template_code, priceRange(d.price_from_cents, d.price_to_cents))));
  // Nomes já no catálogo (pelos modelos da profissão atual): o rascunho marca em vez de recusar tudo ao salvar.
  const [existing, setExisting] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"profession" | "weekdays" | "hours" | "services">();
  useEffect(() => {
    let alive = true;
    port.templates().then((t) => alive && setExisting(t.templates.filter((x) => x.exists).map((x) => x.name)), () => undefined);
    return () => {
      alive = false;
    };
  }, [port]);
  const exists = (name: string) => existing.some((n) => sameName(n, name));

  const setGroup = (key: string, patch: (g: DayGroup) => DayGroup) => setGroups((gs) => gs.map((g) => (g.key === key ? patch(g) : g)));
  const setPeriod = (gKey: string, pKey: string, patch: Partial<PeriodRow>) =>
    setGroup(gKey, (g) => ({ ...g, periods: g.periods.map((p) => (p.key === pKey ? { ...p, ...patch } : p)) }));

  const hours: WeeklyWindow[] = useMemo(() => groups.flatMap((g) => g.weekdays.flatMap((weekday) =>
    g.periods.filter((p) => p.start && p.end && p.end > p.start).map((p) => ({ weekday, local_start: p.start, local_end: p.end }))))
    .sort((a, b) => a.weekday - b.weekday || a.local_start.localeCompare(b.local_start)), [groups]);
  const services = rows.filter((r) => r.name.trim() && !exists(r.name));
  const repeated = rows.filter((r) => r.name.trim() && exists(r.name));
  // Preço vazio (null) ou inválido (undefined) vira -1, que servicesOk recusa com a mensagem do campo.
  const parsed: SetupServiceDraft[] = services.map((r) => ({ template_code: r.template_code, name: r.name.trim(), duration_min: Number(r.duration), base_price_cents: parseBRL(r.price) ?? -1 }));
  const badService = parsed.find((s) => !(Number.isInteger(s.duration_min) && s.duration_min >= 5 && s.duration_min <= 1440 && s.base_price_cents >= 0));
  const twice = parsed.find((s, i) => parsed.some((o, j) => j < i && sameName(o.name, s.name)));

  const used = groups.filter((g) => g.weekdays.length > 0 || g.periods.some((p) => p.start || p.end));
  const wantsHours = used.length > 0;
  const filled = (g: DayGroup) => g.periods.filter((p) => p.start || p.end);
  const badPeriod = used.some((g) => filled(g).length === 0 || filled(g).some((p) => !p.start || !p.end || p.end <= p.start));
  const overlap = used.some((g) => [...filled(g)].sort((a, b) => a.start.localeCompare(b.start)).some((p, i, all) => i > 0 && all[i - 1]!.end > p.start));
  const dayTwice = used.some((g, i) => g.weekdays.some((d) => used.some((o, j) => j < i && o.weekdays.includes(d))));
  const problems = {
    profession: !profession && "Escolha a profissão.",
    weekdays: wantsHours && (used.some((g) => g.weekdays.length === 0) ? "Marque os dias de atendimento." : dayTwice && "Um dia não pode estar em dois grupos de horário. Deixe cada dia em um só."),
    hours: wantsHours && (badPeriod ? "Informe início e fim de cada período; o fim vem depois do início." : overlap && "Os períodos do mesmo dia não podem se sobrepor."),
    services: badService ? `${badService.name}: informe a duração (entre 5 e 1440 minutos) e o preço em reais (ex.: 35,00).`
      : twice ? `${twice.name} aparece duas vezes. Deixe um só.` : null,
  };
  const problem = Object.values(problems).find((v): v is string => typeof v === "string") ?? null;
  const validate = () => show(problems);
  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      const input = { profession: profession || null, hours: hours.length ? hours : null, services: parsed };
      const out = await command({ applyDraft: input }, (key) => port.applyDraft(input, key));
      const parts = [out.hours ? `expediente de ${plural(new Set(out.hours.map((h) => h.weekday)).size, "dia")}` : null, out.created.length ? plural(out.created.length, "serviço criado", "serviços criados") : null].filter(Boolean);
      toast(parts.length ? `Salvo: ${parts.join(" e ")}.` : "Profissão salva.");
      onSaved(out.progress);
    } catch (err) {
      // Nome repetido: diz quais nomes foram enviados, em vez de "esse nome" (achado A8).
      const e = err as { code?: string; field?: string } | null;
      if (e?.code === "VALIDATION_ERROR" && e.field === "name") {
        setSaveError(`Já existe um serviço ativo com um destes nomes: ${parsed.map((s) => s.name).join(", ")}. Tire o repetido e salve de novo. Nada foi salvo, nem o expediente.`);
      } else fail(err);
    } finally {
      setBusy(false);
    }
  }
  // Na demonstração, a gravação só chega à Agenda e aos Serviços desta aba quando essas telas estão ligadas à Configuração.
  const reach = port.kind === "demo" ? port.reach ?? { hours: false, services: false } : { hours: true, services: true };
  const consequence = [
    profession ? `Profissão: ${PROFESSION_LABEL[profession]}.` : null,
    hours.length ? `Expediente: ${summarizeHours(hours)} (${reach.hours ? "substitui o atual da agenda principal" : "na demonstração, fica só nesta tela: a Agenda de exemplo não muda"}).` : "Expediente: não muda.",
    parsed.length ? `Serviços: ${parsed.map((s) => `${s.name} (${s.duration_min} min, ${priceText(Math.max(0, s.base_price_cents))})`).join("; ")}.${reach.services ? "" : " Na demonstração, os serviços ficam só nesta tela."}` : "Serviços: nenhum.",
    repeated.length ? `Já no catálogo, não entram de novo: ${repeated.map((r) => r.name.trim()).join(", ")}.` : null,
  ].filter(Boolean).join(" ");

  const suggestions = draft.service_drafts.filter((d) => !exists(d.name) && !rows.some((r) => sameName(r.name, d.name)));
  const unknownText = draft.unknown.map((u) => ({ profession: "a profissão", weekdays: "os dias", hours: "o horário" })[u]);
  const groupTitle = (i: number): ReactNode => (i === 0 ? "Dias de atendimento" : `Dias com outro horário (grupo ${i + 1})`);
  const periodLabel = (gi: number, pi: number, what: "Início" | "Fim") => `${what}${pi > 0 ? ` do ${ORDINAL[pi]} período` : ""}${gi > 0 ? ` (grupo ${gi + 1})` : ""}`;

  return (
    <form ref={formRef} className="tn-setup-draft" aria-label="Rascunho do seu negócio" onSubmit={(e) => e.preventDefault()} noValidate>
      {draft.assistant ? (
        <StatusBanner tone="info">O assistente completou o que não deu para ler pelas regras. Os campos com o selo “preenchido pelo assistente” vieram dele: confira antes de salvar.</StatusBanner>
      ) : null}
      {draft.unknown.length ? (
        <StatusBanner tone="info">Não entendi {unknownText.join(", ")}. O motivo está em cada campo; complete abaixo.</StatusBanner>
      ) : null}
      {draft.team_size !== null && draft.team_size > 1 ? (
        <p className="tn-muted">{plural(draft.team_size, "pessoa atende", "pessoas atendem")}. <Seal on={draft.sources.team_size === "assistant"} /> A agenda principal é uma; outros profissionais entram em Negócio → Equipe.</p>
      ) : null}
      {draft.at_home ? (
        <p className="tn-muted">Você atende a domicílio. Depois de salvar, defina a área de atendimento em <Link to="/app/domicilio">Domicílio</Link>.</p>
      ) : null}
      <div className="tn-setup-field">
        <Seal on={draft.sources.profession === "assistant"} />
        <FieldNotes draft={draft} field="profession" />
        <Field as="select" label="Profissão" value={profession} error={errors.profession} onChange={(e) => setProfession(e.target.value as Profession | "")}>
          <option value="">Escolha…</option>
          {PROFESSIONS.map((p) => <option key={p} value={p}>{PROFESSION_LABEL[p]}</option>)}
        </Field>
      </div>
      <div className="tn-setup-field">
        <Seal on={draft.sources.weekdays === "assistant" || draft.sources.hours === "assistant"} />
        <FieldNotes draft={draft} field="weekdays" />
        <FieldNotes draft={draft} field="hours" />
        {groups.map((g, gi) => (
          <div key={g.key} className="tn-setup-group">
            <ChipGroup label={groupTitle(gi)} options={WEEKDAY_CHIPS} shortcuts={gi === 0 ? WEEKDAY_SHORTCUTS : undefined} value={g.weekdays}
              onChange={(weekdays) => setGroup(g.key, (x) => ({ ...x, weekdays }))} error={gi === 0 ? errors.weekdays : undefined} errorId={`setup-draft-weekdays-error-${gi}`} />
            {g.periods.map((p, pi) => (
              <div key={p.key} className="tn-setup-period">
                <Field label={periodLabel(gi, pi, "Início")} type="time" value={p.start} error={gi === 0 && pi === 0 ? errors.hours : undefined} onChange={(e) => setPeriod(g.key, p.key, { start: e.target.value })} />
                <Field label={periodLabel(gi, pi, "Fim")} type="time" value={p.end} onChange={(e) => setPeriod(g.key, p.key, { end: e.target.value })} />
                {pi > 0 ? (
                  <Button variant="ghost" aria-label={`Tirar o ${ORDINAL[pi]} período${gi > 0 ? ` do grupo ${gi + 1}` : ""}`} onClick={() => setGroup(g.key, (x) => ({ ...x, periods: x.periods.filter((y) => y.key !== p.key) }))}>Tirar</Button>
                ) : null}
              </div>
            ))}
            <div className="tn-actions">
              {g.periods.length < MAX_PERIODS ? (
                <Button variant="ghost" onClick={() => setGroup(g.key, (x) => ({ ...x, periods: [...x.periods, periodOf()] }))}>
                  Adicionar período{gi > 0 ? ` ao grupo ${gi + 1}` : ""}
                </Button>
              ) : null}
              {gi > 0 ? <Button variant="ghost" onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}>Tirar o grupo {gi + 1}</Button> : null}
            </div>
          </div>
        ))}
        {groups.length < MAX_GROUPS ? (
          <Button variant="secondary" onClick={() => setGroups((gs) => [...gs, { key: localKey(), weekdays: [], periods: [periodOf()] }])}>Adicionar dias com outro horário</Button>
        ) : null}
        <p className="tn-muted">Quem atende de manhã e à noite usa dois períodos (ex.: 06:00 às 12:00 e 17:00 às 21:00). Pausa para o almoço também são dois períodos.</p>
      </div>
      <fieldset className="tn-setup-services">
        <legend>Serviços (confira a duração e ponha o seu preço) <Seal on={draft.sources.services === "assistant"} /></legend>
        <FieldNotes draft={draft} field="services" />
        {errors.services ? <p className="tn-field__error" id="setup-draft-services-error">{errors.services}</p> : null}
        {saveError ? <p className="tn-field__error" role="alert">{saveError}</p> : null}
        {rows.map((r, i) => {
          const dup = r.name.trim() !== "" && exists(r.name);
          return (
            <div key={r.key} className="tn-setup-services__row" data-exists={dup || undefined}>
              <Field label={`Serviço ${i + 1}`} value={r.name} hint={dup ? "Já no catálogo: não será criado de novo." : undefined}
                onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value, template_code: null } : x)))} />
              <Field label="Minutos" inputMode="numeric" value={r.duration} disabled={dup} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, duration: e.target.value } : x)))} />
              <Field label="Preço (R$)" inputMode="decimal" value={r.price} disabled={dup} hint={!dup && r.range ? `Faixa de partida: ${r.range}.` : undefined}
                onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))} />
              <Button variant="ghost" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Tirar ${r.name || `serviço ${i + 1}`}`}>Tirar</Button>
            </div>
          );
        })}
        {suggestions.length ? (
          <div className="tn-setup-suggest" role="group" aria-label="Serviços sugeridos">
            <span className="tn-muted">{cited.length ? "Também da sua profissão:" : "A frase não cita serviços. Os mais comuns da sua profissão:"}</span>
            {suggestions.map((d) => (
              <Button key={d.name} variant="secondary" disabled={rows.length >= 20}
                onClick={() => setRows([...rows, rowOf(d.name, d.duration_min === null ? "" : String(d.duration_min), "", d.template_code, priceRange(d.price_from_cents, d.price_to_cents))])}>
                Adicionar {d.name}{d.duration_min !== null ? ` (${d.duration_min} min)` : ""}
              </Button>
            ))}
          </div>
        ) : null}
        <Button variant="secondary" disabled={rows.length >= 20} onClick={() => setRows([...rows, rowOf("")])}>Adicionar serviço</Button>
        {draft.packages.map((p, i) => (
          <p key={i} className="tn-muted">
            Pacote de {p.sessions} sessões{p.service ? ` de ${p.service}` : ""}: vende-se no Caixa como pacote, depois de criar o serviço avulso. Não vira serviço nem equipe.
          </p>
        ))}
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
  const [draft, setDraft] = useState<{ id: string; value: SetupDescribeOutput } | null>(null);
  const [busy, setBusy] = useState(false);
  const command = useCommand();
  const { formRef, errors, show } = useFormErrors<"sentence">();
  async function build(e: FormEvent) {
    e.preventDefault();
    if (!show({ sentence: sentence.trim().length < 8 && "Escreva uma frase sobre o seu negócio." })) return;
    setBusy(true);
    try {
      // Cada rascunho montado recomeça a revisão (o que o dono tinha mexido no anterior não se mistura).
      const text = sentence.trim().slice(0, 500);
      setDraft({ id: localKey(), value: await command({ describe: text }, (key) => port.describe(text, key)) });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card aria-labelledby="setup-describe-title">
      <h2 id="setup-describe-title" tabIndex={-1}>Descreva seu negócio em uma frase</h2>
      <p className="tn-muted">Exemplo: “Sou barbeiro, sozinho, de terça a sábado das 9 às 19, faço corte e barba”. Montamos um rascunho e você revisa cada campo antes de salvar.</p>
      <form ref={formRef} aria-label="Descrever o negócio" onSubmit={(e) => void build(e)} noValidate>
        <Field as="textarea" label="Sua frase" rows={2} maxLength={500} value={sentence} error={errors.sentence} onChange={(e) => setSentence(e.target.value)} />
        <div className="tn-actions">
          <Button type="submit" variant={draft ? "secondary" : "primary"} loading={busy} loadingText="Montando…">{draft ? "Montar de novo" : "Montar rascunho"}</Button>
        </div>
      </form>
      {draft ? <DraftReview key={draft.id} draft={draft.value} port={port} onSaved={onSaved} /> : null}
    </Card>
  );
}

function Templates({ port, onSaved, version, onReady }: { port: SetupPort; onSaved: (p: SetupProgress) => void; version: number; onReady: () => void }) {
  const [data, setData] = useState<{ profession: Profession; templates: SetupTemplate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const command = useCommand();
  const { formRef, errors, show } = useFormErrors<"pick">();
  const load = useCallback(() => {
    port.templates().then((d) => { setData(d); setError(null); onReady(); }, (err) => { setError(explain(err)); onReady(); });
  }, [port, onReady]);
  // `version` muda quando o rascunho salva: a profissão ou o catálogo podem ter mudado.
  useEffect(load, [load, version]);
  if (error) return <StatusBanner tone="danger">{error}</StatusBanner>;
  if (!data) return <p role="status" className="tn-muted">Carregando modelos…</p>;
  const chosen = data.templates.filter((t) => t.kind === "service" && t.code in picked);
  const drafts: SetupServiceDraft[] = chosen.map((t) => ({ template_code: t.code, name: t.name, duration_min: t.duration_min, base_price_cents: parseBRL(picked[t.code] ?? "") ?? -1 }));
  const problem = chosen.length === 0 ? "Marque pelo menos um modelo." : drafts.some((d) => d.base_price_cents < 0) ? "Informe o preço de cada serviço marcado, em reais (ex.: 35,00)." : null;
  const validate = () => show({ pick: problem ?? false });
  async function create() {
    setBusy(true);
    try {
      const out = await command({ applyServices: [drafts] }, (key) => port.applyServices(drafts, key));
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
                    if (on) next[t.code] = t.price_from_cents === null ? "" : centsToInput(t.price_from_cents);
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
            consequence={drafts.length ? `Entram no catálogo: ${drafts.map((d) => `${d.name} (${d.duration_min} min, ${d.base_price_cents >= 0 ? priceText(d.base_price_cents) : "sem preço"})`).join("; ")}.` : "Nenhum modelo marcado."}
            confirmLabel="Criar" onConfirm={create} disabled={busy} beforeOpen={validate} canConfirm={problem === null} missingHint={problem ?? undefined} />
        </div>
      </form>
    </Card>
  );
}

const ANCHORS: Record<string, string> = { "#descrever": "setup-describe-title", "#modelos": "setup-templates-title" };

export function SetupPage({ port }: { port: SetupPort }) {
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templatesReady, setTemplatesReady] = useState(false);
  const [templatesVersion, setTemplatesVersion] = useState(0);
  const { hash } = useLocation();
  const load = useCallback(() => {
    port.progress().then((p) => { setProgress(p); setError(null); }, (err) => setError(explain(err)));
  }, [port]);
  useEffect(load, [load]);
  const onTemplatesReady = useCallback(() => setTemplatesReady(true), []);
  // Âncoras (#descrever, #modelos): só rola depois que os passos e os modelos carregaram. Antes disso o título de
  // "Modelos" nem existe e o de "Descreva" muda de lugar quando a lista de passos entra.
  const settled = (progress !== null || error !== null) && templatesReady;
  useEffect(() => {
    const id = ANCHORS[hash];
    if (!id || !settled) return;
    const el = document.getElementById(id);
    el?.scrollIntoView?.({ block: "start" });
    el?.focus({ preventScroll: true });
  }, [hash, settled]);
  // P51: a conta só com os passos cuja tela aparece para o negócio, a mesma da lista e da Home.
  const scope = useScope();
  const view = progress ? setupView(progress, scope.canOpen) : null;
  const onDraftSaved = useCallback((p: SetupProgress) => {
    setProgress(p);
    setTemplatesVersion((v) => v + 1);
  }, []);
  return (
    <div className="tn-setup">
      <div className="tn-page-intro">
        <PageHeader id="setup-title" title="Deixe seu negócio pronto" eyebrow="Configuração"
          subtitle={progress && view ? `${progress.business_name}: ${view.done} de ${view.total} passos feitos.` : "Cada passo diz por que importa e leva à tela certa."} />
        {port.kind === "demo" ? <StatusBanner tone="info">Demonstração: o que você salvar aqui vale só nesta aba.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <Help label="Como funciona">
          O estado de cada passo é lido dos seus dados: feito é o que existe de verdade (serviço com preço, expediente, perfil publicado). Nenhum serviço, horário ou preço é gravado sem a sua confirmação.
        </Help>
      </div>
      {progress ? <Steps progress={progress} port={port} onChange={setProgress} /> : <p role="status" className="tn-muted">Carregando os passos…</p>}
      <Describe port={port} onSaved={onDraftSaved} />
      <Templates port={port} onSaved={setProgress} version={templatesVersion} onReady={onTemplatesReady} />
    </div>
  );
}

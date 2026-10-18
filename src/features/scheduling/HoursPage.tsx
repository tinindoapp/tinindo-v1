// Expediente semanal e bloqueios pessoais (P03 · schedule.*). Sem expediente não há horário livre.
// Bloqueio é indisponibilidade, não cliente fictício; não pode cobrir atendimento já marcado.
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import type { ScheduleSettings } from "@contracts";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
import { formatRange } from "./agenda.ts";
import { isErrorLike } from "./errors.ts";
import { DemoNotice, ErrorPanel, TimezoneNote } from "./parts.tsx";
import { newIdempotencyKey } from "./port.ts";
import { useAsync, useBase, usePort } from "./SchedulingLayout.tsx";
import { dayWindow, formatDayLong, isCivilDate, localParts, toZonedIso, zonedInstant } from "./time.ts";

const WEEK: { day: number; label: string }[] = [
  { day: 1, label: "Segunda" },
  { day: 2, label: "Terça" },
  { day: 3, label: "Quarta" },
  { day: 4, label: "Quinta" },
  { day: 5, label: "Sexta" },
  { day: 6, label: "Sábado" },
  { day: 0, label: "Domingo" },
];
const BLOCKS_AHEAD_DAYS = 60;

type Interval = { start: string; end: string };
type Draft = Record<number, Interval[]>;

function toDraft(s: ScheduleSettings): Draft {
  const d: Draft = {};
  for (const r of s.rules) (d[r.weekday] ??= []).push({ start: r.local_start, end: r.local_end });
  return d;
}

/** Erro de preenchimento antes de ir ao servidor (o servidor revalida tudo). */
function draftProblem(d: Draft): string | null {
  for (const { day, label } of WEEK) {
    const list = [...(d[day] ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < list.length; i++) {
      const it = list[i]!;
      if (!it.start || !it.end || it.end <= it.start) return `${label}: o fim de cada faixa deve ser depois do início.`;
      if (i > 0 && list[i - 1]!.end > it.start) return `${label}: as faixas se sobrepõem.`;
    }
  }
  return null;
}

/** Mesma chave para o mesmo pedido (repetir não duplica); pedido diferente, chave nova. */
function useAttemptKey() {
  const [attempt, setAttempt] = useState<{ sig: string; key: string } | null>(null);
  return (payload: unknown) => {
    const sig = JSON.stringify(payload);
    const key = attempt?.sig === sig ? attempt.key : newIdempotencyKey();
    setAttempt({ sig, key });
    return key;
  };
}

export function HoursPage() {
  const port = usePort();
  const { ctx } = useBase();
  const settings = useAsync("settings", () => port.settings());

  return (
    <section aria-labelledby="hours-title" className="tn-sched">
      <p className="tn-caps">Agenda</p>
      <h1 id="hours-title">Horários de atendimento</h1>
      <DemoNotice kind={port.kind} />
      <p>
        <Link to="..">Voltar para a agenda</Link>
      </p>
      {settings.error ? (
        <ErrorPanel error={settings.error} operation="load" onRetry={settings.reload} />
      ) : !settings.data ? (
        <p role="status" className="tn-sched-loading">
          Carregando o expediente…
        </p>
      ) : (
        <>
          <WeeklyHours key={settings.data.resource_version} settings={settings.data} onSaved={settings.reload} />
          <Blocks resourceId={settings.data.resource_id} />
        </>
      )}
      <TimezoneNote timezone={ctx.timezone} at={port.now()} />
    </section>
  );
}

function WeeklyHours({ settings, onSaved }: { settings: ScheduleSettings; onSaved: () => void }) {
  const port = usePort();
  const keyFor = useAttemptKey();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  const edit = (day: number, next: Interval[]) => {
    setDraft((d) => ({ ...d, [day]: next }));
    setSaved(false);
  };

  async function save() {
    const p = draftProblem(draft);
    setProblem(p);
    if (p) return;
    const payload = {
      resource_id: settings.resource_id,
      expected_version: settings.resource_version,
      rules: WEEK.flatMap(({ day }) => (draft[day] ?? []).map((i) => ({ weekday: day, local_start: i.start, local_end: i.end }))),
    };
    setPending(true);
    setFailure(null);
    try {
      await port.saveRules(payload, keyFor(payload));
      setSaved(true);
      onSaved();
    } catch (err) {
      setFailure(err);
      if (isErrorLike(err) && err.code === "STALE_VERSION") onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="weekly-title" className="tn-sched-hours">
      <h2 id="weekly-title">Expediente semanal</h2>
      <p className="tn-sched-muted">
        Faixas em que você atende. O intervalo entre duas faixas do mesmo dia vira pausa. Mudar o expediente não mexe nos
        atendimentos já marcados.
      </p>
      {saved ? <StatusBanner tone="success">Expediente salvo.</StatusBanner> : null}
      {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
      {failure ? <ErrorPanel error={failure} operation="load" /> : null}
      {WEEK.map(({ day, label }) => {
        const list = draft[day] ?? [];
        return (
          <fieldset key={day} className="tn-sched-fieldset tn-sched-hours__day">
            <legend>{label}</legend>
            {list.length === 0 ? <p className="tn-sched-muted">Fechado</p> : null}
            {list.map((it, i) => (
              <div key={i} className="tn-sched-hours__row">
                <div className="tn-field">
                  <label htmlFor={`h-${day}-${i}-s`}>Início</label>
                  <input id={`h-${day}-${i}-s`} type="time" step={900} value={it.start}
                    onChange={(e) => edit(day, list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                </div>
                <div className="tn-field">
                  <label htmlFor={`h-${day}-${i}-e`}>Fim</label>
                  <input id={`h-${day}-${i}-e`} type="time" step={900} value={it.end}
                    onChange={(e) => edit(day, list.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                </div>
                <Button variant="ghost" onClick={() => edit(day, list.filter((_, j) => j !== i))}>
                  Remover<span className="tn-visually-hidden"> faixa de {label}</span>
                </Button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => edit(day, [...list, list.length ? { start: "13:00", end: "18:00" } : { start: "09:00", end: "12:00" }])}>
              Adicionar faixa<span className="tn-visually-hidden"> em {label}</span>
            </Button>
          </fieldset>
        );
      })}
      <div className="tn-sched-actions">
        <Button onClick={() => void save()} disabled={pending} aria-busy={pending || undefined}>
          {pending ? "Salvando…" : "Salvar expediente"}
        </Button>
      </div>
    </section>
  );
}

function Blocks({ resourceId }: { resourceId: string }) {
  const port = usePort();
  const { ctx } = useBase();
  const tz = ctx.timezone;
  const today = localParts(port.now(), tz).date;
  const keyFor = useAttemptKey();
  const plans = useAsync(`blocks:${today}`, () => port.dayPlans(dayWindow(today, tz, BLOCKS_AHEAD_DAYS)));
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState("14:00");
  const [to, setTo] = useState("16:00");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const blocks = new Map<string, { id: string; version: number; range: { starts_at: string; ends_at: string }; label: string }>();
  for (const p of plans.data ?? []) {
    for (const b of p.blocks) if (b.id && b.version) blocks.set(b.id, { id: b.id, version: b.version, range: b.range, label: b.label });
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!label.trim()) return setMessage({ tone: "danger", text: "Diga o motivo do bloqueio (só você vê)." });
    if (!to || !from || to <= from) return setMessage({ tone: "danger", text: "O fim deve ser depois do início." });
    const payload = {
      resource_id: resourceId,
      range: { starts_at: toZonedIso(zonedInstant(date, from, tz), tz), ends_at: toZonedIso(zonedInstant(date, to, tz), tz) },
      label: label.trim(),
    };
    setPending(true);
    try {
      await port.createBlock(payload, keyFor(payload));
      setMessage({ tone: "success", text: "Bloqueio criado. Esse período não aparece mais como livre." });
      setLabel("");
      plans.reload();
    } catch (err) {
      setMessage({ tone: "danger", text: blockError(err) });
    } finally {
      setPending(false);
    }
  }

  async function remove(b: { id: string; version: number }) {
    setPending(true);
    try {
      await port.removeBlock({ block_id: b.id, expected_version: b.version }, newIdempotencyKey());
      setMessage({ tone: "success", text: "Bloqueio removido." });
    } catch (err) {
      setMessage({ tone: "danger", text: blockError(err) });
    } finally {
      setPending(false);
      plans.reload();
    }
  }

  return (
    <section aria-labelledby="blocks-title" className="tn-sched-hours">
      <h2 id="blocks-title">Bloqueios</h2>
      <p className="tn-sched-muted">Compromissos pessoais, folgas e férias. Só você vê o motivo.</p>
      {message ? <StatusBanner tone={message.tone}>{message.text}</StatusBanner> : null}
      <form onSubmit={(e) => void create(e)} className="tn-sched-hours__row tn-sched-hours__form" noValidate>
        <div className="tn-field">
          <label htmlFor="blk-date">Dia</label>
          <input id="blk-date" type="date" min={today} value={date} onChange={(e) => isCivilDate(e.target.value) && setDate(e.target.value)} />
        </div>
        <div className="tn-field">
          <label htmlFor="blk-from">Das</label>
          <input id="blk-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="tn-field">
          <label htmlFor="blk-to">Até</label>
          <input id="blk-to" type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="tn-field">
          <label htmlFor="blk-label">Motivo</label>
          <input id="blk-label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending}>
          Bloquear
        </Button>
      </form>
      <h3>Próximos {BLOCKS_AHEAD_DAYS} dias</h3>
      {plans.error ? (
        <ErrorPanel error={plans.error} operation="load" onRetry={plans.reload} />
      ) : !plans.data ? (
        <p role="status" className="tn-sched-loading">
          Carregando bloqueios…
        </p>
      ) : blocks.size === 0 ? (
        <p className="tn-sched-empty">Nenhum bloqueio.</p>
      ) : (
        <ul className="tn-sched-list">
          {[...blocks.values()].map((b) => (
            <li key={b.id} className="tn-sched-hours__row">
              <span>
                <strong>{b.label}</strong>{" "}
                <span className="tn-num">
                  {formatDayLong(localParts(b.range.starts_at, tz).date)}, {formatRange(b.range, tz)}
                </span>
              </span>
              <Button variant="ghost" disabled={pending} onClick={() => void remove(b)}>
                Remover<span className="tn-visually-hidden"> bloqueio {b.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="tn-sched-muted">Para bloquear vários dias, crie um bloqueio por dia.</p>
    </section>
  );
}

function blockError(err: unknown): string {
  if (isErrorLike(err)) {
    if (err.code === "SLOT_CONFLICT") return "Há atendimento marcado nesse período. Reagende ou cancele antes de bloquear. Nada foi bloqueado.";
    if (err.code === "STALE_VERSION") return "O bloqueio mudou em outro lugar. Recarregamos a lista.";
    if (err.code === "VALIDATION_ERROR") return "Confira o dia, o horário e o motivo. Nada foi gravado.";
  }
  return "Não foi possível concluir agora. Tentar de novo é seguro.";
}

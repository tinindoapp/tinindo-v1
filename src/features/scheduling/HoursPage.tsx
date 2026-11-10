// Expediente semanal e bloqueios pessoais (P03 · schedule.*). Sem expediente não há horário livre.
// Bloqueio é indisponibilidade, não cliente fictício; não pode cobrir atendimento já marcado.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import type { ScheduleSettings } from "@contracts";
import { Button, Field, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { useIdempotencyKey } from "../../lib/idempotency.ts";
import { formatRange } from "./agenda.ts";
import { isErrorLike } from "./errors.ts";
import { ErrorPanel, ScreenNotes } from "./parts.tsx";
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

/** Erros de preenchimento por campo (`dia-faixa-s|e`), antes de ir ao servidor (o servidor revalida tudo). */
function draftErrors(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { day } of WEEK) {
    const list = (d[day] ?? []).map((it, i) => ({ ...it, i })).sort((a, b) => a.start.localeCompare(b.start));
    for (let k = 0; k < list.length; k++) {
      const it = list[k]!;
      if (!it.start) errors[`${day}-${it.i}-s`] = "Informe o início.";
      else if (!it.end || it.end <= it.start) errors[`${day}-${it.i}-e`] = "O fim deve ser depois do início.";
      else if (k > 0 && list[k - 1]!.end > it.start) errors[`${day}-${it.i}-s`] = "Esta faixa começa antes da anterior terminar.";
    }
  }
  return errors;
}

export function HoursPage() {
  const port = usePort();
  const { ctx } = useBase();
  const settings = useAsync("settings", () => port.settings());

  return (
    <section aria-labelledby="hours-title" className="tn-sched">
      <PageHeader id="hours-title" title="Horários de atendimento" />
      <ScreenNotes demo={port.kind === "fixture"} timezone={ctx.timezone} at={port.now()} />
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
    </section>
  );
}

const WEEKDAYS_WORK = [2, 3, 4, 5];

function sameDraft(a: Draft, b: Draft): boolean {
  return WEEK.every(({ day }) => JSON.stringify(a[day] ?? []) === JSON.stringify(b[day] ?? []));
}

/** "09:00–12:00 e 13:00–19:00" ou "Fechado". */
function daySummary(list: Interval[]): string {
  if (list.length === 0) return "Fechado";
  return list.map((i) => `${i.start || "--:--"}–${i.end || "--:--"}`).join(" e ");
}

/**
 * Expediente semanal (auditoria de UX, item 28): um cartão-resumo por dia, que abre para editar; copiar a segunda para os
 * dias úteis; a barra "Salvar" só aparece quando algo mudou; sair com alteração não salva pede confirmação.
 */
function WeeklyHours({ settings, onSaved }: { settings: ScheduleSettings; onSaved: () => void }) {
  const port = usePort();
  // Mesma chave enquanto o pedido for o mesmo; depois do sucesso, o mesmo pedido é outra operação (reset).
  const { keyFor, reset: resetKey } = useIdempotencyKey();
  const [baseline, setBaseline] = useState<Draft>(() => toDraft(settings));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const [note, setNote] = useState<string | null>(null);
  const { formRef, errors, show, clear } = useFormErrors();
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const dirty = !sameDraft(draft, baseline);

  // Aviso ao sair: navegação dentro do app (bloqueio do roteador) e fechar ou recarregar a aba (beforeunload).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const leaveRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (blocker.state === "blocked") leaveRef.current?.focus();
  }, [blocker.state]);

  // "Continuar editando": solta a navegação segurada, fecha a folha do menu do celular se ela ficou aberta (o shell fecha
  // com Esc) e devolve o foco ao "Salvar".
  const saveRef = useRef<HTMLButtonElement>(null);
  const backToSave = useRef(false);
  function stay() {
    if (document.body.dataset.menuOpen) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    backToSave.current = true;
    blocker.reset?.();
  }
  useEffect(() => {
    if (blocker.state !== "unblocked" || !backToSave.current) return;
    backToSave.current = false;
    saveRef.current?.focus();
  }, [blocker.state]);

  const edit = (day: number, next: Interval[]) => {
    setDraft((d) => ({ ...d, [day]: next }));
    setNote(null);
    clear();
  };
  const toggle = (day: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(day)) n.delete(day);
      else n.add(day);
      return n;
    });

  function copyMonday() {
    const monday = draft[1] ?? [];
    setDraft((d) => {
      const next = { ...d };
      for (const day of WEEKDAYS_WORK) next[day] = monday.map((i) => ({ ...i }));
      return next;
    });
    setNote(`Horário de segunda (${daySummary(monday)}) copiado para terça a sexta.`);
    clear();
  }

  function discard() {
    setDraft(baseline);
    setNote(null);
    setFailure(null);
    clear();
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = draftErrors(draft);
    if (Object.keys(found).length) {
      // Abre os dias com erro antes de focar o primeiro campo errado.
      setOpen((o) => new Set([...o, ...Object.keys(found).map((k) => Number(k.split("-")[0]))]));
    }
    if (!show(found)) return;
    const payload = {
      resource_id: settings.resource_id,
      expected_version: settings.resource_version,
      rules: WEEK.flatMap(({ day }) => (draft[day] ?? []).map((i) => ({ weekday: day, local_start: i.start, local_end: i.end }))),
    };
    setPending(true);
    setFailure(null);
    try {
      await port.saveRules(payload, keyFor(payload));
      resetKey();
      setBaseline(draft);
      setNote(null);
      toast("Expediente salvo.");
      onSaved();
    } catch (err) {
      setFailure(err);
      if (isErrorLike(err) && err.code === "STALE_VERSION") onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} aria-labelledby="weekly-title" className="tn-sched-hours" onSubmit={(e) => void save(e)} noValidate>
      <h2 id="weekly-title">Expediente semanal</h2>
      <p className="tn-muted">
        Faixas em que você atende. O intervalo entre duas faixas do mesmo dia vira pausa. Mudar o expediente não mexe nos
        atendimentos já marcados.
      </p>
      <div className="tn-actions">
        <Button variant="secondary" onClick={copyMonday}>
          Usar o horário de segunda nos dias úteis
        </Button>
      </div>
      <ul className="tn-sched-days">
        {WEEK.map(({ day, label }) => {
          const list = draft[day] ?? [];
          const expanded = open.has(day);
          const changed = JSON.stringify(list) !== JSON.stringify(baseline[day] ?? []);
          const panel = `h-${day}-panel`;
          return (
            <li key={day}>
              <fieldset className="tn-sched-fieldset tn-sched-hours__day" data-open={expanded ? "true" : undefined}>
                <legend className="tn-visually-hidden">{label}</legend>
                <div className="tn-sched-hours__summary">
                  <span className="tn-sched-hours__summary-text">
                    <strong aria-hidden="true">{label}</strong>
                    <span className="tn-num" data-closed={list.length === 0 ? "true" : undefined}>{daySummary(list)}</span>
                    {changed ? <span className="tn-sched-hours__changed">Alterado</span> : null}
                  </span>
                  <Button variant="ghost" aria-expanded={expanded} aria-controls={panel} onClick={() => toggle(day)}>
                    {expanded ? "Fechar" : "Editar"}{" "}<span className="tn-visually-hidden">{label}</span>
                  </Button>
                </div>
                <div id={panel} className="tn-sched-hours__panel" hidden={!expanded}>
                  {list.length === 0 ? <p className="tn-muted">Fechado</p> : null}
                  {list.map((it, i) => (
                    <div key={i} className="tn-sched-hours__row">
                      <Field label="Início" id={`h-${day}-${i}-s`} type="time" step={900} value={it.start} error={errors[`${day}-${i}-s`]}
                        onChange={(e) => edit(day, list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                      <Field label="Fim" id={`h-${day}-${i}-e`} type="time" step={900} value={it.end} error={errors[`${day}-${i}-e`]}
                        onChange={(e) => edit(day, list.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                      <Button variant="ghost" onClick={() => edit(day, list.filter((_, j) => j !== i))}>
                        Remover<span className="tn-visually-hidden"> faixa de {label}</span>
                      </Button>
                    </div>
                  ))}
                  <Button variant="secondary" onClick={() => edit(day, [...list, list.length ? { start: "13:00", end: "18:00" } : { start: "09:00", end: "12:00" }])}>
                    Adicionar faixa<span className="tn-visually-hidden"> em {label}</span>
                  </Button>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
      {failure ? <ErrorPanel error={failure} operation="load" /> : null}
      {dirty || blocker.state === "blocked" ? (
        <div className="tn-sched-savebar" role="region" aria-label="Alterações no expediente" data-blocked={blocker.state === "blocked" ? "true" : undefined}>
          {blocker.state === "blocked" ? (
            <>
              <p ref={leaveRef} tabIndex={-1} className="tn-sched-savebar__text">
                <strong>Sair sem salvar?</strong> As mudanças no expediente se perdem.
              </p>
              <div className="tn-actions">
                <Button variant="danger" onClick={() => blocker.proceed?.()}>
                  Sair sem salvar
                </Button>
                <Button variant="secondary" onClick={stay}>
                  Continuar editando
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="tn-sched-savebar__text" role="status">
                {note ?? "Há alterações não salvas no expediente."}
              </p>
              <div className="tn-actions">
                <Button ref={saveRef} type="submit" loading={pending} loadingText="Salvando…">
                  Salvar expediente
                </Button>
                <Button variant="ghost" onClick={discard} disabled={pending}>
                  Descartar
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </form>
  );
}

function Blocks({ resourceId }: { resourceId: string }) {
  const port = usePort();
  const { ctx } = useBase();
  const tz = ctx.timezone;
  const today = localParts(port.now(), tz).date;
  // Mesma chave enquanto o pedido for o mesmo; depois do sucesso, o mesmo pedido é outra operação (reset).
  const { keyFor, reset: resetKey } = useIdempotencyKey();
  const plans = useAsync(`blocks:${today}`, () => port.dayPlans(dayWindow(today, tz, BLOCKS_AHEAD_DAYS)));
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState("14:00");
  const [to, setTo] = useState("16:00");
  const [label, setLabel] = useState("");
  const { formRef, errors, show } = useFormErrors<"label" | "to">();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const blocks = new Map<string, BlockItem>();
  for (const p of plans.data ?? []) {
    for (const b of p.blocks) if (b.id && b.version) blocks.set(b.id, { id: b.id, version: b.version, range: b.range, label: b.label });
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const ok = show({
      to: !to || !from || to <= from ? "O fim deve ser depois do início." : null,
      label: !label.trim() ? "Diga o motivo do bloqueio (só você vê)." : null,
    });
    if (!ok) return;
    const payload = {
      resource_id: resourceId,
      range: { starts_at: toZonedIso(zonedInstant(date, from, tz), tz), ends_at: toZonedIso(zonedInstant(date, to, tz), tz) },
      label: label.trim(),
    };
    setPending(true);
    try {
      await port.createBlock(payload, keyFor(payload));
      // Sem isto, bloquear de novo o mesmo período (depois de remover) repetia a chave: o servidor devolvia
      // a resposta antiga, a tela dizia "Bloqueio criado" e nada era criado.
      resetKey();
      toast("Bloqueio criado. Esse período não aparece mais como livre.");
      setLabel("");
      plans.reload();
    } catch (err) {
      setFailure(blockError(err));
    } finally {
      setPending(false);
    }
  }

  /** Remover volta atrás recriando o mesmo bloqueio (mesmo período e motivo): executa na hora e oferece Desfazer. */
  async function remove(b: BlockItem) {
    setRemoving(b.id);
    try {
      await port.removeBlock({ block_id: b.id, expected_version: b.version }, newIdempotencyKey());
      toast({
        message: `Bloqueio "${b.label}" removido. O período voltou a ficar livre.`,
        action: { label: "Desfazer", onAction: () => undoRemove(b) },
      });
    } catch (err) {
      toast({ tone: "danger", message: blockError(err) });
    } finally {
      setRemoving(null);
      plans.reload();
    }
  }

  async function undoRemove(b: BlockItem) {
    try {
      await port.createBlock({ resource_id: resourceId, range: b.range, label: b.label }, newIdempotencyKey());
      toast(`Bloqueio "${b.label}" refeito.`);
    } catch (err) {
      toast({ tone: "danger", message: blockError(err) });
    } finally {
      plans.reload();
    }
  }

  return (
    <section aria-labelledby="blocks-title" className="tn-sched-hours">
      <h2 id="blocks-title">Bloqueios</h2>
      <p className="tn-muted">Compromissos pessoais, folgas e férias. Só você vê o motivo.</p>
      <form ref={formRef} onSubmit={(e) => void create(e)} className="tn-sched-hours__form" noValidate aria-label="Novo bloqueio">
        <div className="tn-sched-hours__row">
          <Field label="Dia" id="blk-date" type="date" min={today} value={date} onChange={(e) => isCivilDate(e.target.value) && setDate(e.target.value)} />
          <Field label="Das" id="blk-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="Até" id="blk-to" type="time" step={900} value={to} error={errors.to} onChange={(e) => setTo(e.target.value)} />
          <Field label="Motivo" id="blk-label" maxLength={80} value={label} error={errors.label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" loading={pending}>
            Bloquear
          </Button>
        </div>
        {failure ? <StatusBanner tone="danger">{failure}</StatusBanner> : null}
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
        <ul className="tn-item-list">
          {[...blocks.values()].map((b) => (
            <li key={b.id} className="tn-sched-hours__row">
              <span>
                <strong>{b.label}</strong>{" "}
                <span className="tn-num">
                  {formatDayLong(localParts(b.range.starts_at, tz).date)}, {formatRange(b.range, tz)}
                </span>
              </span>
              <Button variant="ghost" loading={removing === b.id} disabled={removing !== null} onClick={() => void remove(b)}>
                Remover<span className="tn-visually-hidden"> bloqueio {b.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="tn-muted">Para bloquear vários dias, crie um bloqueio por dia.</p>
    </section>
  );
}

type BlockItem = { id: string; version: number; range: { starts_at: string; ends_at: string }; label: string };

function blockError(err: unknown): string {
  if (isErrorLike(err)) {
    if (err.code === "SLOT_CONFLICT") return "Há atendimento marcado nesse período. Reagende ou cancele antes de bloquear. Nada foi bloqueado.";
    if (err.code === "STALE_VERSION") return "O bloqueio mudou em outro lugar. Recarregamos a lista.";
    if (err.code === "VALIDATION_ERROR") return "Confira o dia, o horário e o motivo. Nada foi gravado.";
  }
  return "Não foi possível concluir agora. Tentar de novo é seguro.";
}

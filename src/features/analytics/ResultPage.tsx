// Resultado (P18): indicadores do que foi registrado, com a conta (numerador/denominador), o que falta nos dados e a
// comparação com um ponto de partida guardado (baseline). Antes/depois não prova causa; insuficiente e indisponível não viram zero.
import { type FormEvent, useEffect, useState } from "react";
import type { AnalyticsBaseline, AnalyticsMetricsOutput, TimeRange } from "@contracts";
import { Button, Card, Field, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { deltaText, localDayStart, metricMath, metricValue, PERIODS } from "./format.ts";
import { type AnalyticsPort, newKey } from "./port.ts";

function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  if (e?.code === "VALIDATION_ERROR" && e.field === "period") return "O ponto de partida precisa de um período já encerrado (até ontem).";
  if (e?.code === "FORBIDDEN") return "Só o dono do negócio vê os indicadores.";
  if (e?.code === "VALIDATION_ERROR") return "Confira os campos. Nada foi gravado.";
  return "Não foi possível carregar agora. Tentar de novo é seguro.";
}
// Indicadores de uso interno da Tinindo (operação assistida): não são do profissional, ficam fora desta tela.
const INTERNAL_METRICS = new Set<string>(["human_minutes"]);
const fmtDay = (v: string, tz: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(new Date(v));

export function ResultPage({ port }: { port: AnalyticsPort }) {
  const [tz, setTz] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<(typeof PERIODS)[number]["id"]>("28");
  const [baselineId, setBaselineId] = useState("");
  const [data, setData] = useState<AnalyticsMetricsOutput | null>(null);
  const [baselines, setBaselines] = useState<AnalyticsBaseline[]>([]);
  const [error, setError] = useState<unknown>(null);
  // Erro ao guardar fica no formulário; a confirmação sai num aviso curto (Toast).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { formRef, errors, show } = useFormErrors<"label">();
  const [label, setLabel] = useState("Antes da Tinindo");
  const [key, setKey] = useState(newKey);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    port.timezone().then((t) => alive && setTz(t), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port]);
  const period = (id: string, zone: string): TimeRange => {
    const p = PERIODS.find((x) => x.id === id) ?? PERIODS[1];
    return { starts_at: localDayStart(port.now(), p.from, zone), ends_at: localDayStart(port.now(), p.to, zone) };
  };
  useEffect(() => {
    if (!tz) return;
    let alive = true;
    Promise.all([port.metrics(period(periodId, tz), baselineId || null), port.baselines()]).then(([m, b]) => {
      if (!alive) return;
      setData(m);
      setBaselines(b);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
    // period() depende só de periodId/tz/port.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, tz, periodId, baselineId, nonce]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!show({ label: !label.trim() && "Dê um nome ao ponto de partida." }) || !tz) return;
    setSaving(true);
    setSaveError(null);
    try {
      const b = await port.createBaseline(label.trim(), period("28", tz), key);
      setKey(newKey());
      setBaselineId(b.id);
      toast(`Ponto de partida “${b.label}” guardado com os números dos últimos 28 dias. Escolha-o em “Comparar com”.`);
      setNonce((n) => n + 1);
    } catch (err) {
      setSaveError(explain(err));
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="an-title" title="Resultado" />
        <StatusBanner tone="danger">{explain(error)}</StatusBanner>
      </div>
    );
  }
  const zone = tz ?? "America/Sao_Paulo";
  const cmp = (k: string) => data?.comparison?.find((c) => c.key === k);

  return (
    <div className="tn-an">
      <div className="tn-page-intro">
        <PageHeader id="an-title" title="Resultado" />
        <p className="tn-muted">
          Números do que foi registrado na Tinindo. Cada indicador mostra a conta e o que falta nos dados.
          <strong> Comparar antes e depois não prova que a mudança veio da Tinindo.</strong>
        </p>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Agenda sintética, só para demonstração.</StatusBanner> : null}
        <div className="tn-an-controls">
          <Field as="select" label="Período" value={periodId} onChange={(e) => setPeriodId(e.target.value as typeof periodId)}>
            {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Field>
          <Field as="select" label="Comparar com" value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
            <option value="">Sem comparação</option>
            {baselines.map((b) => <option key={b.id} value={b.id}>{b.label} ({fmtDay(b.period.starts_at, zone)}–{fmtDay(b.period.ends_at, zone)})</option>)}
          </Field>
        </div>
        {data ? <p className="tn-muted">De {fmtDay(data.period.starts_at, zone)} a {fmtDay(data.period.ends_at, zone)} (fim não incluído) · atualizado agora.</p> : null}
      </div>

      {data ? (
        <Card aria-labelledby="an-metrics-title">
          <h2 id="an-metrics-title">Indicadores</h2>
          <ul className="tn-an-grid">
            {data.metrics.filter((m) => !INTERNAL_METRICS.has(m.key)).map((m) => {
              const c = cmp(m.key);
              return (
                <li key={m.key} className="tn-an-metric" data-status={m.status}>
                  <h3>{m.label}</h3>
                  <p className="tn-an-value tn-num">{metricValue(m)}</p>
                  {metricMath(m) ? <p className="tn-muted">Conta: {metricMath(m)}</p> : null}
                  {c ? <p className="tn-muted">Ponto de partida: {metricValue({ unit: m.unit, value: c.baseline_value, status: c.baseline_value === null ? "insufficient" : "ok" })} · diferença: {deltaText(m.unit, c.delta)}</p> : null}
                  <p className="tn-an-note">{m.note}</p>
                </li>
              );
            })}
          </ul>
          {data.comparison ? <StatusBanner tone="warning">{data.comparison_note}</StatusBanner> : null}
        </Card>
      ) : <p role="status">Carregando…</p>}

      {data ? (
        <Card aria-labelledby="an-coverage-title">
          <h2 id="an-coverage-title">O que falta nos dados</h2>
          {data.coverage.length === 0 ? <p className="tn-muted">Nenhuma lacuna conhecida neste período.</p> : (
            <ul className="tn-an-list">{data.coverage.map((c) => <li key={c.key}>{c.count !== null ? <strong>{c.count} · </strong> : null}{c.note}</li>)}</ul>
          )}
        </Card>
      ) : null}

      <Card aria-labelledby="an-baseline-title">
        <form ref={formRef} aria-labelledby="an-baseline-title" className="tn-an-controls" onSubmit={(e) => void create(e)} noValidate>
          <h2 id="an-baseline-title">Guardar como ponto de partida</h2>
          <p className="tn-muted">Guarda os números dos últimos 28 dias (até ontem) para comparar depois. Esses números ficam fixos: o que você lançar depois não muda o ponto de partida.</p>
          <Field label="Nome" value={label} maxLength={80} error={errors.label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" loading={saving}>Guardar ponto de partida</Button>
          {saveError ? <StatusBanner tone="danger">{saveError}</StatusBanner> : null}
        </form>
      </Card>
    </div>
  );
}

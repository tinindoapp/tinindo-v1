// Resultado (P18): indicadores do que foi registrado, com a conta (numerador/denominador), o que falta nos dados e a
// comparação com uma baseline congelada. Antes/depois não prova causa; insuficiente e indisponível não viram zero.
import { type FormEvent, useEffect, useState } from "react";
import type { AnalyticsBaseline, AnalyticsMetricsOutput, TimeRange } from "@contracts";
import { Button, Card, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { deltaText, localDayStart, metricMath, metricValue, PERIODS } from "./format.ts";
import { type AnalyticsPort, newKey } from "./port.ts";

function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  if (e?.code === "VALIDATION_ERROR" && e.field === "period") return "A baseline precisa de um período já encerrado (até ontem).";
  if (e?.code === "FORBIDDEN") return "Só o dono do negócio vê os indicadores.";
  if (e?.code === "VALIDATION_ERROR") return "Confira os campos. Nada foi gravado.";
  return "Não foi possível carregar agora. Tentar de novo é seguro.";
}
const fmtDay = (v: string, tz: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(new Date(v));

export function ResultPage({ port }: { port: AnalyticsPort }) {
  const [tz, setTz] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<(typeof PERIODS)[number]["id"]>("28");
  const [baselineId, setBaselineId] = useState("");
  const [data, setData] = useState<AnalyticsMetricsOutput | null>(null);
  const [baselines, setBaselines] = useState<AnalyticsBaseline[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
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
    if (!tz) return;
    try {
      const b = await port.createBaseline(label.trim(), period("28", tz), key);
      setKey(newKey());
      setBaselineId(b.id);
      setNotice({ tone: "success", text: `Baseline “${b.label}” congelada com os números dos últimos 28 dias.` });
      setNonce((n) => n + 1);
    } catch (err) {
      setNotice({ tone: "danger", text: explain(err) });
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
        <p className="tn-an-muted">
          Números do que foi registrado na Tinindo. Cada indicador mostra a conta e o que falta nos dados.
          <strong> Comparar antes e depois não prova que a mudança veio da Tinindo.</strong>
        </p>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Agenda sintética, só para demonstração.</StatusBanner> : null}
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
        <div className="tn-an-controls">
          <label className="tn-an-field">Período
            <select value={periodId} onChange={(e) => setPeriodId(e.target.value as typeof periodId)}>
              {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="tn-an-field">Comparar com
            <select value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
              <option value="">Sem comparação</option>
              {baselines.map((b) => <option key={b.id} value={b.id}>{b.label} ({fmtDay(b.period.starts_at, zone)}–{fmtDay(b.period.ends_at, zone)})</option>)}
            </select>
          </label>
        </div>
        {data ? <p className="tn-an-muted">De {fmtDay(data.period.starts_at, zone)} a {fmtDay(data.period.ends_at, zone)} (fim não incluído) · atualizado agora.</p> : null}
      </div>

      {data ? (
        <Card aria-labelledby="an-metrics-title">
          <h2 id="an-metrics-title">Indicadores</h2>
          <ul className="tn-an-grid">
            {data.metrics.map((m) => {
              const c = cmp(m.key);
              return (
                <li key={m.key} className="tn-an-metric" data-status={m.status}>
                  <h3>{m.label}</h3>
                  <p className="tn-an-value tn-num">{metricValue(m)}</p>
                  {metricMath(m) ? <p className="tn-an-muted">Conta: {metricMath(m)}</p> : null}
                  {c ? <p className="tn-an-muted">Baseline: {metricValue({ unit: m.unit, value: c.baseline_value, status: c.baseline_value === null ? "insufficient" : "ok" })} · diferença: {deltaText(m.unit, c.delta)}</p> : null}
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
          {data.coverage.length === 0 ? <p className="tn-an-muted">Nenhuma lacuna conhecida neste período.</p> : (
            <ul className="tn-an-list">{data.coverage.map((c) => <li key={c.key}>{c.count !== null ? <strong>{c.count} · </strong> : null}{c.note}</li>)}</ul>
          )}
        </Card>
      ) : null}

      <Card aria-labelledby="an-baseline-title">
        <form aria-labelledby="an-baseline-title" className="tn-an-controls" onSubmit={(e) => void create(e)}>
          <h2 id="an-baseline-title">Congelar uma baseline</h2>
          <p className="tn-an-muted">Guarda os números dos últimos 28 dias encerrados como ponto de partida. Lançamentos posteriores não mudam a baseline.</p>
          <label className="tn-an-field">Nome
            <input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <Button type="submit" disabled={!label.trim()}>Congelar baseline</Button>
        </form>
      </Card>
    </div>
  );
}

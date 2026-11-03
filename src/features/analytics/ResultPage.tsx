// Resultado (P18): indicadores do que foi registrado, com a conta (numerador/denominador), o que falta nos dados e a
// comparação com um ponto de partida guardado (baseline). Antes/depois não prova causa; insuficiente e indisponível não viram zero.
import { type FormEvent, useEffect, useState } from "react";
import type { AnalyticsBaseline, AnalyticsMetricsOutput, Metric, TimeRange } from "@contracts";
import { Link } from "react-router";
import { Button, Card, Field, Help, PageHeader, Stat, Stats, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { plural } from "../../lib/text/plural.ts";
import { formatCents, localDayStart, metricMath, metricValue, monthStartOffset, PERIODS, trend } from "./format.ts";
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
// Dinheiro vai na faixa do topo (item 54): Recebido, Gasto e Sobrou, antes dos indicadores de agenda.
const MONEY_KEYS = new Set<string>(["received", "expenses"]);

/** Atalho para fechar a lacuna (item 59): texto do que fazer, com a quantidade, e a tela onde se faz. */
export function coverageAction(key: string, count: number | null): { to: string; label: string } | null {
  const n = count ?? 0;
  if (key === "uncharged" && n > 0) return { to: "/app/caixa", label: `Cobrar ${plural(n, "atendimento")}` };
  if (key === "pending_outcome" && n > 0) return { to: "/app/agenda", label: `Marcar “Atendido” ou “Faltou” em ${plural(n, "atendimento")}` };
  return null;
}

/** Diferença para o ponto de partida: seta e palavra, e "melhorou" ou "piorou" conforme o indicador. */
function TrendText({ metricKey, unit, delta }: { metricKey: Parameters<typeof trend>[0]; unit: Metric["unit"]; delta: number | null }) {
  const t = trend(metricKey, unit, delta);
  if (!t) return <>sem comparação</>;
  return (
    <span className="tn-an-trend" data-verdict={t.verdict ?? undefined}>
      <span aria-hidden="true">{t.arrow} </span>
      <span className="tn-visually-hidden">{t.spoken} </span>
      <span className="tn-num">{t.amount}</span>
      {t.verdict ? <> · <strong>{t.verdict}</strong></> : null}
    </span>
  );
}

function Compared({ metricKey, unit, baseline, delta }: { metricKey: Parameters<typeof trend>[0]; unit: Metric["unit"]; baseline: number | null; delta: number | null }) {
  return (
    <p className="tn-muted">
      Ponto de partida: {metricValue({ unit, value: baseline, status: baseline === null ? "insufficient" : "ok" })} · <TrendText metricKey={metricKey} unit={unit} delta={delta} />
    </p>
  );
}

/** Faixa do dinheiro no topo: o que entrou, o que saiu e quanto sobrou, no mesmo período dos indicadores. */
function MoneyStrip({ data, range }: { data: AnalyticsMetricsOutput; range: string }) {
  const get = (k: string) => data.metrics.find((m) => m.key === k);
  const received = get("received");
  const spent = get("expenses");
  const ok = (m?: Metric) => !!m && m.status === "ok" && m.value !== null;
  const cmp = (k: string) => data.comparison?.find((c) => c.key === k);
  const left = ok(received) && ok(spent) ? received!.value! - spent!.value! : null;
  const cr = cmp("received");
  const cs = cmp("expenses");
  const baseLeft = cr?.baseline_value != null && cs?.baseline_value != null ? cr.baseline_value - cs.baseline_value : null;
  const leftDelta = left !== null && baseLeft !== null ? left - baseLeft : null;
  const hint = (k: string, delta: number | null | undefined, has: boolean) =>
    has ? <>{range} · <TrendText metricKey={k as Parameters<typeof trend>[0]} unit="cents" delta={delta ?? null} /></> : range;
  return (
    <Card aria-labelledby="an-money-title">
      <h2 id="an-money-title">Dinheiro registrado</h2>
      <Stats label="Recebido, gasto e o que sobrou">
        <Stat label="Recebido" value={received ? metricValue(received) : "Dados insuficientes"} hint={hint("received", cr?.delta, !!cr)} />
        <Stat label="Gasto" value={spent ? metricValue(spent) : "Dados insuficientes"} hint={hint("expenses", cs?.delta, !!cs)} />
        <Stat label={left !== null && left < 0 ? "Faltou" : "Sobrou"} value={left === null ? "Dados insuficientes" : formatCents(Math.abs(left))}
          hint={hint("leftover", leftDelta, !!data.comparison)} />
      </Stats>
      <p className="tn-an-note">Recebido menos gasto, só do que foi lançado na Tinindo. Não é lucro nem saldo do banco.</p>
    </Card>
  );
}

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
  const range = data && tz ? `De ${fmtDay(data.period.starts_at, tz)} a ${fmtDay(new Date(Date.parse(data.period.ends_at) - 1).toISOString(), tz)}` : "";
  const period = (id: string, zone: string): TimeRange => {
    const p = PERIODS.find((x) => x.id === id) ?? PERIODS[1];
    const from = p.from ?? monthStartOffset(port.now(), zone);
    return { starts_at: localDayStart(port.now(), from, zone), ends_at: localDayStart(port.now(), p.to, zone) };
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
  const shown = data?.metrics.filter((m) => !INTERNAL_METRICS.has(m.key) && !MONEY_KEYS.has(m.key)) ?? [];
  // "Sem dados" agrupados (item 54): uma lista curta no fim, em vez de cartões vazios entre os números.
  const measured = shown.filter((m) => m.status === "ok" && m.value !== null);
  const missing = shown.filter((m) => !(m.status === "ok" && m.value !== null));

  return (
    <div className="tn-an">
      <div className="tn-page-intro">
        <PageHeader id="an-title" title="Resultado" />
        {/* Um aviso só (item 19): a faixa "Demonstração" do topo já identifica a demonstração; as ressalvas ficam em "Como funciona". */}
        <p className="tn-muted">Números do que foi registrado na Tinindo{port.kind === "demo" ? ", com dados de exemplo" : ""}.</p>
        <Help>
          <p>Cada indicador mostra a conta (quantos de quantos) e o que falta nos dados. Indicador sem dado suficiente aparece como “Dados insuficientes”, nunca como zero.</p>
          <p><strong>Comparar antes e depois não prova que a mudança veio da Tinindo.</strong> Época do ano, preços, clientes e registro incompleto também mudam os números.</p>
        </Help>
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

      {data ? <MoneyStrip data={data} range={range} /> : null}

      {data ? (
        <Card aria-labelledby="an-metrics-title">
          <h2 id="an-metrics-title">Indicadores</h2>
          <ul className="tn-an-grid">
            {measured.map((m) => {
              const c = cmp(m.key);
              return (
                <li key={m.key} className="tn-an-metric" data-status={m.status}>
                  <h3>{m.label}</h3>
                  <p className="tn-an-value tn-num">{metricValue(m)}</p>
                  {/* Período ao lado do número (item 47): o mesmo número em outra tela só bate no mesmo período. */}
                  <p className="tn-muted">{range}</p>
                  {metricMath(m) ? <p className="tn-muted">Conta: {metricMath(m)}</p> : null}
                  {c ? <Compared metricKey={m.key} unit={m.unit} baseline={c.baseline_value} delta={c.delta} /> : null}
                  <p className="tn-an-note">{m.note}</p>
                </li>
              );
            })}
          </ul>
          {missing.length ? (
            <section aria-labelledby="an-missing-title" className="tn-an-missing">
              <h3 id="an-missing-title">Ainda sem dados suficientes</h3>
              <ul className="tn-an-list">
                {missing.map((m) => (
                  <li key={m.key} data-status={m.status}>
                    <strong>{m.label}</strong> · {metricValue(m)}
                    <span className="tn-an-note"> · {m.note}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.comparison ? <StatusBanner tone="warning">{data.comparison_note}</StatusBanner> : null}
        </Card>
      ) : <p role="status">Carregando…</p>}

      {data ? (
        <Card aria-labelledby="an-coverage-title">
          <h2 id="an-coverage-title">O que falta nos dados</h2>
          {data.coverage.length === 0 ? <p className="tn-muted">Nenhuma lacuna conhecida neste período.</p> : (
            <ul className="tn-an-list">
              {data.coverage.map((c) => {
                const fix = coverageAction(c.key, c.count);
                return (
                  <li key={c.key} className="tn-an-gap">
                    <span>{c.count !== null ? <strong className="tn-num">{c.count} · </strong> : null}{c.note}</span>
                    {fix ? <Link className="tn-an-link" to={fix.to}>{fix.label} →</Link> : null}
                  </li>
                );
              })}
            </ul>
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

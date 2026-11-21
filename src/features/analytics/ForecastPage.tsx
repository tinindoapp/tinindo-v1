// P32 bloco 5 · "Próxima semana": previsão simples e honesta. Ocupação esperada por dia e risco de falta por horário,
// pela média das 8 últimas semanas; mostra a base, o acerto nas semanas passadas e a comparação com "igual à semana
// anterior". Só informa: nenhuma ação é tomada sozinha.
import { useEffect, useState } from "react";
import { Card, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { formatDate, localParts } from "../../lib/time.ts";
import type { ForecastOutput, ForecastPort } from "./forecastPort.ts";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const pct = (x: number | null) => (x === null ? "sem número" : `${Math.round(x * 100)}%`);
const num = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Horários com o maior risco de falta (até 5), só os com base própria; empate vai para o mais cedo. */
export function riskiestSlots(f: ForecastOutput, limit = 5) {
  return f.no_show_slots.filter((s) => s.basis === "slot" && (s.risk ?? 0) > 0)
    .sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0) || (a.weekday + 6) % 7 - (b.weekday + 6) % 7 || a.hour - b.hour)
    .slice(0, limit);
}

export function ForecastPage({ port }: { port: ForecastPort }) {
  const today = localParts(port.now(), "America/Sao_Paulo").date;
  const [f, setF] = useState<ForecastOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    port.forecast(today).then(
      (r) => { if (alive) setF(r); },
      () => { if (alive) setError("Não foi possível montar a previsão agora. Tentar de novo é seguro."); },
    );
    return () => { alive = false; };
  }, [port, today]);

  const end = f ? new Date(Date.parse(f.target.ends_at) - 1000) : null;
  return (
    <div className="tn-page-intro tn-an-forecast">
      <PageHeader id="an-forecast-title" title="Próxima semana"
        subtitle="Uma previsão simples, pela média das suas últimas 8 semanas. Só informa: nada muda sozinho na agenda." />
      {port.kind === "demo" ? <StatusBanner tone="info">Demonstração: base de exemplo.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      {!f && !error ? <p role="status">Carregando…</p> : null}
      {f && f.status === "insufficient" ? (
        <Card aria-labelledby="an-forecast-wait">
          <h2 id="an-forecast-wait">dados insuficientes</h2>
          <p>A previsão precisa de pelo menos {f.weeks_needed} semanas fechadas de agenda. Hoje há {f.weeks_of_history}.</p>
          <p className="tn-muted">Com menos que isso, qualquer número seria chute. Volte quando completar {f.weeks_needed} semanas.</p>
        </Card>
      ) : null}
      {f && f.status === "ok" && end ? (
        <>
          <Card aria-labelledby="an-forecast-days">
            <h2 id="an-forecast-days" className="tn-num">Ocupação esperada · {formatDate(f.target.starts_at, f.timezone)} a {formatDate(end, f.timezone)}</h2>
            <p className="tn-muted">Base: {f.weeks_of_history >= 8 ? 8 : f.weeks_of_history} semanas fechadas. Esperado = média de atendimentos naquele dia da semana; ocupação = tempo ocupado sobre o expediente.</p>
            <ul className="tn-an-forecast__days">
              {f.days.filter((d) => d.open_minutes > 0 || d.expected_bookings > 0).map((d) => (
                <li key={d.weekday} className="tn-an-forecast__day">
                  <strong>{WEEKDAY[d.weekday]}</strong>
                  <span className="tn-num">{pct(d.expected_occupancy)}</span>
                  <span className="tn-muted">{num(d.expected_bookings)} esperados · {d.already_booked} já marcados</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card aria-labelledby="an-forecast-risk">
            <h2 id="an-forecast-risk">Risco de falta por horário</h2>
            <p className="tn-muted">
              Faltas entre feitos e faltas nas 8 semanas. Média geral: {pct(f.overall_no_show?.risk ?? null)}
              {f.overall_no_show ? ` (${f.overall_no_show.no_shows} de ${f.overall_no_show.denominator})` : ""}.
              Horário com menos de 3 atendimentos usa a média geral.
            </p>
            {riskiestSlots(f).length === 0 ? <p>Nenhum horário com falta e base própria nas 8 semanas.</p> : (
              <ul className="tn-an-forecast__risk">
                {riskiestSlots(f).map((s) => (
                  <li key={`${s.weekday}-${s.hour}`}>
                    <strong>{WEEKDAY[s.weekday]}, {String(s.hour).padStart(2, "0")}h</strong>{" "}
                    <span className="tn-num">{pct(s.risk)}</span>{" "}
                    <span className="tn-muted">{s.no_shows} de {s.denominator}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card aria-labelledby="an-forecast-acc">
            <h2 id="an-forecast-acc">Quanto a previsão acertou</h2>
            {!f.accuracy ? <p>dados insuficientes: o acerto precisa de 9 semanas fechadas (8 para prever e 1 para comparar).</p> : (
              <>
                <p>
                  Nas últimas {f.accuracy.weeks} semanas: acerto de <strong className="tn-num">{pct(f.accuracy.model_accuracy)}</strong>{" "}
                  ({num(f.accuracy.model_error)} atendimentos de diferença em {f.accuracy.actual}).
                  Repetir a semana anterior acertaria {pct(f.accuracy.baseline_accuracy)}.
                </p>
                <p className="tn-muted">{f.accuracy.beats_baseline
                  ? "A média das 8 semanas errou menos que repetir a semana anterior."
                  : "A média das 8 semanas não errou menos que repetir a semana anterior: use a previsão com cautela."}</p>
                <ul className="tn-an-forecast__back">
                  {f.backtest.map((w) => (
                    <li key={w.starts_at} className="tn-num">
                      Semana de {formatDate(w.starts_at, f.timezone)}: previstos {num(w.predicted)}, aconteceram {w.actual}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

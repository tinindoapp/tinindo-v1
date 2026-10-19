// Custo de atendimento por cliente (P18, operação Tinindo): minutos medidos × custo-hora informado. Premissa, não custo
// contábil; valores contratados têm cobrança manual. O banco decide se quem consulta é operador.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, StatusBanner } from "../../components/ui/index.tsx";
import { formatCents } from "./format.ts";
import type { CostPort, CostToServe } from "./port.ts";

const DAY = 86_400_000;
function parseCents(v: string): number | null {
  const t = v.replace(/R\$|\s|\./g, "").replace(",", ".");
  const n = Number(t);
  return /^\d+(\.\d{1,2})?$/.test(t) && Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function CostPage({ port, now }: { port: CostPort; now: () => Date }) {
  const [hourly, setHourly] = useState("60,00");
  const [data, setData] = useState<CostToServe | null>(null);
  const [error, setError] = useState<{ code?: string } | null>(null);
  const [cents, setCents] = useState(6000);

  useEffect(() => {
    let alive = true;
    const end = now().getTime();
    port.costToServe({ starts_at: new Date(end - 30 * DAY).toISOString(), ends_at: new Date(end).toISOString() }, cents).then(
      (d) => { if (alive) { setData(d); setError(null); } },
      (e: unknown) => alive && setError((e as { code?: string }) ?? {}),
    );
    return () => { alive = false; };
  }, [port, now, cents]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const c = parseCents(hourly);
    if (c !== null) setCents(c);
  }

  return (
    <div className="tn-an">
      <Card aria-labelledby="cost-title">
        <h1 id="cost-title">Custo por cliente</h1>
        <p className="tn-an-muted">Últimos 30 dias. Custo estimado = minutos humanos medidos × custo-hora que você informar (premissa).</p>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor.</StatusBanner> : null}
        {error?.code === "FORBIDDEN" ? <StatusBanner tone="warning">Só a equipe Tinindo acessa esta tela.</StatusBanner> : null}
        {error && error.code !== "FORBIDDEN" ? <StatusBanner tone="danger">Não foi possível carregar agora.</StatusBanner> : null}
        <form className="tn-an-controls" aria-label="Custo-hora" onSubmit={submit}>
          <label className="tn-an-field">Custo-hora (R$)
            <input inputMode="decimal" value={hourly} onChange={(e) => setHourly(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary">Recalcular</Button>
        </form>
      </Card>
      {data ? (
        <Card aria-labelledby="cost-table-title">
          <h2 id="cost-table-title">Por cliente</h2>
          <div className="tn-an-scroll">
            <table className="tn-an-table">
              <thead><tr><th scope="col">Cliente</th><th scope="col">Min. humanos</th><th scope="col">Retrabalho</th><th scope="col">Custo estimado</th><th scope="col">Plano (manual)</th><th scope="col">Serviços contratados</th></tr></thead>
              <tbody>
                {data.tenants.map((t) => (
                  <tr key={t.tenant_id}>
                    <th scope="row">{t.tenant_name}</th>
                    <td className="tn-num">{t.human_minutes}</td>
                    <td className="tn-num">{t.reprocess_minutes}</td>
                    <td className="tn-num">{formatCents(t.estimated_cost_cents)}</td>
                    <td className="tn-num">{formatCents(t.plan_monthly_cents)}</td>
                    <td className="tn-num">{formatCents(t.services_contracted_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row">Total</th><td className="tn-num">{data.totals.human_minutes}</td><td className="tn-num">{data.totals.reprocess_minutes}</td><td className="tn-num">{formatCents(data.totals.estimated_cost_cents)}</td><td /><td /></tr></tfoot>
            </table>
          </div>
          <p className="tn-an-muted">{data.note}</p>
        </Card>
      ) : null}
    </div>
  );
}

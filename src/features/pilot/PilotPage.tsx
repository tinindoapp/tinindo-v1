// P32 · Painel do piloto, só para a equipe Tinindo. Por negócio: o funil do primeiro dia, o uso na semana, onde recebeu
// erro ou recusa, telas do menu que nunca abriu (30 dias), custo (assistente e mensagens) e atendimentos e recebimentos
// em número. Nunca conteúdo. Exporta o mesmo recorte em CSV.
import { useEffect, useMemo, useState } from "react";
import { Button, PageHeader, Section, StatusBanner } from "../../components/ui/index.tsx";
import { formatDateTime } from "../../lib/time.ts";
import { pilotCsv } from "./csv.ts";
import type { PilotBusiness, PilotPanelOutput, PilotPort } from "./port.ts";

const TZ = "America/Sao_Paulo";
// Marca de ordem de bytes: o Excel abre o CSV em UTF-8 com acento certo.
const BOM = String.fromCharCode(0xfeff);
const STEP_TEXT: Record<string, string> = {
  signup: "Criou a conta", configured: "Configurou", link_published: "Publicou o link", first_booking: "Primeiro agendamento",
  first_service: "Primeiro atendimento", first_payment: "Primeiro recebimento", returned: "Voltou no dia seguinte",
};
const PROFESSION: Record<string, string> = { barber: "Barbearia", hairdresser: "Cabeleireiro(a)", personal_trainer: "Personal trainer", other: "Outra" };

export function duration(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(min / 1440)} dias`;
}

/** Telas do menu (uma por módulo) que o negócio não abriu nos últimos 30 dias. */
export function neverOpened(menu: readonly { path: string; label: string }[], opened: readonly string[]): string[] {
  return menu.filter((m) => !opened.some((o) => o === `/app/${m.path}` || o.startsWith(`/app/${m.path}/`))).map((m) => m.label);
}

export function PilotPage({ port, menu }: { port: PilotPort; menu: readonly { path: string; label: string }[] }) {
  const [days, setDays] = useState<7 | 28>(7);
  const [loaded, setLoaded] = useState<{ days: number; data: PilotPanelOutput } | null>(null);
  const [error, setError] = useState<"forbidden" | "other" | null>(null);
  const period = useMemo(() => {
    const end = port.now();
    return { starts_at: new Date(end.getTime() - days * 86_400_000).toISOString(), ends_at: end.toISOString() };
  }, [port, days]);
  useEffect(() => {
    let alive = true;
    port.panel(period).then(
      (d) => { if (alive) { setLoaded({ days, data: d }); setError(null); } },
      (e: unknown) => { if (alive) setError((e as { code?: string }).code === "FORBIDDEN" ? "forbidden" : "other"); },
    );
    return () => { alive = false; };
  }, [port, period, days]);
  // Trocar o período mostra "Carregando…" até chegar a leitura nova.
  const data = loaded?.days === days ? loaded.data : null;

  function download() {
    if (!data) return;
    const blob = new Blob([BOM, pilotCsv(data.businesses)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `piloto-${data.period.ends_at.slice(0, 10)}-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="tn-page-intro tn-pilot">
      <PageHeader id="pilot-title" eyebrow="Operação Tinindo" title="Painel do piloto"
        subtitle="Uso real por negócio: só números e nomes de tela, nunca o conteúdo."
        actions={<Button variant="secondary" onClick={download} disabled={!data}>Exportar CSV</Button>} />
      {port.kind === "demo" ? <StatusBanner tone="info">Demonstração: negócios e números de exemplo.</StatusBanner> : null}
      <div className="tn-pilot__period" role="group" aria-label="Período">
        <Button variant={days === 7 ? "primary" : "secondary"} size="compact" aria-pressed={days === 7} onClick={() => setDays(7)}>Últimos 7 dias</Button>
        <Button variant={days === 28 ? "primary" : "secondary"} size="compact" aria-pressed={days === 28} onClick={() => setDays(28)}>Últimos 28 dias</Button>
      </div>
      {error === "forbidden" ? <StatusBanner tone="warning">Só a equipe Tinindo acessa esta tela.</StatusBanner> : null}
      {error === "other" ? <StatusBanner tone="danger">Não foi possível ler o painel agora. Tentar de novo é seguro.</StatusBanner> : null}
      {!data && !error ? <p role="status">Carregando…</p> : null}
      {data ? (
        <>
          <p className="tn-muted">
            {formatDateTime(data.period.starts_at, TZ)} a {formatDateTime(data.period.ends_at, TZ)} · {data.businesses.length} negócios
            {data.truncated.businesses ? " (mostrando os 200 mais novos)" : ""}.
          </p>
          <ul className="tn-pilot__list" aria-label="Negócios do piloto">
            {data.businesses.map((b) => <BusinessCard key={b.tenant_id} b={b} menu={menu} />)}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function BusinessCard({ b, menu }: { b: PilotBusiness; menu: readonly { path: string; label: string }[] }) {
  const missing = neverOpened(menu, b.usage.opened_30d);
  const sum = (f: "ok" | "refused" | "error") => b.usage.commands.reduce((n, c) => n + c[f], 0);
  return (
    <li className="tn-pilot__card" aria-labelledby={`pilot-${b.tenant_id}`}>
      <h2 id={`pilot-${b.tenant_id}`}>{b.name}</h2>
      <p className="tn-muted">
        {PROFESSION[b.profession] ?? b.profession} · conta criada em {formatDateTime(b.funnel.signup_at, TZ)} · funil {b.funnel.done} de {b.funnel.total}
        {b.usage_enabled ? "" : " · medição de uso desligada pelo negócio"}
      </p>
      <Section id={`pilot-${b.tenant_id}-funnel`} title="Funil do primeiro dia">
        <ol className="tn-pilot__funnel" aria-label={`Funil de ${b.name}`}>
          {b.funnel.steps.map((s) => (
            <li key={s.key} data-done={s.done || undefined}>
              <span>{s.done ? "✓" : "·"} {STEP_TEXT[s.key]}</span>
              <span className="tn-num tn-muted">
                {s.key === "returned" ? (s.done ? "sim" : "não") : s.key === "signup" ? "" : s.done ? `+${duration(s.minutes_since_previous)} (${duration(s.minutes_since_signup)} da conta)` : "ainda não"}
              </span>
            </li>
          ))}
        </ol>
      </Section>
      <Section id={`pilot-${b.tenant_id}-usage`} title="O que usou no período" collapsed>
        <p className="tn-num">{b.usage.active_days} dias com uso · {sum("ok")} ações concluídas · {sum("refused")} recusadas · {sum("error")} com erro</p>
        {b.usage.screens.length ? (
          <ul aria-label="Telas abertas">{b.usage.screens.map((s) => <li key={s.name}><code>{s.name}</code> <span className="tn-num">{s.count}×</span></li>)}</ul>
        ) : <p className="tn-muted">Nenhuma tela aberta no período.</p>}
      </Section>
      <Section id={`pilot-${b.tenant_id}-problems`} title="Erros e recusas" count={b.usage.problems.length || undefined} collapsed>
        {b.usage.problems.length ? (
          <ul aria-label="Erros e recusas">
            {b.usage.problems.map((p) => (
              <li key={`${p.name}|${p.code}|${p.outcome}`}>
                <code>{p.name}</code> · {p.outcome === "refused" ? "recusada" : "erro"} {p.code ? <code>{p.code}</code> : null} · <span className="tn-num">{p.count}×</span>, a última em {formatDateTime(p.last_at, TZ)}
              </li>
            ))}
          </ul>
        ) : <p className="tn-muted">Nenhum erro ou recusa no período.</p>}
      </Section>
      <Section id={`pilot-${b.tenant_id}-never`} title="Telas do menu que nunca abriu (30 dias)" count={missing.length || undefined} collapsed>
        {missing.length ? <p>{missing.join(", ")}</p> : <p className="tn-muted">Abriu todas as telas do menu.</p>}
      </Section>
      <Section id={`pilot-${b.tenant_id}-numbers`} title="Custo e números" collapsed>
        <ul className="tn-num">
          <li>Assistente: US$ {b.cost.assistant_usd.toFixed(4)} em {b.cost.assistant_calls} chamadas ({b.cost.assistant_months})</li>
          <li>Mensagens enviadas: {b.cost.messages_template} de modelo, {b.cost.messages_text} de texto, {b.cost.messages_failed} falharam (o preço é do provedor)</li>
          <li>Agendamentos criados: {b.counts.bookings_created} · atendimentos feitos: {b.counts.services_done} · faltas: {b.counts.no_shows} · cancelados: {b.counts.cancelled}</li>
          <li>Recebimentos registrados: {b.counts.payments}</li>
        </ul>
      </Section>
    </li>
  );
}

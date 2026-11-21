// Saúde da operação (P58), para a equipe Tinindo: o estado do alerta e o que olhar primeiro, depois a fila de eventos, as
// rotinas do worker, os erros da última hora e a versão publicada. Só lê; o que fazer quando acende está no
// release/RUNBOOK.md ("Quando o alerta acende"), citado na própria tela.
import { useEffect, useState } from "react";
import { Button, List, ListItem, PageHeader, Section, StatusBadge, StatusBanner, Summary, SummaryHero, SummaryRows } from "../../components/ui/index.tsx";
import { formatDateTime } from "../../lib/time.ts";
import { HealthError, type OpsHealth, type OpsHealthPort, reasonText } from "./health.ts";

// A equipe opera no horário de Brasília; o painel não depende de negócio selecionado.
const TZ = "America/Sao_Paulo";
const when = (v: string | null) => (v ? formatDateTime(v, TZ) : "—");

const KIND_TEXT: Record<string, string> = { render: "Erro de tela", call: "Chamada sem resposta ou 5xx", unhandled: "Erro solto na página" };

export function HealthPage({ port }: { port: OpsHealthPort }) {
  const [health, setHealth] = useState<OpsHealth | null>(null);
  const [error, setError] = useState<HealthError | null>(null);
  // Cada "Atualizar" pede uma leitura nova; carregando = a última pedida ainda não voltou.
  const [asked, setAsked] = useState(1);
  const [done, setDone] = useState(0);

  useEffect(() => {
    let alive = true;
    port.health().then(
      (h) => { if (alive) { setHealth(h); setError(null); setDone(asked); } },
      (e: unknown) => { if (alive) { setError(e instanceof HealthError ? e : new HealthError(false)); setDone(asked); } },
    );
    return () => { alive = false; };
  }, [port, asked]);
  const loading = done !== asked;

  return (
    <div className="tn-page-intro">
      <PageHeader
        id="ops-health-title"
        eyebrow="Operação Tinindo"
        title="Saúde da operação"
        actions={<Button variant="secondary" onClick={() => setAsked((n) => n + 1)} loading={loading}>Atualizar</Button>}
      />
      {error?.forbidden ? <StatusBanner tone="warning">Só a equipe Tinindo acessa esta tela.</StatusBanner> : null}
      {error && !error.forbidden ? <StatusBanner tone="danger">Não foi possível ler a saúde da operação. Tente atualizar; se continuar, rode <code>npm run smoke</code>.</StatusBanner> : null}
      {health ? <HealthBody h={health} /> : null}
    </div>
  );
}

function HealthBody({ h }: { h: OpsHealth }) {
  const failing = h.ticks.filter((t) => t.enabled && t.consecutive_failures > 0);
  return (
    <>
      {h.attention ? (
        <StatusBanner tone="danger">
          <strong>Precisa de atenção.</strong>
          <ul className="tn-ops-health__reasons">
            {h.reasons.map((r) => <li key={r.code}>{reasonText(r)}</li>)}
          </ul>
          O que fazer, em passos: <code>release/RUNBOOK.md</code>, “Quando o alerta acende”.
        </StatusBanner>
      ) : (
        <StatusBanner tone="success"><strong>Tudo certo.</strong> Nenhum motivo de alerta agora (lido em {when(h.as_of)}).</StatusBanner>
      )}

      <Section id="ops-health-queue" title="Fila de eventos">
        <Summary label="Fila de eventos">
          <SummaryHero id="ops-health-late" label="Atraso do mais antigo vencido" value={`${h.outbox.late_minutes} min`} hint={`Limite: ${h.limits.queue_late_minutes} min`} />
          <SummaryRows label="Situação da fila" rows={[
            { label: "Vencidos esperando", value: h.outbox.due, key: "due" },
            { label: "Pendentes", value: h.outbox.pending, hint: h.outbox.oldest_pending_at ? `Mais antigo desde ${when(h.outbox.oldest_pending_at)}` : undefined, key: "pending" },
            { label: "Em processamento", value: h.outbox.processing, key: "processing" },
            { label: "Mortos (dead-letter)", value: h.outbox.dead, hint: `${h.outbox.dead_24h} nas últimas 24 horas`, key: "dead" },
          ]} />
        </Summary>
        {h.dead_by_type.length > 0 ? (
          <List label="Mortos por tipo de evento">
            {h.dead_by_type.map((d) => <ListItem key={d.event_type} title={<code>{d.event_type}</code>} trailing={<span className="tn-num">{d.count}</span>} />)}
          </List>
        ) : null}
      </Section>

      <Section id="ops-health-ticks" title="Rotinas do worker" count={failing.length || undefined}>
        {failing.length === 0 ? <p className="tn-muted">Nenhuma rotina falhando ({h.ticks.filter((t) => t.enabled).length} ligadas).</p> : null}
        <List label="Rotinas com falha">
          {failing.map((t) => (
            <ListItem
              key={t.name}
              title={<code>{t.name}</code>}
              meta={`${t.last_error ?? "sem mensagem"} · última em ${when(t.last_failed_at)}`}
              trailing={<StatusBadge tone={t.consecutive_failures >= h.limits.tick_failures ? "danger" : "warning"}>{t.consecutive_failures} seguidas</StatusBadge>}
            />
          ))}
        </List>
        {h.ticks.some((t) => !t.enabled) ? <p className="tn-muted">Desligadas: {h.ticks.filter((t) => !t.enabled).map((t) => t.name).join(", ")}.</p> : null}
      </Section>

      <Section id="ops-health-errors" title="Erros na última hora">
        <Summary label="Erros na última hora">
          <SummaryHero id="ops-health-fn-errors" label="5xx das funções" value={h.errors.function_total} hint={`Teto: ${h.limits.function_errors_per_hour} por hora`} />
          <SummaryRows label="Erros por origem" rows={[
            ...h.errors.functions.map((f) => ({ label: <code>{f.fn}</code>, value: f.count, key: `fn-${f.fn}` })),
            ...h.errors.front.map((f) => ({ label: KIND_TEXT[f.kind] ?? f.kind, value: f.count, key: `front-${f.kind}` })),
          ]} />
        </Summary>
        {h.errors.function_total + h.errors.front_total === 0 ? <p className="tn-muted">Nenhum erro registrado.</p> : null}
      </Section>

      <Section id="ops-health-release" title="Versão publicada">
        {h.release ? (
          <SummaryRows label="Versão publicada" rows={[
            { label: h.release.kind === "revert" ? "Revertido para" : "Commit", value: <code>{h.release.sha.slice(0, 12)}</code>, key: "sha" },
            { label: "Ambiente", value: h.release.environment, key: "env" },
            { label: "Quando", value: when(h.release.published_at), key: "at" },
            { label: "Migrations até", value: h.release.migrations_until ?? "—", key: "mig" },
          ]} />
        ) : <p className="tn-muted">Nenhuma publicação registrada neste banco ainda.</p>}
        <p className="tn-muted">
          Rotina do alerta: {h.watch.stale ? "parada" : "rodando"}, última verificação {when(h.watch.checked_at)}
          {h.watch.notified_at ? `; último aviso ${when(h.watch.notified_at)}` : ""}.
        </p>
      </Section>
    </>
  );
}

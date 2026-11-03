// Insights proativos (P45): cartão "Para você esta semana" da Home (até 3, com "Ver" e "Agora não"), a lista completa
// em Metas e sugestões e o resumo semanal. A tela não calcula nada: mostra o que o motor do servidor decidiu, sempre
// com período, número e denominador. "Preparar" cria uma PROPOSTA no fluxo dono (aprovação lá); nada executa aqui.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ActionButton, Card, Section, StatusBanner, toast } from "../../components/ui/index.tsx";
import { actResultText, ddmm, explainInsight, INSIGHT_RULE_LABEL, INSIGHT_STATE, insightEvidence, OUTCOME, RULE_REASON, RULE_STATUS } from "./labels.ts";
import { type Digests, type GrowthAdvicePort, type Insight, type InsightList, newKey } from "./port.ts";

/** Onde a ação acontece (nome da tela, nunca o código do pacote). */
const FLOW_SCREEN: Record<Insight["action"]["flow"], string> = {
  P05: "Preços", P06: "Lista de espera", P07: "Caixa", P13: "Relacionamento", P31: "Contas", P44: "configuração do negócio",
};

function useInsightActions(port: GrowthAdvicePort, reload: () => void) {
  const navigate = useNavigate();
  const snooze = (i: Insight) =>
    port.snoozeInsight(i, newKey()).then(
      () => { toast({ tone: "info", message: `“${INSIGHT_RULE_LABEL[i.rule_code]}” silenciada por 30 dias.` }); reload(); },
      (e: unknown) => { toast({ tone: "danger", message: explainInsight(e) }); reload(); },
    );
  /** Abre a tela do fluxo (registra a decisão para o acompanhamento) ou prepara a proposta e oferece o caminho. */
  const act = (i: Insight) =>
    port.actInsight(i, newKey()).then(
      ({ result }) => {
        if (i.action.kind === "proposal" && result) {
          toast({ message: actResultText(result), action: { label: `Abrir ${FLOW_SCREEN[i.action.flow]}`, onAction: () => void navigate(result.route) } });
          reload();
        } else {
          void navigate(result?.route ?? i.action.route);
        }
      },
      (e: unknown) => { toast({ tone: "danger", message: explainInsight(e) }); reload(); },
    );
  return { snooze, act };
}

function Evidence({ i }: { i: Insight }) {
  return <p className="tn-muted tn-ga-evidence">{insightEvidence(i)}</p>;
}

/** Cartão da Home: até 3 abertos, por prioridade. Some quando a porta falha (a Home não quebra por ele). */
export function InsightsCard({ port }: { port: GrowthAdvicePort }) {
  const [data, setData] = useState<InsightList | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    port.insights("home").then((d) => alive && (setData(d), setFailed(false)), () => alive && setFailed(true));
    return () => { alive = false; };
  }, [port, nonce]);
  const { snooze, act } = useInsightActions(port, () => setNonce((x) => x + 1));
  if (failed) return null;
  return (
    <Section title="Para você esta semana" id="home-insights" action={<Link to="/app/metas">Ver todas</Link>}>
      {!data ? <p role="status" className="tn-muted">Carregando sugestões…</p> : data.insights.length === 0 ? (
        <p className="tn-today__empty">Nada novo por aqui. As sugestões só aparecem quando há dado suficiente.</p>
      ) : (
        <ul className="tn-ga-list tn-insights" aria-label="Sugestões para você">
          {data.insights.map((i) => (
            <li key={i.id} className="tn-ga-item tn-insight" data-rule={i.rule_code}>
              <h3>{i.title}</h3>
              <Evidence i={i} />
              <div className="tn-actions">
                {i.action.kind === "proposal"
                  ? <Link className="tn-button" data-variant="secondary" to={`/app/metas?insight=${i.id}`}>Ver<span className="tn-visually-hidden"> {i.title}</span></Link>
                  : <ActionButton variant="secondary" aria-label={`Ver ${i.title}`} onAct={() => act(i)}>Ver</ActionButton>}
                <ActionButton variant="ghost" aria-label={`Agora não: ${i.title}`} onAct={() => snooze(i)}>Agora não</ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Lista completa em Metas e sugestões: abertos com a ação, os já decididos com o acompanhamento e o que o motor olhou. */
export function InsightsSection({ port, focusId }: { port: GrowthAdvicePort; focusId: string | null }) {
  const [data, setData] = useState<InsightList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const focused = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    let alive = true;
    port.insights("all").then((d) => alive && (setData(d), setError(null)), (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  useEffect(() => {
    if (data && focused.current) {
      focused.current.scrollIntoView?.({ block: "center" });
      focused.current.focus();
    }
  }, [data]);
  const { snooze, act } = useInsightActions(port, () => setNonce((x) => x + 1));
  const open = data?.insights.filter((i) => i.state === "open") ?? [];
  const closed = data?.insights.filter((i) => i.state !== "open") ?? [];
  return (
    <Card aria-labelledby="ga-insights-title">
      <h2 id="ga-insights-title">Sugestões para você</h2>
      <p className="tn-muted">Uma conta por dia sobre os seus números, com regras fixas. Cada sugestão mostra o período, quantos de quantos, e onde agir. Nada muda sem você aprovar na tela do fluxo.</p>
      {error ? <StatusBanner tone="danger">{explainInsight(error)}</StatusBanner> : null}
      {data && open.length === 0 ? <p className="tn-muted">Nenhuma sugestão aberta: as regras só falam quando há dado suficiente.</p> : null}
      <ul className="tn-ga-list" aria-label="Sugestões abertas">
        {open.map((i) => (
          <li key={i.id} id={`insight-${i.id}`} className="tn-ga-item tn-insight" data-rule={i.rule_code} tabIndex={i.id === focusId ? -1 : undefined}
            ref={i.id === focusId ? focused : undefined} data-focus={i.id === focusId ? "true" : undefined}>
            <h3>{i.title}</h3>
            <p>{i.body}</p>
            <Evidence i={i} />
            <p className="tn-muted">Acontece em {FLOW_SCREEN[i.action.flow]}{i.action.kind === "proposal" ? ", como proposta para você aprovar." : "."}</p>
            <div className="tn-actions">
              {i.action.kind === "proposal"
                ? <ActionButton variant="primary" onAct={() => act(i)}>{i.action.label}</ActionButton>
                : <ActionButton variant="secondary" aria-label={`${i.action.label}: ${i.title}`} onAct={() => act(i)}>{i.action.label}</ActionButton>}
              <ActionButton variant="ghost" aria-label={`Agora não: ${i.title}`} onAct={() => snooze(i)}>Agora não</ActionButton>
            </div>
          </li>
        ))}
      </ul>
      {closed.length ? (
        <>
          <h3 className="tn-ga-subtitle">Decididas e encerradas</h3>
          <ul className="tn-ga-list" aria-label="Sugestões decididas">
            {closed.map((i) => (
              <li key={i.id}>
                <strong>{INSIGHT_RULE_LABEL[i.rule_code]}</strong> · {INSIGHT_STATE[i.state]}
                {i.decision ? (i.decision.outcome ? ` · ${OUTCOME[i.decision.outcome]}` : ` · acompanhamento em ${ddmm(i.decision.follow_up_at.slice(0, 10))}`) : ""}
                {i.result?.created ? ` · ${i.result.created === 1 ? "1 proposta" : `${i.result.created} propostas`} no fluxo` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {data?.rules.length ? (
        <details className="tn-help">
          <summary>O que a conta olhou{data.run ? ` (${ddmm(data.run.run_date)})` : ""}</summary>
          <ul className="tn-ga-list" aria-label="Regras e dados">
            {data.rules.map((r) => (
              <li key={r.code}>
                <strong>{INSIGHT_RULE_LABEL[r.code]}</strong>: {r.status ? RULE_STATUS[r.status] : "ainda não calculado"}
                {r.reason && RULE_REASON[r.reason] ? ` (${RULE_REASON[r.reason]})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

/** Resumo semanal por modelo fixo (o mais recente). Usado em Metas e sugestões e na caixa de Mensagens do dono. */
export function WeeklyDigestCard({ port, compact = false }: { port: GrowthAdvicePort; compact?: boolean }) {
  const [data, setData] = useState<Digests | null>(null);
  useEffect(() => {
    let alive = true;
    port.digests().then((d) => alive && setData(d), () => alive && setData({ digests: [] }));
    return () => { alive = false; };
  }, [port]);
  const d = data?.digests[0];
  if (!d) return compact ? null : (
    <Card aria-labelledby="ga-digest-title">
      <h2 id="ga-digest-title">Resumo da semana</h2>
      <p className="tn-muted">{data ? "O primeiro resumo sai depois de uma semana inteira de uso." : "Carregando…"}</p>
    </Card>
  );
  return (
    <Card aria-labelledby={compact ? "msg-digest-title" : "ga-digest-title"}>
      <h2 id={compact ? "msg-digest-title" : "ga-digest-title"}>Resumo da semana{compact ? " · da Tinindo" : ""}</h2>
      <p className="tn-ga-digest">{d.body}</p>
      {compact ? <p><Link to="/app/metas">Ver sugestões em Metas e sugestões</Link></p> : null}
    </Card>
  );
}

// Insights proativos (P45): cartão "Para você esta semana" da Home (até 3, com "Ver" e "Agora não"), a lista completa
// em Metas e sugestões e o resumo semanal. A tela não calcula nada: mostra o que o motor do servidor decidiu, sempre
// com período, número e denominador. "Preparar" cria uma PROPOSTA no fluxo dono (aprovação lá); nada executa aqui.
// "Por quê?" (T3 da revisão de 04/11): em Metas e sugestões, cada sugestão aberta explica a conta numa frase, buscada
// só quando o dono abre (uma chamada; o servidor guarda a frase do assistente por versão). Sem resposta, vale a frase
// fixa por regra, calculada aqui com a mesma evidência. Regra sem dado suficiente explica o que falta.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useScope } from "../../app/scope.tsx";
import { ActionButton, Button, Card, Section, StatusBadge, StatusBanner, toast } from "../../components/ui/index.tsx";
import { fixedExplanation, insufficientExplanation } from "../../../supabase/functions/_shared/domain/agent/explain-fixed.ts";
import { actResultText, ddmm, explainInsight, INSIGHT_RULE_LABEL, INSIGHT_STATE, insightEvidence, OUTCOME, RULE_REASON, RULE_STATUS } from "./labels.ts";
import { type Digests, type GrowthAdvicePort, type Insight, type InsightExplanation, type InsightList, type InsightRule } from "./port.ts";
import { useCommand } from "../../lib/idempotency.ts";

/** Onde a ação acontece (nome da tela, nunca o código do pacote). */
const FLOW_SCREEN: Record<Insight["action"]["flow"], string> = {
  P05: "Preços", P06: "Lista de espera", P07: "Caixa", P13: "Relacionamento", P31: "Contas", P44: "configuração do negócio",
};

function useInsightActions(port: GrowthAdvicePort, reload: () => void) {
  const navigate = useNavigate();
  const command = useCommand();
  const snooze = (i: Insight) =>
    command({ snooze: i.id, version: i.version }, (key) => port.snoozeInsight(i, key)).then(
      () => { toast({ tone: "info", message: `“${INSIGHT_RULE_LABEL[i.rule_code]}” silenciada por 30 dias.` }); reload(); },
      (e: unknown) => { toast({ tone: "danger", message: explainInsight(e) }); reload(); },
    );
  /** Abre a tela do fluxo (registra a decisão para o acompanhamento) ou prepara a proposta e oferece o caminho. */
  const act = (i: Insight) =>
    command({ act: i.id, version: i.version }, (key) => port.actInsight(i, key)).then(
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

/**
 * "Por quê?": abre e fecha a explicação da sugestão. Uma chamada por versão do insight, só ao abrir; "Carregando…"
 * enquanto espera; selo "escrito pelo assistente" quando a frase veio do modelo; sem selo na frase fixa.
 */
function Why({ explain, i }: { explain: NonNullable<GrowthAdvicePort["explain"]>; i: Insight }) {
  const [open, setOpen] = useState(false);
  const [got, setGot] = useState<Pick<InsightExplanation, "text" | "source" | "version"> | null>(null);
  const [loading, setLoading] = useState(false);
  const panel = `insight-why-${i.id}`;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || loading || got?.version === i.version) return;
    setLoading(true);
    explain(i.id).then(
      (r) => setGot(r),
      // A rota não devolve erro por falta de modelo; se a rede falhar, a frase fixa sai daqui mesmo, com a mesma evidência.
      () => setGot({ text: fixedExplanation(i.rule_code, i.evidence), source: "fixed", version: i.version }),
    ).finally(() => setLoading(false));
  };
  return (
    <div className="tn-ga-why">
      <Button variant="ghost" size="compact" aria-expanded={open} aria-controls={panel} onClick={toggle}>
        Por quê?<span className="tn-visually-hidden"> {i.title}</span>
      </Button>
      <div id={panel} className="tn-ga-why__text" aria-live="polite">
        {!open ? null : loading || !got ? <p role="status" className="tn-muted">Carregando…</p> : (
          <p>
            {got.text}
            {got.source === "assistant" ? <> <StatusBadge tone="neutral">escrito pelo assistente</StatusBadge></> : null}
          </p>
        )}
      </div>
    </div>
  );
}

/** Uma regra de "O que a conta olhou". Sem dado suficiente: a frase do que falta (insuficiente não é zero). */
function RuleLine({ r }: { r: InsightRule }) {
  const why = r.status === "insufficient" ? insufficientExplanation(r.reason, r.current) : null;
  return (
    <li>
      <strong>{INSIGHT_RULE_LABEL[r.code]}</strong>: {r.status ? RULE_STATUS[r.status] : "ainda não calculado"}
      {r.reason && RULE_REASON[r.reason] ? ` (${RULE_REASON[r.reason]})` : ""}
      {why ? <p className="tn-muted tn-ga-why__text">{why}</p> : null}
    </li>
  );
}

/**
 * Cartão da Home: os abertos de maior prioridade (até 3; a Hoje mostra 1 desde o P48, com "Ver todas"). Some quando a
 * porta falha (a Home não quebra por ele).
 */
export function InsightsCard({ port, limit = 3 }: { port: GrowthAdvicePort; limit?: number }) {
  const [data, setData] = useState<InsightList | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    port.insights("home").then((d) => alive && (setData(d), setFailed(false)), () => alive && setFailed(true));
    return () => { alive = false; };
  }, [port, nonce]);
  const { snooze, act } = useInsightActions(port, () => setNonce((x) => x + 1));
  // P51: sugestão que leva a uma tela que o negócio não vê (módulo guardado ou desligado) não aparece.
  const scope = useScope();
  const insights = data?.insights.filter((i) => scope.canOpen(i.action.route)) ?? [];
  if (failed) return null;
  return (
    <Section title="Para você esta semana" id="home-insights" action={<Link to="/app/metas">Ver todas</Link>}>
      {!data ? <p role="status" className="tn-muted">Carregando sugestões…</p> : insights.length === 0 ? (
        <p className="tn-today__empty">Nada novo por aqui. As sugestões só aparecem quando há dado suficiente.</p>
      ) : (
        <ul className="tn-ga-list tn-insights" aria-label="Sugestões para você">
          {insights.slice(0, limit).map((i) => (
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
/**
 * Sugestões calculadas sobre os números do negócio. `inCard` (Metas, D12 b): sem cartão próprio, dentro do cartão único
 * "Sugestões" da tela, com título de terceiro nível.
 */
export function InsightsSection({ port, focusId, inCard = false }: { port: GrowthAdvicePort; focusId: string | null; inCard?: boolean }) {
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
  // P51: aberta só se a tela onde a ação acontece aparece para o negócio.
  const scope = useScope();
  const open = data?.insights.filter((i) => i.state === "open" && scope.canOpen(i.action.route)) ?? [];
  const closed = data?.insights.filter((i) => i.state !== "open") ?? [];
  const Wrap = inCard ? InCard : Card;
  return (
    <Wrap aria-labelledby="ga-insights-title">
      {inCard
        ? <h3 id="ga-insights-title" className="tn-ga-subtitle">Sobre os seus números</h3>
        : <h2 id="ga-insights-title">Sugestões para você</h2>}
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
            {port.explain ? <Why explain={port.explain} i={i} /> : null}
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
            {data.rules.map((r: InsightRule) => <RuleLine key={r.code} r={r} />)}
          </ul>
        </details>
      ) : null}
    </Wrap>
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
  const scope = useScope();
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
      {compact && scope.canOpen("/app/metas") ? <p><Link to="/app/metas">Ver sugestões em Metas e sugestões</Link></p> : null}
    </Card>
  );
}

/** Parte de um cartão maior (Metas): mesma estrutura de seção, sem a caixa do cartão. */
function InCard({ children, ...rest }: { children: ReactNode; "aria-labelledby"?: string }) {
  return <section className="tn-ga-part" {...rest}>{children}</section>;
}

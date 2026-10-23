// Metas e conteúdo (P22): metas por indicador do Resultado (progresso = o indicador, com denominador), sugestões por
// regras sobre dado existente (sem LLM) com decisão registrada e acompanhamento observacional, e conteúdo aprovado
// por profissão publicado só pelo escopo autorizado do Perfil (P09). O que a tela promete é o que o banco garante.
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Help, StatusBanner } from "../../components/ui/index.tsx";
import { DECISION, DIRECTION, explain, formatDate, formatTarget, METRIC_LABEL, OUTCOME, pct, PROGRESS_STATUS } from "./labels.ts";
import { type Advice, type Content, type Goal, type GoalList, type GoalMetricKey, type GrowthAdvicePort, newKey } from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
const KEYS = Object.keys(METRIC_LABEL) as GoalMetricKey[];
const isCents = (k: GoalMetricKey) => k === "received" || k === "expenses";
const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

function GoalForm({ port, metrics, onDone }: { port: GrowthAdvicePort; metrics: GoalList["metrics"]; onDone: (n: Notice) => void }) {
  const [key, setKey] = useState<GoalMetricKey>("no_show");
  const [target, setTarget] = useState("10");
  const [note, setNote] = useState("");
  const [idem, setIdem] = useState(newKey);
  const m = metrics.find((x) => x.key === key);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const g = await port.saveGoal({ metric_key: key, target: isCents(key) ? parseBRL(target) : Number(target.replace(",", ".")) / 100, note: note.trim() || null }, idem);
      setIdem(newKey());
      setNote("");
      onDone({ tone: "success", text: `Meta de ${g.label ?? METRIC_LABEL[g.metric_key]} criada: ${formatTarget(g.unit, g.target)} (${DIRECTION[g.direction]}). O progresso é o indicador do mês, com denominador.` });
    } catch (err) {
      setIdem(newKey());
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-ga-form" aria-label="Nova meta" onSubmit={(e) => void submit(e)}>
      <label className="tn-ga-field">Indicador
        <select value={key} onChange={(e) => setKey(e.target.value as GoalMetricKey)}>
          {KEYS.map((k) => <option key={k} value={k}>{METRIC_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="tn-ga-field">{isCents(key) ? "Meta (R$ no mês)" : "Meta (%)"}
        <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label className="tn-ga-field">Nota (opcional)
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="tn-ga-muted">
        {m ? (m.status === "ok" ? `Agora: ${m.unit === "cents" ? formatTarget("cents", m.value ?? 0) : pct(m.value)}${m.denominator !== null ? ` (${m.numerator} de ${m.denominator})` : ""}.` : `Agora: ${PROGRESS_STATUS[m.status]}.`) : ""}
      </p>
      <Button type="submit" disabled={!target.trim()}>Criar meta</Button>
    </form>
  );
}

function GoalItem({ g, port, onDone }: { g: Goal; port: GrowthAdvicePort; onDone: (n: Notice) => void }) {
  const p = g.progress;
  const current = p.status === "ok" ? (g.unit === "cents" ? formatTarget("cents", p.value ?? 0) : pct(p.value)) : PROGRESS_STATUS[p.status];
  return (
    <li className="tn-ga-item">
      <h3>{g.label ?? METRIC_LABEL[g.metric_key]} · meta {formatTarget(g.unit, g.target)}</h3>
      <p><strong>{g.status === "active" ? (p.achieved ? "Atingida" : "Em andamento") : "Arquivada"}</strong> · {DIRECTION[g.direction]} · mês {g.period_start.slice(5, 7)}/{g.period_start.slice(0, 4)}{g.note ? ` · ${g.note}` : ""}</p>
      <p className="tn-ga-muted">Agora: {current}{p.denominator !== null && p.status === "ok" ? ` (${p.numerator} de ${p.denominator})` : ""}{p.attainment !== null ? ` · ${Math.round(p.attainment * 100)}% do caminho` : ""}</p>
      {p.attainment !== null ? <progress className="tn-ga-progress" max={1} value={p.attainment} aria-label={`Progresso de ${g.label ?? g.metric_key}`} /> : null}
      {g.status === "active" ? <div className="tn-ga-actions"><Button variant="ghost" onClick={() => void port.archiveGoal(g, newKey()).then(() => onDone({ tone: "info", text: "Meta arquivada." }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }))}>Arquivar</Button></div> : null}
    </li>
  );
}

function Suggestions({ advice, port, onDone }: { advice: Advice; port: GrowthAdvicePort; onDone: (n: Notice) => void }) {
  const act = (rule: string, decision: "accepted" | "dismissed") =>
    port.decide(rule, decision, newKey()).then(() => onDone({ tone: "success", text: decision === "accepted" ? "Sugestão aceita. Em 30 dias medimos o indicador de novo e mostramos a variação observada (não é prova de efeito)." : "Sugestão dispensada neste mês." }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }));
  return (
    <>
      {advice.suggestions.length === 0 ? <p className="tn-ga-muted">Nenhuma sugestão agora: as regras só falam quando há dado suficiente.</p> : null}
      <ul className="tn-ga-list" aria-label="Sugestões">
        {advice.suggestions.map((s) => (
          <li key={s.rule_code} className="tn-ga-item">
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <p className="tn-ga-muted">Evidência: {Object.entries(s.evidence).map(([k, v]) => `${k} = ${typeof v === "number" && v <= 1 && !["audience", "no_show_n", "completed", "quotes", "sellable_minutes"].includes(k) ? pct(v) : String(v)}`).join(" · ")}</p>
            <div className="tn-ga-actions">
              <Link className="tn-ga-link" to={s.route}>Ir para a tela</Link>
              <Button variant="secondary" onClick={() => void act(s.rule_code, "accepted")}>Vou fazer</Button>
              <Button variant="ghost" onClick={() => void act(s.rule_code, "dismissed")}>Agora não</Button>
            </div>
          </li>
        ))}
      </ul>
      {advice.decisions.length > 0 ? (
        <ul className="tn-ga-list" aria-label="Decisões">
          {advice.decisions.map((d) => <li key={d.id}>{DECISION[d.decision]} em {formatDate(d.decided_at)}: {d.rule_code}{d.outcome ? ` · ${OUTCOME[d.outcome]}` : ` · acompanhamento em ${formatDate(d.follow_up_at)}`}</li>)}
        </ul>
      ) : null}
    </>
  );
}

function ContentSection({ content, port, onDone }: { content: Content; port: GrowthAdvicePort; onDone: (n: Notice) => void }) {
  const canPublish = content.scope.profile_published && content.scope.bio_field;
  return (
    <>
      <p className="tn-ga-muted">Textos aprovados pela Tinindo para a sua profissão, preenchidos com os dados que você já tornou públicos. A apresentação vai para o perfil público só se ele estiver publicado com o campo “apresentação” escolhido (<Link to="/app/perfil">Perfil</Link>). Posts são para você copiar e postar onde quiser.</p>
      {!canPublish ? <StatusBanner tone="warning">Publicação bloqueada: {content.scope.profile_published ? "o campo “apresentação” não está entre os campos públicos escolhidos." : "o perfil público não está publicado."}</StatusBanner> : null}
      {content.published ? (
        <p><strong>Publicado no perfil:</strong> {content.published.body} <Button variant="ghost" onClick={() => void port.unpublish(content.published!.version, newKey()).then(() => onDone({ tone: "info", text: "Apresentação removida do perfil." }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }))}>Remover</Button></p>
      ) : <p className="tn-ga-muted">Nenhuma apresentação publicada.</p>}
      <ul className="tn-ga-list" aria-label="Conteúdo aprovado">
        {content.templates.map((t) => (
          <li key={t.code} className="tn-ga-item">
            <h3>{t.title} <span className="tn-ga-muted">({t.kind === "bio" ? "apresentação" : "post"} · aprovado por {t.approved_by})</span></h3>
            <p>{t.preview}</p>
            {t.kind === "bio" ? <div className="tn-ga-actions"><Button variant="secondary" disabled={!canPublish || content.published?.template_code === t.code} onClick={() => void port.publish(t.code, newKey()).then(() => onDone({ tone: "success", text: `“${t.title}” publicada como apresentação do perfil.` }), (e: unknown) => onDone({ tone: "danger", text: explain(e) }))}>{content.published?.template_code === t.code ? "Publicada" : "Publicar no perfil"}</Button></div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

export function GoalsPage({ port }: { port: GrowthAdvicePort }) {
  const [goals, setGoals] = useState<GoalList | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([port.goals(), port.advice(), port.content()]).then(([g, a, c]) => {
      if (!alive) return;
      setGoals(g);
      setAdvice(a);
      setContent(c);
      setError(null);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const done = (n: Notice) => {
    setNotice(n);
    setNonce((x) => x + 1);
  };
  return (
    <div className="tn-ga">
      <Card aria-labelledby="ga-title">
        <h1 id="ga-title">Metas e conteúdo</h1>
        <Help><p>Metas sobre os indicadores do Resultado, sugestões por regras sobre os seus dados e textos aprovados para a sua profissão. Nada aqui promete resultado: o progresso é o indicador medido, e a variação depois de uma sugestão é observada, não causada.</p></Help>
        <StatusBanner tone="info"><strong>Sem inteligência artificial nas sugestões.</strong> Cada sugestão vem de uma regra fixa sobre um indicador com dado suficiente, e mostra a evidência. Você decide; a Tinindo nunca age sozinha.</StatusBanner>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é publicado de verdade. "Avançar 30 dias" roda o acompanhamento como o worker faria.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
        {port.followUp ? <div className="tn-ga-actions"><Button variant="secondary" onClick={() => void port.followUp!().then((r) => done({ tone: "info", text: `Acompanhamento (simulação): ${r.followed_up} decisão(ões) medida(s) de novo.` }))}>Avançar 30 dias (simulação)</Button></div> : null}
      </Card>
      <Card aria-labelledby="ga-goals-title">
        <h2 id="ga-goals-title">Metas do mês</h2>
        {goals ? <GoalForm key={`new:${nonce}`} port={port} metrics={goals.metrics} onDone={done} /> : null}
        {goals && goals.goals.length === 0 ? <p className="tn-ga-muted">Nenhuma meta ainda.</p> : null}
        <ul className="tn-ga-list" aria-label="Metas">
          {goals?.goals.map((g) => <GoalItem key={g.id} g={g} port={port} onDone={done} />)}
        </ul>
      </Card>
      <Card aria-labelledby="ga-advice-title">
        <h2 id="ga-advice-title">Sugestões</h2>
        {advice ? <Suggestions advice={advice} port={port} onDone={done} /> : null}
      </Card>
      <Card aria-labelledby="ga-content-title">
        <h2 id="ga-content-title">Conteúdo aprovado</h2>
        {content ? <ContentSection content={content} port={port} onDone={done} /> : null}
      </Card>
    </div>
  );
}

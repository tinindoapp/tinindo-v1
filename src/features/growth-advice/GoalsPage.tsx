// Metas e conteúdo (P22): metas por indicador do Resultado (progresso = o indicador, com denominador), sugestões por
// regras sobre dado existente (sem LLM) com decisão registrada e acompanhamento observacional, e conteúdo aprovado
// por profissão publicado só pelo escopo autorizado do Perfil (P09). O que a tela promete é o que o banco garante.
import { type ComponentProps, type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, type ToastInput, useFormErrors } from "../../components/ui/index.tsx";
import { actionLabel, DECISION, DIRECTION, explain, formatDate, formatEvidence, formatTarget, METRIC_LABEL, OUTCOME, pct, PROGRESS_STATUS, RULE_LABEL } from "./labels.ts";
import { type Advice, type Content, type Goal, type GoalList, type GoalMetricKey, type GrowthAdvicePort, newKey } from "./port.ts";

/** Retorno de uma ação: aviso curto (Toast), sempre à vista; `null` só atualiza a tela. */
type Notice = ToastInput | string | null;

/** Botão de ação de um toque: mostra o carregando enquanto a ação roda. */
function ActButton({ onAct, ...props }: Omit<ComponentProps<typeof Button>, "onClick" | "loading"> & { onAct: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return <Button {...props} loading={busy} onClick={() => { setBusy(true); void onAct().finally(() => setBusy(false)); }} />;
}
const failed = (e: unknown): Notice => ({ tone: "danger", message: explain(e) });
const KEYS = Object.keys(METRIC_LABEL) as GoalMetricKey[];
const isCents = (k: GoalMetricKey) => k === "received" || k === "expenses";
const parseBRL = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

/** Período escrito ao lado do número (item 47 da auditoria): "Em outubro até agora". */
const monthSoFar = (iso: string) =>
  `Em ${new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.parse(iso) + 12 * 3_600_000))} até agora`;

function GoalForm({ port, metrics, monthStart, onDone }: { port: GrowthAdvicePort; metrics: GoalList["metrics"]; monthStart: string; onDone: (n: Notice) => void }) {
  const [key, setKey] = useState<GoalMetricKey>("no_show");
  const [target, setTarget] = useState("10");
  const [note, setNote] = useState("");
  const [idem, setIdem] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"target">();
  const m = metrics.find((x) => x.key === key);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = isCents(key) ? parseBRL(target) : Number(target.replace(",", ".")) / 100;
    if (!show({ target: !(Number.isFinite(value) && value > 0) && (isCents(key) ? "Informe a meta em reais." : "Informe a meta em %.") })) return;
    setBusy(true);
    setError(null);
    try {
      const g = await port.saveGoal({ metric_key: key, target: value, note: note.trim() || null }, idem);
      setIdem(newKey());
      setNote("");
      onDone(`Meta de ${g.label ?? METRIC_LABEL[g.metric_key]} criada: ${formatTarget(g.unit, g.target)} (${DIRECTION[g.direction]}). O progresso é o número do mês, com a conta (quantos de quantos).`);
    } catch (err) {
      setIdem(newKey());
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} className="tn-ga-form" aria-label="Nova meta" onSubmit={(e) => void submit(e)} noValidate>
      <Field as="select" label="Indicador" value={key} onChange={(e) => setKey(e.target.value as GoalMetricKey)}>
        {KEYS.map((k) => <option key={k} value={k}>{METRIC_LABEL[k]}</option>)}
      </Field>
      <Field label={isCents(key) ? "Meta (R$ no mês)" : "Meta (%)"} inputMode="decimal" value={target} error={errors.target} onChange={(e) => setTarget(e.target.value)} />
      <Field label="Nota (opcional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="tn-muted tn-ga-now">
        {m ? (m.status === "ok" ? `${monthSoFar(monthStart)}: ${m.unit === "cents" ? formatTarget("cents", m.value ?? 0) : pct(m.value)}${m.denominator !== null ? ` (${m.numerator} de ${m.denominator})` : ""}.` : `${monthSoFar(monthStart)}: ${PROGRESS_STATUS[m.status]}.`) : ""}
      </p>
      <Button type="submit" loading={busy}>Criar meta</Button>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
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
      <p className="tn-muted">{monthSoFar(g.period_start)}: {current}{p.denominator !== null && p.status === "ok" ? ` (${p.numerator} de ${p.denominator})` : ""}{p.attainment !== null ? ` · ${Math.round(p.attainment * 100)}% do caminho` : ""}</p>
      {p.attainment !== null ? <progress className="tn-ga-progress" max={1} value={p.attainment} aria-label={`Progresso de ${g.label ?? g.metric_key}`} /> : null}
      {g.status === "active" ? (
        <div className="tn-actions">
          {/* Não há desarquivar: confirma antes. */}
          <ConfirmAction
            trigger="Arquivar"
            triggerLabel={`Arquivar a meta de ${g.label ?? METRIC_LABEL[g.metric_key]}`}
            title={`Arquivar a meta de ${g.label ?? METRIC_LABEL[g.metric_key]}?`}
            consequence="Ela sai do acompanhamento do mês e não volta. Para acompanhar de novo, crie outra meta."
            confirmLabel="Sim, arquivar"
            onConfirm={() => port.archiveGoal(g, newKey()).then(() => onDone("Meta arquivada."), (e: unknown) => onDone(failed(e)))}
          />
        </div>
      ) : null}
    </li>
  );
}

function Suggestions({ advice, port, onDone }: { advice: Advice; port: GrowthAdvicePort; onDone: (n: Notice) => void }) {
  const act = (rule: string, decision: "accepted" | "dismissed") =>
    port.decide(rule, decision, newKey()).then(() => onDone(decision === "accepted" ? "Sugestão aceita. Em 30 dias medimos o indicador de novo e mostramos a variação observada (não é prova de efeito)." : "Sugestão dispensada neste mês."), (e: unknown) => onDone(failed(e)));
  return (
    <>
      {advice.suggestions.length === 0 ? <p className="tn-muted">Nenhuma sugestão agora: as regras só falam quando há dado suficiente.</p> : null}
      <ul className="tn-ga-list" aria-label="Sugestões">
        {advice.suggestions.map((s) => (
          <li key={s.rule_code} className="tn-ga-item">
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <p className="tn-muted tn-ga-evidence">Evidência: {formatEvidence(s.evidence).map((ph, i) => (
              <span key={i}>{i > 0 ? " · " : ""}{ph.map((c, j) => (c.num ? <span key={j} className="tn-num">{c.text}</span> : c.text))}</span>
            ))}</p>
            <div className="tn-actions">
              {/* Sugestão desta mesma tela (apresentação do perfil) leva à seção de conteúdo; as outras abrem a tela da ação. */}
              {s.route === "/app/metas"
                ? <a className="tn-ga-link tn-ga-action-link" href="#ga-content-title">{actionLabel(s.rule_code, s.route)}</a>
                : <Link className="tn-ga-link tn-ga-action-link" to={s.route}>{actionLabel(s.rule_code, s.route)}</Link>}
              <ActButton variant="secondary" onAct={() => act(s.rule_code, "accepted")}>Vou fazer</ActButton>
              <ActButton variant="ghost" onAct={() => act(s.rule_code, "dismissed")}>Agora não</ActButton>
            </div>
          </li>
        ))}
      </ul>
      {advice.decisions.length > 0 ? (
        <ul className="tn-ga-list" aria-label="Decisões">
          {advice.decisions.map((d) => <li key={d.id}>{DECISION[d.decision]} em {formatDate(d.decided_at)}: {RULE_LABEL[d.rule_code] ?? "Sugestão"}{d.outcome ? ` · ${OUTCOME[d.outcome]}` : ` · acompanhamento em ${formatDate(d.follow_up_at)}`}</li>)}
        </ul>
      ) : null}
    </>
  );
}

function ContentSection({ content, port, onDone }: { content: Content; port: GrowthAdvicePort; onDone: (n: Notice) => void }) {
  const canPublish = content.scope.profile_published && content.scope.bio_field;
  const publish = (code: string, title: string) =>
    port.publish(code, newKey()).then(() => onDone(`“${title}” publicada como apresentação do perfil.`), (e: unknown) => onDone(failed(e)));
  // Remover volta atrás publicando o mesmo texto de novo: executa na hora e oferece Desfazer.
  const unpublish = (p: NonNullable<Content["published"]>) => {
    const title = content.templates.find((t) => t.code === p.template_code)?.title ?? "Apresentação";
    return port.unpublish(p.version, newKey()).then(
      () => onDone({ message: "Apresentação removida do perfil.", action: { label: "Desfazer", onAction: () => publish(p.template_code, title) } }),
      (e: unknown) => onDone(failed(e)),
    );
  };
  return (
    <>
      <p className="tn-muted">Textos aprovados pela Tinindo para a sua profissão, preenchidos com os dados que você já tornou públicos. A apresentação vai para o perfil público só se ele estiver publicado com o campo “apresentação” escolhido (<Link to="/app/perfil">Perfil</Link>). Posts são para você copiar e postar onde quiser.</p>
      {!canPublish ? <StatusBanner tone="warning">Publicação bloqueada: {content.scope.profile_published ? "o campo “apresentação” não está entre os campos públicos escolhidos." : "o perfil público não está publicado."}</StatusBanner> : null}
      {content.published ? (
        <p><strong>Publicado no perfil:</strong> {content.published.body} <ActButton variant="ghost" aria-label="Remover a apresentação do perfil" onAct={() => unpublish(content.published!)}>Remover</ActButton></p>
      ) : <p className="tn-muted">Nenhuma apresentação publicada.</p>}
      <ul className="tn-ga-list" aria-label="Conteúdo aprovado">
        {content.templates.map((t) => (
          <li key={t.code} className="tn-ga-item">
            <h3>{t.title} <span className="tn-muted">({t.kind === "bio" ? "apresentação" : "post"} · aprovado por {t.approved_by})</span></h3>
            <p>{t.preview}</p>
            {t.kind === "bio" ? <div className="tn-actions"><ActButton variant="secondary" disabled={!canPublish || content.published?.template_code === t.code} onAct={() => publish(t.code, t.title)}>{content.published?.template_code === t.code ? "Publicada" : "Publicar no perfil"}</ActButton></div> : null}
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
  const [following, setFollowing] = useState(false);
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
    if (n) toast(n);
    setNonce((x) => x + 1);
  };
  async function followUp() {
    setFollowing(true);
    try {
      const r = await port.followUp!();
      done({ tone: "info", message: `Acompanhamento (simulação): ${r.followed_up} decisão(ões) medida(s) de novo.` });
    } catch (e) {
      done(failed(e));
    } finally {
      setFollowing(false);
    }
  }
  return (
    <div className="tn-ga">
      <div className="tn-page-intro">
        <PageHeader id="ga-title" title="Metas e conteúdo" />
        <Help><p>Metas sobre os indicadores do Resultado, sugestões por regras sobre os seus dados e textos aprovados para a sua profissão. Nada aqui promete resultado: o progresso é o indicador medido, e a variação depois de uma sugestão é observada, não causada.</p></Help>
        <StatusBanner tone="info"><strong>Sem inteligência artificial nas sugestões.</strong> Cada sugestão vem de uma regra fixa sobre um indicador com dado suficiente, e mostra a evidência. Você decide; a Tinindo nunca age sozinha.</StatusBanner>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é publicado de verdade. "Avançar 30 dias" faz agora a medição que o sistema faria sozinho depois de 30 dias.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {port.followUp ? <div className="tn-actions"><Button variant="secondary" loading={following} onClick={() => void followUp()}>Avançar 30 dias (simulação)</Button></div> : null}
      </div>
      <Card aria-labelledby="ga-goals-title">
        <h2 id="ga-goals-title">Metas do mês</h2>
        {goals ? <GoalForm key={`new:${nonce}`} port={port} metrics={goals.metrics} monthStart={goals.month_start} onDone={done} /> : null}
        {goals && goals.goals.length === 0 ? <p className="tn-muted">Nenhuma meta ainda.</p> : null}
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

// Assistente do dono (P08). Consulta agenda e caixa registrado pelas ferramentas do servidor e prepara propostas.
// Cinco estados visíveis (BRAND.md): consultado, recomendação, pendente de aprovação, executado, falha.
// Aprovar ≠ executar: a execução repete a checagem e pode recusar. Nada muda sem a aprovação do dono.
import { createContext, type FormEvent, useContext, useRef, useState } from "react";
import { Button, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { type AgentPort, type Answer, type Approval, newKey, type Proposal, type Receipt } from "./port.ts";

const PortContext = createContext<AgentPort | null>(null);
export const AgentPortProvider = PortContext.Provider;
const usePort = () => useContext(PortContext)!;

type UiState = Answer["state"];
const STATE_LABEL: Record<UiState, string> = {
  consulted: "Consultado",
  recommendation: "Recomendação",
  pending_approval: "Pendente de aprovação",
  executed: "Executado",
  failed: "Falha",
};
const SOURCE_LABEL: Record<string, string> = {
  agenda: "agenda", booking: "atendimento", finance_summary: "caixa registrado", business_config: "cadastro do negócio",
  waitlist: "lista de espera", package: "pacote",
};
const TOOL_LABEL: Record<string, string> = {
  "booking.create": "Agendamento", "booking.reschedule": "Remarcação", "booking.cancel": "Cancelamento", "pricing.propose_rule": "Regra de preço",
};
const EXAMPLES = ["o que tenho amanhã?", "como tá a ocupação hoje?", "quanto recebi semana passada?", "marca um corte pra Maria Exemplo Silva quinta às 10h"];

interface Turn {
  id: string;
  question: string;
  answer?: Answer;
  error?: string;
  approval?: Approval;
  receipt?: Receipt;
  actionError?: string;
  busy?: boolean;
}

function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "QUOTA_EXCEEDED":
      return "Você atingiu o limite mensal de perguntas ao assistente. A franquia renova no início do próximo mês; a agenda e as outras telas continuam funcionando.";
    case "FORBIDDEN":
      return "Você não tem acesso ao assistente deste negócio.";
    case "STALE_VERSION":
      return "Esta proposta já foi aprovada ou mudou. Peça uma nova proposta.";
    case "POLICY_REJECTED":
      return e.field === "expires_at" ? "A proposta venceu. Peça de novo para gerar uma nova." : "A proposta não confere mais com o que foi mostrado. Peça uma nova.";
    case "VALIDATION_ERROR":
      return "Escreva a pergunta (até 2.000 caracteres).";
    case "PROVIDER_UNAVAILABLE":
      return "O assistente está indisponível agora. Nada foi alterado; a agenda e as outras telas continuam funcionando.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}

const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

function Sources({ answer }: { answer: Answer }) {
  if (answer.sources.length === 0) return null;
  const counts = new Map<string, number>();
  for (const s of answer.sources) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const asOf = answer.sources.map((s) => s.as_of).sort().at(-1)!;
  const parts = [...counts.entries()].map(([k, n]) => `${SOURCE_LABEL[k] ?? "outro registro"}${n > 1 ? ` (${n})` : ""}`);
  return <p className="tn-ag-sources">Fontes: {parts.join(", ")} · dados de {time(asOf)}</p>;
}

function ProposalCard({ turn, proposal, onApprove, onExecute }: {
  turn: Turn;
  proposal: Proposal;
  onApprove: () => void;
  onExecute: () => void;
}) {
  const titleId = `ag-prop-${turn.id}`;
  return (
    <section className="tn-ag-proposal" aria-labelledby={titleId}>
      <h3 id={titleId}>Proposta: {TOOL_LABEL[proposal.tool] ?? "alteração"}</h3>
      <p>{proposal.summary}</p>
      <dl className="tn-ag-meta">
        <dt>Validade</dt>
        <dd>até {time(proposal.expires_at)}{turn.approval ? ` · aprovação vale até ${time(turn.approval.expires_at)}` : ""}</dd>
      </dl>
      {/* Identificador da proposta: só para o suporte conferir, fora do texto principal. */}
      <details className="tn-ag-support">
        <summary>Detalhes para o suporte</summary>
        <p className="tn-ag-muted">Código da proposta: <code>{proposal.payload_hash.slice(0, 12)}</code> · versão {proposal.version}</p>
      </details>
      {turn.actionError && <StatusBanner tone="danger">{turn.actionError}</StatusBanner>}
      {turn.receipt ? (
        turn.receipt.status === "executed"
          ? <StatusBanner tone="success"><strong>{STATE_LABEL.executed}.</strong> Feito às {time(turn.receipt.executed_at)}. Confira na tela correspondente.</StatusBanner>
          : <StatusBanner tone="danger"><strong>{STATE_LABEL.failed}.</strong> A agenda, a versão ou o preço mudou desde a proposta; nada foi alterado. Peça uma nova proposta.</StatusBanner>
      ) : !turn.approval ? (
        <div className="tn-ag-actions">
          <Button onClick={onApprove} disabled={turn.busy}>Aprovar</Button>
          <span className="tn-ag-muted">Aprovar não executa: você confirma em seguida.</span>
        </div>
      ) : (
        <div className="tn-ag-actions">
          <Button onClick={onExecute} disabled={turn.busy}>Executar agora</Button>
          <span className="tn-ag-muted">Aprovado. A execução confere de novo agenda e preço.</span>
        </div>
      )}
    </section>
  );
}

export function AgentPage() {
  const port = usePort();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const patch = (id: string, p: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const keyFor = (k: string) => {
    const m = keys.current;
    if (!m.has(k)) m.set(k, newKey());
    return m.get(k)!;
  };

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const id = newKey();
    setTurns((ts) => [...ts, { id, question: q }]);
    setText("");
    setBusy(true);
    try {
      patch(id, { answer: await port.ask(q, keyFor(`ask:${id}`)) });
    } catch (e) {
      patch(id, { error: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  async function approve(turn: Turn, proposal: Proposal) {
    patch(turn.id, { busy: true, actionError: undefined });
    try {
      patch(turn.id, { approval: await port.approve(proposal, keyFor(`approve:${turn.id}`)), busy: false });
    } catch (e) {
      patch(turn.id, { actionError: explain(e), busy: false });
    }
  }

  async function execute(turn: Turn) {
    if (!turn.approval) return;
    patch(turn.id, { busy: true, actionError: undefined });
    try {
      patch(turn.id, { receipt: await port.execute(turn.approval.approval_id, keyFor(`execute:${turn.id}`)), busy: false });
    } catch (e) {
      patch(turn.id, { actionError: explain(e), busy: false });
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  return (
    <div className="tn-ag">
      <div className="tn-page-intro">
        <PageHeader id="ag-title" title="Assistente" />
        {port.kind === "demo" && (
          <StatusBanner tone="info">
            <strong>Dados de exemplo.</strong> Demonstração sem servidor: o assistente ainda não guarda nem altera dados no servidor;
            propostas e execuções valem só nesta aba.
          </StatusBanner>
        )}
        <p className="tn-ag-muted">
          Consulto sua agenda e o que foi registrado no caixa, e preparo propostas. Nada muda sem a sua aprovação, e eu não envio mensagens
          nem movimento dinheiro.
        </p>
        <form className="tn-ag-form" onSubmit={onSubmit}>
          <label htmlFor="ag-input">Pergunte ao assistente</label>
          <div className="tn-ag-row">
            <input id="ag-input" type="text" value={text} maxLength={2000} autoComplete="off"
              placeholder="Ex.: o que tenho amanhã?" onChange={(e) => setText(e.target.value)} />
            <Button type="submit" disabled={busy || !text.trim()}>{busy ? "Consultando…" : "Perguntar"}</Button>
          </div>
        </form>
        <div className="tn-ag-examples" aria-label="Exemplos de perguntas">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="tn-ag-chip" onClick={() => void ask(q)} disabled={busy}>{q}</button>
          ))}
        </div>
      </div>

      <section className="tn-ag-log" aria-label="Conversa" aria-live="polite">
        {turns.map((t) => {
          const shown: UiState | null = t.receipt
            ? (t.receipt.status === "executed" ? "executed" : "failed")
            : t.error ? "failed" : t.answer?.state ?? null;
          return (
            <article key={t.id} className="tn-ag-turn">
              <p className="tn-ag-question"><span className="tn-visually-hidden">Você perguntou: </span>{t.question}</p>
              {!t.answer && !t.error && <p className="tn-ag-muted">Consultando…</p>}
              {shown && <span className={`tn-ag-state tn-ag-state-${shown}`}>{STATE_LABEL[shown]}</span>}
              {t.error && <StatusBanner tone="danger">{t.error}</StatusBanner>}
              {t.answer && (
                <>
                  <p className="tn-ag-text">{t.answer.text}</p>
                  <Sources answer={t.answer} />
                  {t.answer.proposal && (
                    <ProposalCard turn={t} proposal={t.answer.proposal}
                      onApprove={() => void approve(t, t.answer!.proposal!)} onExecute={() => void execute(t)} />
                  )}
                </>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

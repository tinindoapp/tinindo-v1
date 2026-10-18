// Página pública do orçamento (/orcamento#t=…). O token sai da URL na hora e só vai ao servidor por POST.
// Abrir não aceita nada. Aceitar cita a versão e o código (hash) que a pessoa está vendo; se o profissional mudou o
// orçamento, a página mostra a versão nova antes. Aceitar não é pagar.
import { useEffect, useState } from "react";
import { Button, Card, StatusBanner, Wordmark } from "../../components/ui/index.tsx";
import { newKey, type QuoteDecision, type QuoteLinkPort, type QuoteView } from "./port.ts";
import { formatCents, formatDateTime, formatSlot } from "./rules.ts";

const KEY = "tinindo.quote";

function takeToken(): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
  if (m?.[1]) {
    try {
      sessionStorage.setItem(KEY, m[1]);
    } catch {
      /* sem armazenamento: vale enquanto a página estiver aberta */
    }
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return m[1];
  }
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function QuoteLinkPage({ port }: { port: QuoteLinkPort }) {
  const [token] = useState(takeToken);
  const [view, setView] = useState<QuoteView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">(token ? "loading" : "missing");
  const [result, setResult] = useState<QuoteDecision | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "warning"; text: string } | null>(null);
  const [keys, setKeys] = useState(() => ({ accept: newKey(), decline: newKey() }));
  const [pending, setPending] = useState(false);

  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    port.view(token).then(
      (v) => { if (alive) { setView(v); setState("ready"); } },
      () => alive && setState("missing"),
    );
    return () => { alive = false; };
  }, [port, token, nonce]);
  const reload = () => setNonce((n) => n + 1);

  async function act(kind: "accept" | "decline") {
    if (!token || !view) return;
    setPending(true);
    setMessage(null);
    try {
      setResult(kind === "accept" ? await port.accept(token, view, keys.accept) : await port.decline(token, view, keys.decline));
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "STALE_VERSION") {
        // Outra versão: mostrar a nova e exigir nova decisão (com chaves novas).
        setKeys({ accept: newKey(), decline: newKey() });
        reload();
        setMessage({ tone: "warning", text: "O profissional atualizou este orçamento. Esta é a versão nova: confira antes de decidir. Nada foi aceito." });
      } else if (code === "SLOT_CONFLICT") {
        setMessage({ tone: "danger", text: "O horário proposto não está mais livre. Nada foi aceito. Fale com o profissional para combinar outro." });
      } else if (code === "POLICY_REJECTED") {
        reload();
        setMessage({ tone: "danger", text: "Este orçamento venceu ou já foi decidido. Nada foi alterado." });
      } else {
        setMessage({ tone: "danger", text: "Não foi possível concluir agora. Tentar de novo é seguro." });
      }
    } finally {
      setPending(false);
    }
  }

  const decided = result?.status ?? (view && (view.status === "accepted" || view.status === "declined") ? view.status : null);

  return (
    <main className="tn-auth">
      <Card aria-labelledby="ql-title">
        <Wordmark width={144} />
        <h1 id="ql-title" className="tn-auth__title">Orçamento</h1>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor.</StatusBanner> : null}
        {state === "loading" ? <p role="status">Carregando…</p> : null}
        {state === "missing" ? <StatusBanner tone="warning">Este link não é válido, foi substituído por outro ou o orçamento foi cancelado.</StatusBanner> : null}
        {view && state === "ready" ? (
          <>
            <p><strong>{view.business_name}</strong> · {view.title}</p>
            <table className="tn-qt-table">
              <caption className="tn-visually-hidden">Itens do orçamento</caption>
              <thead><tr><th scope="col">Item</th><th scope="col">Qtd.</th><th scope="col">Valor</th></tr></thead>
              <tbody>
                {view.items.map((i, n) => (
                  <tr key={n}><td>{i.description}</td><td className="tn-num">{i.quantity}</td><td className="tn-num">{formatCents(i.line_total_cents)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row" colSpan={2}>Total</th><td className="tn-num"><strong>{formatCents(view.total_cents)}</strong></td></tr></tfoot>
            </table>
            {view.slot ? <p>Horário proposto{view.slot_service_name ? ` (${view.slot_service_name})` : ""}: {formatSlot(view.slot, view.timezone)}</p> : null}
            {view.notes ? <p className="tn-qt-muted">Observações: {view.notes}</p> : null}
            <p className="tn-qt-muted">Versão {view.version_no} · código {view.snapshot_hash.slice(0, 8)} · vale até {formatDateTime(view.valid_until, view.timezone)}</p>
          </>
        ) : null}
        {message ? <StatusBanner tone={message.tone}>{message.text}</StatusBanner> : null}
        {view && state === "ready" && !decided && view.status === "sent" ? (
          <>
            <p className="tn-qt-muted">Abrir esta página não aceita nada. Aceitar não é pagar: o pagamento é combinado com o profissional.</p>
            <div className="tn-qt-actions">
              <Button disabled={pending} onClick={() => void act("accept")}>Aceitar orçamento</Button>
              <Button variant="secondary" disabled={pending} onClick={() => void act("decline")}>Recusar</Button>
            </div>
          </>
        ) : null}
        {view && state === "ready" && !decided && view.status === "expired" ? <StatusBanner tone="warning">Este orçamento venceu. Peça uma nova versão ao profissional.</StatusBanner> : null}
        {decided === "accepted" ? (
          <StatusBanner tone="success">
            Orçamento aceito.{result?.booking ? ` Horário reservado: ${formatSlot(result.booking, view?.timezone ?? "America/Sao_Paulo")}.` : ""} O pagamento é combinado com o profissional.
          </StatusBanner>
        ) : null}
        {decided === "declined" ? <StatusBanner tone="info">Orçamento recusado. O profissional verá sua resposta.</StatusBanner> : null}
      </Card>
    </main>
  );
}

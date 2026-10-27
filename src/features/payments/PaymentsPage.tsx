// Pagamentos (P14): cobrar quem está devendo por Pix, acompanhar o estado real (aguardando, pago, expirou, falhou,
// sem resposta), estornar e conferir o dia com o extrato. O que a tela promete é o que o banco garante: pago só
// com confirmação; notificação repetida não entra duas vezes; sem resposta nada é presumido.
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Help, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { CHARGE_STATUS, DIFF_LABEL, explain, FAILURE_REASON, formatCents, formatDateTime, formatDay, PROVIDER_LABEL, REFUND_STATUS, todayIn, unknownNote } from "./labels.ts";
import { CodeDetails, CopyButton, ShareCharge } from "./Share.tsx";
import { type ChargesList, newKey, type PaymentCharge, type PaymentProvider, type PaymentsPort, type Receivable, type Reconciliation } from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
/** Link da cobrança: na demonstração, navega sem recarregar (a cobrança vive nesta aba) e mantém o `#t=`. */
function PayLink({ url, children }: { url: string; children: ReactNode }) {
  const u = new URL(url, window.location.origin);
  if (u.origin === window.location.origin) return <Link to={{ pathname: u.pathname, hash: u.hash }}>{children}</Link>;
  return <a href={url}>{children}</a>;
}
type Created = { description: string; amount_cents: number; pix_code: string | null; url: string };

function ChargeForm({ port, receivables, onDone }: { port: PaymentsPort; receivables: Receivable[]; onDone: (n: Notice, created?: Created) => void }) {
  const [receivableId, setReceivableId] = useState(receivables[0]?.id ?? "");
  const [provider, setProvider] = useState<PaymentProvider>("simulated");
  const [key, setKey] = useState(newKey);
  const chosen = receivables.find((r) => r.id === receivableId) ?? receivables[0];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    try {
      const c = await port.createCharge(chosen.id, provider, key);
      setKey(newKey());
      if (c.charge.status === "pending") {
        onDone({ tone: "success", text: `Cobrança de ${formatCents(c.charge.amount_cents)} criada. Envie o Pix ou o link à cliente.` },
          c.pay_url ? { description: c.charge.description, amount_cents: c.charge.amount_cents, pix_code: c.charge.pix_code, url: c.pay_url } : undefined);
      }
      else if (c.charge.status === "unknown") onDone({ tone: "warning", text: "O banco não respondeu. A cobrança NÃO foi presumida criada: vamos consultar e você verá o estado real aqui." });
      else onDone({ tone: "danger", text: `A cobrança falhou no banco (${FAILURE_REASON[c.charge.failure_reason ?? ""] ?? c.charge.failure_reason ?? "sem motivo"}). Nada foi cobrado.` });
    } catch (err) {
      setKey(newKey());
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-pay-form" aria-label="Cobrar por Pix" onSubmit={(e) => void submit(e)}>
      <label className="tn-pay-field">Quem está devendo
        <select value={chosen?.id ?? ""} onChange={(e) => setReceivableId(e.target.value)} disabled={receivables.length === 0}>
          {receivables.map((r) => <option key={r.id} value={r.id}>{r.description} · {formatCents(r.open_cents)}</option>)}
        </select>
      </label>
      <label className="tn-pay-field">Como receber
        <select value={provider} onChange={(e) => setProvider(e.target.value as PaymentProvider)}>
          <option value="simulated">{PROVIDER_LABEL.simulated}</option>
          <option value="psp">{PROVIDER_LABEL.psp}</option>
        </select>
      </label>
      <Button type="submit" disabled={!chosen}>Gerar cobrança Pix</Button>
    </form>
  );
}

function RefundForm({ port, charge, onDone }: { port: PaymentsPort; charge: PaymentCharge; onDone: (n: Notice) => void }) {
  const [reason, setReason] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const f = await port.refund(charge.id, reason.trim(), newKey());
      onDone(f.status === "done" ? { tone: "success", text: `Estorno de ${formatCents(f.amount_cents)} confirmado pelo banco. O recebimento foi revertido no caixa.` }
        : f.status === "failed" ? { tone: "danger", text: "O banco recusou o estorno. Nada mudou no caixa." }
        : { tone: "warning", text: "Estorno pedido; o banco ainda não confirmou. O caixa só muda com a confirmação." });
    } catch (err) {
      onDone({ tone: "danger", text: explain(err) });
    }
  }
  return (
    <form className="tn-pay-form" aria-label={`Estornar ${charge.description}`} onSubmit={(e) => void submit(e)}>
      <label className="tn-pay-field">Motivo do estorno
        <input maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Button type="submit" variant="ghost" disabled={!reason.trim()}>Estornar tudo</Button>
    </form>
  );
}

export function PaymentsPage({ port, timezone }: { port: PaymentsPort; timezone: string }) {
  const [receivables, setReceivables] = useState<Receivable[] | null>(null);
  const [list, setList] = useState<ChargesList | null>(null);
  const [recs, setRecs] = useState<Reconciliation[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [day, setDay] = useState(() => todayIn(timezone));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([port.openReceivables(), port.charges(), port.reconciliations()]).then(([r, c, x]) => {
      if (!alive) return;
      setReceivables(r);
      setList(c);
      setRecs(x);
      setError(null);
    }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);

  const done = (n: Notice, c?: Created) => {
    setNotice(n);
    if (c) setCreated(c);
    setNonce((x) => x + 1);
  };
  const act = (run: () => Promise<unknown>, ok: string) => run().then(() => done({ tone: "success", text: ok }), (e: unknown) => done({ tone: "danger", text: explain(e) }));
  async function reconcile(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await port.reconcile("simulated", day, newKey());
      done(r.differences.length === 0
        ? { tone: "success", text: `Conferência de ${formatDay(day)}: extrato e caixa batem (${formatCents(r.report_paid_cents)}).` }
        : { tone: "warning", text: `Conferência de ${formatDay(day)}: ${r.differences.length} diferença(s) listada(s) abaixo. Nada foi corrigido automaticamente.` });
    } catch (err) {
      done({ tone: "danger", text: explain(err) });
    }
  }

  return (
    <div className="tn-pay">
      <div className="tn-page-intro">
        <PageHeader id="pay-title" title="Pagamentos" />
        <Help><p>Cobrança por Pix. Só aparece como pago quando o banco confirma; o mesmo aviso nunca entra duas vezes; sem resposta, nada é presumido. A Tinindo não guarda dinheiro: o banco repassa ao seu negócio.</p></Help>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> O recebimento é simulado: nenhum dinheiro existe. Abra o link da cobrança para "pagar" como a cliente.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
        {created ? (
          <ShareCharge description={created.description} amountCents={created.amount_cents} pix={created.pix_code} url={created.url}
            openLink={<p><PayLink url={created.url}>Abrir o link como a cliente</PayLink></p>} />
        ) : null}
      </div>

      <Card aria-labelledby="pay-new-title">
        <h2 id="pay-new-title">Cobrar</h2>
        {receivables && receivables.length === 0 ? <p className="tn-pay-muted">Ninguém está devendo agora. Registre a cobrança no Caixa primeiro.</p> : null}
        {receivables && receivables.length > 0 ? <ChargeForm key={receivables.map((r) => r.id).join(",")} port={port} receivables={receivables} onDone={done} /> : null}
        {port.sync ? <div className="tn-pay-actions"><Button variant="secondary" onClick={() => void port.sync!().then((r) => done({ tone: "info", text: `Consulta ao banco (simulação): ${r.checked} consultada(s), ${r.settled} paga(s), ${r.closed} encerrada(s), ${r.still_unknown} ainda sem resposta.` }))}>Consultar o banco (simulação)</Button></div> : null}
      </Card>

      <Card aria-labelledby="pay-list-title">
        <h2 id="pay-list-title">Cobranças</h2>
        {list && unknownNote(list.unknown) ? <p className="tn-pay-muted">{unknownNote(list.unknown)}</p> : null}
        {list && list.charges.length === 0 ? <p className="tn-pay-muted">Nenhuma cobrança ainda.</p> : null}
        <ul className="tn-pay-list">
          {list?.charges.map((c) => {
            const refund = list.refunds.find((f) => f.charge_id === c.id && f.status !== "failed");
            return (
              <li key={c.id} className="tn-pay-item">
                <h3>{c.description} · {formatCents(c.amount_cents)}</h3>
                <p>
                  <strong>{CHARGE_STATUS[c.status]}</strong>
                  {c.status === "failed" && c.failure_reason ? ` (${FAILURE_REASON[c.failure_reason] ?? c.failure_reason})` : ""}
                  {c.status === "paid" && c.paid_at ? ` em ${formatDateTime(c.paid_at, timezone)}` : ""}
                  {c.status === "paid" && c.settlement === "receivable_cancelled" ? " · sem baixa: a cobrança no Caixa estava cancelada (veja a conferência do dia)" : ""}
                  {refund ? ` · ${REFUND_STATUS[refund.status]}` : ""}
                </p>
                <p className="tn-pay-muted">{PROVIDER_LABEL[c.provider]}{c.expires_at ? ` · vale até ${formatDateTime(c.expires_at, timezone)}` : ""}</p>
                <div className="tn-pay-actions">
                  {c.pix_code && c.status === "pending" ? <CopyButton text={c.pix_code} label="Copiar Pix" what="Pix" /> : null}
                  {c.status === "pending" || c.status === "unknown" ? (
                    <Button variant="ghost" onClick={() => void act(() => port.cancelCharge(c, newKey()), "Cobrança cancelada. Se a cliente já tiver pago, a conferência do dia vai apontar.")}>Cancelar cobrança</Button>
                  ) : null}
                </div>
                {c.pix_code && c.status === "pending" ? <CodeDetails pix={c.pix_code} /> : null}
                {c.status === "paid" && c.settlement === "entry" && !refund ? <RefundForm port={port} charge={c} onDone={done} /> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card aria-labelledby="pay-rec-title">
        <h2 id="pay-rec-title">Conferir com o extrato do dia</h2>
        <p className="tn-pay-muted">Compara o que o extrato diz que entrou no dia com o caixa. Diferenças são listadas, nunca corrigidas em silêncio.</p>
        <form className="tn-pay-form" aria-label="Conferir o dia" onSubmit={(e) => void reconcile(e)}>
          <label className="tn-pay-field">Dia
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary">Conferir o dia</Button>
        </form>
        <ul className="tn-pay-list" aria-label="Conferências">
          {recs.map((r) => (
            <li key={r.id} className="tn-pay-item">
              <h3>{formatDay(r.day)} · {PROVIDER_LABEL[r.provider]}</h3>
              <p>Extrato: {formatCents(r.report_paid_cents)} em {r.report_count} cobrança(s) · Caixa: {formatCents(r.ledger_paid_cents)} · <strong>{r.differences.length === 0 ? "Sem diferenças" : `${r.differences.length} diferença(s)`}</strong></p>
              {r.differences.length > 0 ? (
                <ul className="tn-pay-list">
                  {r.differences.map((d, i) => <li key={i}>{DIFF_LABEL[d.kind] ?? d.kind}{d.external_id ? ` (${d.external_id})` : ""}{d.amount_cents != null ? ` · ${formatCents(d.amount_cents)}` : ""}</li>)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

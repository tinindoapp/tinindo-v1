// Pagamentos (P14): cobrar quem está devendo por Pix, acompanhar o estado real (aguardando, pago, expirou, falhou,
// sem resposta), estornar e conferir o dia com o extrato. O que a tela promete é o que o banco garante: pago só
// com confirmação; notificação repetida não entra duas vezes; sem resposta nada é presumido.
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, type Tone } from "../../components/ui/index.tsx";
import { CHARGE_STATUS, DIFF_LABEL, explain, FAILURE_REASON, formatCents, formatDateTime, formatDay, PROVIDER_LABEL, REFUND_STATUS, todayIn, unknownNote } from "./labels.ts";
import { CodeDetails, CopyButton, ShareCharge } from "./Share.tsx";
import { type ChargesList, newKey, type PaymentCharge, type PaymentProvider, type PaymentsPort, type Receivable, type Reconciliation } from "./port.ts";

/** Retorno de uma ação: sai num aviso curto (Toast), sempre à vista. A lista mostra o estado que fica. */
const notify = (tone: Tone, text: string) => toast({ message: text, tone });
/** Link da cobrança: na demonstração, navega sem recarregar (a cobrança vive nesta aba) e mantém o `#t=`. */
function PayLink({ url, children }: { url: string; children: ReactNode }) {
  const u = new URL(url, window.location.origin);
  if (u.origin === window.location.origin) return <Link to={{ pathname: u.pathname, hash: u.hash }}>{children}</Link>;
  return <a href={url}>{children}</a>;
}
type Created = { description: string; amount_cents: number; pix_code: string | null; url: string };

function ChargeForm({ port, receivables, onDone }: { port: PaymentsPort; receivables: Receivable[]; onDone: (created?: Created) => void }) {
  const [receivableId, setReceivableId] = useState(receivables[0]?.id ?? "");
  const [provider, setProvider] = useState<PaymentProvider>("simulated");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  // Falha ao cobrar fica perto do formulário, para corrigir e tentar de novo.
  const [error, setError] = useState<string | null>(null);
  const chosen = receivables.find((r) => r.id === receivableId) ?? receivables[0];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const c = await port.createCharge(chosen.id, provider, key);
      setKey(newKey());
      if (c.charge.status === "pending") {
        notify("success", `Cobrança de ${formatCents(c.charge.amount_cents)} criada. Envie o Pix ou o link à cliente.`);
        onDone(c.pay_url ? { description: c.charge.description, amount_cents: c.charge.amount_cents, pix_code: c.charge.pix_code, url: c.pay_url } : undefined);
      } else if (c.charge.status === "unknown") {
        notify("warning", "O banco não respondeu. A cobrança NÃO foi presumida criada: vamos consultar e você verá o estado real aqui.");
        onDone();
      } else {
        setError(`A cobrança falhou no banco (${FAILURE_REASON[c.charge.failure_reason ?? ""] ?? c.charge.failure_reason ?? "sem motivo"}). Nada foi cobrado.`);
        onDone();
      }
    } catch (err) {
      setKey(newKey());
      setError(explain(err));
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="tn-pay-form" aria-label="Cobrar por Pix" onSubmit={(e) => void submit(e)}>
      <Field as="select" label="Quem está devendo" value={chosen?.id ?? ""} onChange={(e) => setReceivableId(e.target.value)} disabled={receivables.length === 0}>
        {receivables.map((r) => <option key={r.id} value={r.id}>{r.description} · {formatCents(r.open_cents)}</option>)}
      </Field>
      <Field as="select" label="Como receber" value={provider} onChange={(e) => setProvider(e.target.value as PaymentProvider)}>
        <option value="simulated">{PROVIDER_LABEL.simulated}</option>
        <option value="psp">{PROVIDER_LABEL.psp}</option>
      </Field>
      <Button type="submit" loading={busy}>Gerar cobrança Pix</Button>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
    </form>
  );
}

/** Estorno mexe em dinheiro e não volta atrás: confirma com o valor e pede o motivo. */
function RefundForm({ port, charge, onDone }: { port: PaymentsPort; charge: PaymentCharge; onDone: () => void }) {
  const [reason, setReason] = useState("");
  async function confirm() {
    try {
      const f = await port.refund(charge.id, reason.trim(), newKey());
      if (f.status === "done") notify("success", `Estorno de ${formatCents(f.amount_cents)} confirmado pelo banco. O recebimento foi revertido no caixa.`);
      else if (f.status === "failed") notify("danger", "O banco recusou o estorno. Nada mudou no caixa.");
      else notify("warning", "Estorno pedido; o banco ainda não confirmou. O caixa só muda com a confirmação.");
      onDone();
    } catch (err) {
      notify("danger", explain(err));
      throw err; // a confirmação continua aberta para tentar de novo
    }
  }
  return (
    <ConfirmAction
      trigger="Estornar tudo"
      triggerLabel={`Estornar tudo de ${charge.description}`}
      title={`Estornar ${formatCents(charge.amount_cents)} de ${charge.description}?`}
      consequence="O banco devolve o valor inteiro à cliente e o recebimento sai do caixa. Não dá para desfazer."
      confirmLabel="Sim, estornar"
      canConfirm={!!reason.trim()}
      onConfirm={confirm}
    >
      <Field label="Motivo do estorno" maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} />
    </ConfirmAction>
  );
}

export function PaymentsPage({ port, timezone }: { port: PaymentsPort; timezone: string }) {
  const [receivables, setReceivables] = useState<Receivable[] | null>(null);
  const [list, setList] = useState<ChargesList | null>(null);
  const [recs, setRecs] = useState<Reconciliation[]>([]);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [day, setDay] = useState(() => todayIn(timezone));
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
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

  const done = (c?: Created) => {
    if (c) setCreated(c);
    setNonce((x) => x + 1);
  };
  async function cancelCharge(c: PaymentCharge) {
    try {
      await port.cancelCharge(c, newKey());
      notify("success", "Cobrança cancelada. Se a cliente já tiver pago, a conferência do dia vai apontar.");
      done();
    } catch (err) {
      notify("danger", explain(err));
      done();
      throw err;
    }
  }
  async function sync() {
    setSyncing(true);
    try {
      const r = await port.sync!();
      notify("info", `Consulta ao banco (simulação): ${r.checked} consultada(s), ${r.settled} paga(s), ${r.closed} encerrada(s), ${r.still_unknown} ainda sem resposta.`);
    } catch (err) {
      notify("danger", explain(err));
    } finally {
      setSyncing(false);
      done();
    }
  }
  async function reconcile(e: FormEvent) {
    e.preventDefault();
    setRecBusy(true);
    setRecError(null);
    try {
      const r = await port.reconcile("simulated", day, newKey());
      if (r.differences.length === 0) notify("success", `Conferência de ${formatDay(day)}: extrato e caixa batem (${formatCents(r.report_paid_cents)}).`);
      else notify("warning", `Conferência de ${formatDay(day)}: ${r.differences.length} diferença(s) listada(s) abaixo. Nada foi corrigido automaticamente.`);
      done();
    } catch (err) {
      setRecError(explain(err));
    } finally {
      setRecBusy(false);
    }
  }

  return (
    <div className="tn-pay">
      <div className="tn-page-intro">
        <PageHeader id="pay-title" title="Pagamentos" />
        <Help><p>Cobrança por Pix. Só aparece como pago quando o banco confirma; o mesmo aviso nunca entra duas vezes; sem resposta, nada é presumido. A Tinindo não guarda dinheiro: o banco repassa ao seu negócio.</p></Help>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> O recebimento é simulado: nenhum dinheiro existe. Abra o link da cobrança para "pagar" como a cliente.</StatusBanner> : null}
        {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
        {created ? (
          <ShareCharge description={created.description} amountCents={created.amount_cents} pix={created.pix_code} url={created.url}
            openLink={<p><PayLink url={created.url}>Abrir o link como a cliente</PayLink></p>} />
        ) : null}
      </div>

      <Card aria-labelledby="pay-new-title">
        <h2 id="pay-new-title">Cobrar</h2>
        {receivables && receivables.length === 0 ? <p className="tn-muted">Ninguém está devendo agora. Registre a cobrança no Caixa primeiro.</p> : null}
        {receivables && receivables.length > 0 ? <ChargeForm key={receivables.map((r) => r.id).join(",")} port={port} receivables={receivables} onDone={done} /> : null}
        {port.sync ? <div className="tn-actions"><Button variant="secondary" loading={syncing} onClick={() => void sync()}>Consultar o banco (simulação)</Button></div> : null}
      </Card>

      <Card aria-labelledby="pay-list-title">
        <h2 id="pay-list-title">Cobranças</h2>
        {list && unknownNote(list.unknown) ? <p className="tn-muted">{unknownNote(list.unknown)}</p> : null}
        {list && list.charges.length === 0 ? <p className="tn-muted">Nenhuma cobrança ainda.</p> : null}
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
                <p className="tn-muted">{PROVIDER_LABEL[c.provider]}{c.expires_at ? ` · vale até ${formatDateTime(c.expires_at, timezone)}` : ""}</p>
                <div className="tn-actions">
                  {c.pix_code && c.status === "pending" ? <CopyButton text={c.pix_code} label="Copiar Pix" what="Pix" /> : null}
                  {c.status === "pending" || c.status === "unknown" ? (
                    <ConfirmAction
                      trigger="Cancelar cobrança"
                      triggerLabel={`Cancelar cobrança de ${c.description}`}
                      title="Cancelar cobrança?"
                      consequence={`O Pix e o link de ${c.description} (${formatCents(c.amount_cents)}) param de funcionar para a cliente.`}
                      confirmLabel="Sim, cancelar"
                      onConfirm={() => cancelCharge(c)}
                    />
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
        <p className="tn-muted">Compara o que o extrato diz que entrou no dia com o caixa. Diferenças são listadas, nunca corrigidas em silêncio.</p>
        <form className="tn-pay-form" aria-label="Conferir o dia" onSubmit={(e) => void reconcile(e)}>
          <Field label="Dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <Button type="submit" variant="secondary" loading={recBusy}>Conferir o dia</Button>
          {recError ? <StatusBanner tone="danger">{recError}</StatusBanner> : null}
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

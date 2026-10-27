// Notas fiscais (P16): NFS-e no caso elegível (MEI), com representação autorizada pelo dono e credencial no provedor.
// Lista primeiro; "Nova nota" abre o formulário. Emitir não é receber: o recebimento continua no Caixa.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, Help, PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { ENV_LABEL, explain, folderCsv, formatCents, formatCnpj, formatDate, REASON_LABEL, REGIME_LABEL, SERVICE_LABEL, STATUS_LABEL, todayLocal } from "./labels.ts";
import { type FiscalDocument, type FiscalFolder, type FiscalOverview, type FiscalPort, newKey } from "./port.ts";

type Notice = { tone: "success" | "danger" | "info" | "warning"; text: string } | null;
type Run = (action: () => Promise<unknown>, ok: string) => Promise<void>;

function ProfileForm({ o, port, run, onClose }: { o: FiscalOverview; port: FiscalPort; run: Run; onClose: () => void }) {
  const p = o.profile;
  const [legal, setLegal] = useState(p?.legal_name ?? "");
  const [cnpj, setCnpj] = useState(p ? formatCnpj(p.cnpj) : "");
  const [regime, setRegime] = useState(p?.regime ?? "mei");
  const [ibge, setIbge] = useState(p?.municipality_ibge ?? "");
  const [service, setService] = useState(p?.service_code ?? "06.01");
  return (
    <form className="tn-fsc-form" aria-label="Dados fiscais" onSubmit={(e: FormEvent) => {
      e.preventDefault();
      void run(async () => {
        await port.saveProfile({ expected_version: p?.version ?? 0, legal_name: legal, cnpj, regime, municipality_ibge: ibge, service_code: service }, newKey());
        onClose();
      }, "Dados fiscais salvos.");
    }}>
      <label className="tn-field"><span>Razão social</span><input value={legal} maxLength={150} onChange={(e) => setLegal(e.target.value)} /></label>
      <label className="tn-field"><span>CNPJ</span><input value={cnpj} inputMode="numeric" onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></label>
      <label className="tn-field"><span>Regime</span>
        <select value={regime} onChange={(e) => setRegime(e.target.value as typeof regime)}>
          {Object.entries(REGIME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <div className="tn-field">
        <label htmlFor="fsc-ibge">Código da sua cidade (IBGE)</label>
        <input id="fsc-ibge" value={ibge} inputMode="numeric" maxLength={7} aria-describedby="fsc-ibge-help" onChange={(e) => setIbge(e.target.value.replace(/\D/g, ""))} placeholder="3550308" />
        <small id="fsc-ibge-help" className="tn-fsc-muted">São 7 números que a prefeitura usa na nota. Exemplos: São Paulo 3550308, Rio de Janeiro 3304557, Belo Horizonte 3106200. Não sabe? Pesquise “código IBGE” e o nome da sua cidade, ou pergunte ao seu contador.</small>
      </div>
      <label className="tn-field"><span>Serviço (lista nacional)</span>
        <select value={service} onChange={(e) => setService(e.target.value as typeof service)}>
          {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <div className="tn-fsc-actions">
        <Button type="submit">Salvar dados fiscais</Button>
        {p ? <Button variant="ghost" onClick={onClose}>Fechar</Button> : null}
      </div>
    </form>
  );
}

function Setup({ o, port, run }: { o: FiscalOverview; port: FiscalPort; run: Run }) {
  const [editing, setEditing] = useState(!o.profile);
  const reasons = o.eligibility.reasons;
  return (
    <Card aria-labelledby="fsc-setup-title">
      <h2 id="fsc-setup-title">Antes de emitir</h2>
      {o.eligibility.eligible ? <StatusBanner tone="success">Tudo pronto: você pode emitir notas em {ENV_LABEL[o.eligibility.environment].toLowerCase()}.</StatusBanner> : (
        <ul className="tn-fsc-reasons" aria-label="O que falta">
          {reasons.map((r) => <li key={r}>{REASON_LABEL[r]}</li>)}
        </ul>
      )}
      <section className="tn-fsc-step" aria-labelledby="fsc-step-profile">
        <h3 id="fsc-step-profile">1 · Dados fiscais</h3>
        {o.profile && !editing ? (
          <div className="tn-fsc-row">
            <span>{o.profile.legal_name} · CNPJ {formatCnpj(o.profile.cnpj)} · {REGIME_LABEL[o.profile.regime]} · {SERVICE_LABEL[o.profile.service_code]}</span>
            <Button variant="ghost" onClick={() => setEditing(true)}>Editar</Button>
          </div>
        ) : <ProfileForm o={o} port={port} run={run} onClose={() => setEditing(false)} />}
      </section>
      <section className="tn-fsc-step" aria-labelledby="fsc-step-rep">
        <h3 id="fsc-step-rep">2 · Autorização para emitir em seu nome</h3>
        <blockquote className="tn-fsc-terms">{o.terms.text}</blockquote>
        {o.representation?.active && o.representation.current_terms ? (
          <div className="tn-fsc-row">
            <span>Autorizado até {formatDate(o.representation.valid_until)}.</span>
            <Button variant="ghost" onClick={() => void run(() => port.revoke(newKey()), "Autorização revogada. Notas já emitidas continuam valendo.")}>Revogar</Button>
          </div>
        ) : <Button variant="secondary" onClick={() => void run(() => port.grant(o.terms.hash, newKey()), "Autorização registrada por um ano.")}>Autorizo nestes termos</Button>}
      </section>
      <section className="tn-fsc-step" aria-labelledby="fsc-step-cred">
        <h3 id="fsc-step-cred">3 · Credencial no provedor fiscal</h3>
        <p className="tn-fsc-muted">Seu certificado digital (ou procuração) é cadastrado por você direto no provedor fiscal. A Tinindo nunca recebe o certificado nem a senha: só confere com o provedor se a credencial está válida.</p>
        <div className="tn-fsc-row">
          <span>{o.credential ? `Credencial ${o.credential.status === "valid" ? "válida" : o.credential.status === "expired" ? "vencida" : "não encontrada"}${o.credential.valid_until ? ` até ${formatDate(o.credential.valid_until)}` : ""} · conferida em ${formatDate(o.credential.checked_at)}` : "Ainda não conferida."}</span>
          <Button variant="secondary" disabled={!o.profile} onClick={() => void run(() => port.checkCredential(), "Credencial conferida no provedor.")}>Conferir credencial</Button>
        </div>
      </section>
    </Card>
  );
}

function EmitForm({ o, port, run, onClose }: { o: FiscalOverview; port: FiscalPort; run: Run; onClose: () => void }) {
  const first = o.receivables[0];
  const [rec, setRec] = useState(first?.id ?? "");
  const r = o.receivables.find((x) => x.id === rec);
  const [taker, setTaker] = useState(first?.customer_name ?? "");
  const [doc, setDoc] = useState("");
  const [desc, setDesc] = useState(first?.description ?? "");
  const [amount, setAmount] = useState(first ? (first.amount_cents / 100).toFixed(2).replace(".", ",") : "");
  const [date, setDate] = useState(todayLocal());
  const pick = (id: string) => {
    setRec(id);
    const x = o.receivables.find((y) => y.id === id);
    if (x) {
      setTaker(x.customer_name ?? "");
      setDesc(x.description);
      setAmount((x.amount_cents / 100).toFixed(2).replace(".", ","));
    }
  };
  const cents = Math.round(Number(amount.replace(/\./g, "").replace(",", ".")) * 100);
  // Emitir não se desfaz com um toque (cancelar exige motivo): antes, a tela mostra tudo para conferir.
  const [reviewing, setReviewing] = useState(false);
  // Mesma chave ao repetir o mesmo pedido; ao corrigir, pedido novo.
  const [key, setKey] = useState(newKey);
  const [sending, setSending] = useState(false);
  const env = o.eligibility.environment;
  if (reviewing) {
    return (
      <Card aria-labelledby="fsc-new-title">
        <h2 id="fsc-new-title">Confira antes de emitir</h2>
        <dl className="tn-fsc-review" aria-label="Dados da nota">
          <div><dt>Cliente (tomador)</dt><dd>{taker.trim()}{doc.trim() ? ` · ${doc.trim()}` : " · sem CPF/CNPJ"}</dd></div>
          <div><dt>Serviço</dt><dd>{desc.trim()}</dd></div>
          <div><dt>Valor</dt><dd className="tn-num">{formatCents(cents)}</dd></div>
          <div><dt>Data do serviço</dt><dd className="tn-num">{formatDate(`${date}T12:00:00Z`)}</dd></div>
          <div><dt>Ambiente</dt><dd>{ENV_LABEL[env]}</dd></div>
        </dl>
        {env === "homologacao" ? <p className="tn-fsc-muted">Ambiente de teste: a nota sai sem valor fiscal.</p> : <p className="tn-fsc-muted">Nota de verdade: depois de emitida, só sai com pedido de cancelamento e motivo.</p>}
        <div className="tn-fsc-actions">
          <Button disabled={sending} onClick={() => {
            setSending(true);
            void run(async () => {
              const d = await port.emit({ receivable_id: rec || null, taker_name: taker, taker_document: doc.trim() || null, description: desc, amount_cents: cents, competence_date: date }, key);
              onClose();
              return d;
            }, "Pedido enviado ao provedor. Emitir não registra recebimento: o Caixa continua igual.").finally(() => setSending(false));
          }}>Emitir nota</Button>
          <Button variant="ghost" disabled={sending} onClick={() => { setKey(newKey()); setReviewing(false); }}>Corrigir</Button>
        </div>
      </Card>
    );
  }
  return (
    <Card aria-labelledby="fsc-new-title">
      <h2 id="fsc-new-title">Nova nota</h2>
      <form className="tn-fsc-form" aria-label="Nova nota" onSubmit={(e) => {
        e.preventDefault();
        setReviewing(true);
      }}>
        <label className="tn-field"><span>Atendimento cobrado</span>
          <select value={rec} onChange={(e) => pick(e.target.value)}>
            {o.receivables.map((x) => <option key={x.id} value={x.id}>{x.description} · {x.customer_name ?? "cliente"} · {formatCents(x.amount_cents)}</option>)}
            <option value="">Sem vínculo com cobrança</option>
          </select>
        </label>
        <label className="tn-field"><span>Nome do cliente (tomador)</span><input value={taker} maxLength={150} onChange={(e) => setTaker(e.target.value)} /></label>
        <label className="tn-field"><span>CPF ou CNPJ do cliente (opcional)</span><input value={doc} inputMode="numeric" onChange={(e) => setDoc(e.target.value)} /></label>
        <label className="tn-field"><span>Descrição do serviço</span><input value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="tn-field"><span>Valor (R$)</span><input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="tn-field"><span>Data do serviço</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {r && cents > r.amount_cents ? <StatusBanner tone="warning">O valor passa o que foi cobrado ({formatCents(r.amount_cents)}).</StatusBanner> : null}
        <div className="tn-fsc-actions">
          <Button type="submit" disabled={!taker.trim() || desc.trim().length < 3 || !(cents > 0)}>Revisar a nota</Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

function DocItem({ d, port, run }: { d: FiscalDocument; port: FiscalPort; run: Run }) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <li className="tn-fsc-doc">
      <div className="tn-fsc-row">
        <span>
          <strong>{d.number ? `Nota ${d.number}` : "Nota em emissão"}</strong> · {d.taker_name} · <span className="tn-num">{formatCents(d.amount_cents)}</span>
          <span className="tn-fsc-muted"> · {formatDate(`${d.competence_date}T12:00:00Z`)}{d.environment === "homologacao" ? " · homologação" : ""}</span>
        </span>
        <span className="tn-fsc-chip" data-status={d.status}>{STATUS_LABEL[d.status]}</span>
      </div>
      <p className="tn-fsc-muted">{d.description}{d.protocol ? ` · protocolo ${d.protocol}` : ""}{d.verification_code ? ` · verificação ${d.verification_code}` : ""}{d.reject_reason ? ` · ${d.reject_reason}` : ""}{d.cancel_reason ? ` · motivo: ${d.cancel_reason}` : ""}</p>
      <div className="tn-fsc-actions">
        {d.pdf_url ? <a href={d.pdf_url} target="_blank" rel="noreferrer">PDF</a> : null}
        {d.xml_url ? <a href={d.xml_url} target="_blank" rel="noreferrer">XML</a> : null}
        {d.status === "authorized" && !cancelling ? <Button variant="ghost" onClick={() => setCancelling(true)}>Cancelar nota</Button> : null}
      </div>
      {cancelling ? (
        <form className="tn-fsc-form" aria-label={`Cancelar nota ${d.number ?? ""}`} onSubmit={(e) => {
          e.preventDefault();
          void run(() => port.cancel({ document_id: d.id, expected_version: d.version, reason }, newKey()), "Cancelamento pedido ao provedor.");
        }}>
          <label className="tn-field"><span>Motivo do cancelamento</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="tn-fsc-actions">
            <Button type="submit" variant="secondary" disabled={reason.trim().length < 15}>Pedir cancelamento</Button>
            <Button variant="ghost" onClick={() => setCancelling(false)}>Voltar</Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function Folder({ port }: { port: FiscalPort }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [f, setF] = useState<FiscalFolder | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const download = (folder: FiscalFolder) => {
    const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + folderCsv(folder)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `notas-${folder.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card aria-labelledby="fsc-folder-title">
      <h2 id="fsc-folder-title">Pasta do contador</h2>
      <p className="tn-fsc-muted">Notas do mês por data do serviço, para enviar ao seu contador. Canceladas aparecem, mas não somam.</p>
      <div className="tn-fsc-inline">
        <label className="tn-field"><span>Mês</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <Button variant="secondary" onClick={() => void port.folder(month).then((x) => { setF(x); setErr(null); }, (e: unknown) => setErr(explain(e)))}>Ver pasta</Button>
      </div>
      {err ? <StatusBanner tone="danger">{err}</StatusBanner> : null}
      {f ? (
        <div className="tn-fsc-folder" aria-label={`Pasta de ${f.month}`} role="region">
          <p><strong>{f.totals.authorized_count} nota(s) válida(s)</strong> · <span className="tn-num">{formatCents(f.totals.authorized_cents)}</span> · {f.totals.cancelled_count} cancelada(s){f.totals.homologacao_count ? ` · ${f.totals.homologacao_count} de homologação (sem valor fiscal)` : ""}</p>
          <Button variant="ghost" disabled={f.documents.length === 0} onClick={() => download(f)}>Baixar planilha (CSV)</Button>
        </div>
      ) : null}
    </Card>
  );
}

export function FiscalPage({ port }: { port: FiscalPort }) {
  const [o, setO] = useState<FiscalOverview | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    let alive = true;
    port.overview().then((v) => { if (alive) { setO(v); setError(null); } }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const run: Run = async (action, ok) => {
    try {
      await action();
      setNotice({ tone: "success", text: ok });
    } catch (e) {
      setNotice({ tone: "danger", text: explain(e) });
    }
    setNonce((n) => n + 1);
  };
  const env = o?.eligibility.environment ?? "homologacao";
  return (
    <div className="tn-fsc">
      <PageHeader id="fsc-title" title="Notas fiscais" subtitle="Emitir a nota não é receber: o recebimento continua no Caixa."
        actions={o?.eligibility.eligible && !composing ? <Button onClick={() => setComposing(true)}><Icon name="mais" size={20} />Nova nota</Button> : null} />
      <Help><p>A Tinindo emite a NFS-e no padrão nacional pelo provedor fiscal, em seu nome, quando você pedir. No piloto, só para MEI. As primeiras notas saem em homologação (teste, sem valor fiscal); produção é liberada depois de um caso homologado.</p></Help>
      {env === "homologacao" ? <StatusBanner tone="info"><strong>Homologação.</strong> As notas daqui são de teste e não têm valor fiscal.</StatusBanner> : null}
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Provedor fiscal simulado; nada é enviado à prefeitura.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
      {o ? (
        <>
          {composing && o.eligibility.eligible ? <EmitForm o={o} port={port} run={run} onClose={() => setComposing(false)} /> : null}
          {/* Sem estar pronto para emitir, o passo a passo vem primeiro; pronto, a lista de notas. */}
          {!o.eligibility.eligible ? <Setup key={`setup:${o.profile?.version ?? 0}:${o.representation?.id ?? ""}`} o={o} port={port} run={run} /> : null}
          <Card aria-labelledby="fsc-list-title">
            <h2 id="fsc-list-title">Notas</h2>
            {o.documents.length === 0 ? <p className="tn-fsc-muted">Nenhuma nota ainda.{o.eligibility.eligible ? " Comece em “Nova nota”." : ""}</p> : null}
            <ul className="tn-fsc-list" aria-label="Notas emitidas">
              {o.documents.map((d) => <DocItem key={`${d.id}:${d.version}`} d={d} port={port} run={run} />)}
            </ul>
          </Card>
          {o.eligibility.eligible ? <Setup key={`setup:${o.profile?.version ?? 0}:${o.representation?.id ?? ""}`} o={o} port={port} run={run} /> : null}
          <Folder port={port} />
        </>
      ) : null}
    </div>
  );
}

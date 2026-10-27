// Notas fiscais (P16): NFS-e no caso elegível (MEI), com representação autorizada pelo dono e credencial no provedor.
// Lista primeiro; "Nova nota" abre o formulário. Emitir não é receber: o recebimento continua no Caixa.
import { type ComponentProps, type FormEvent, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { Icon } from "../../components/ui/icons.tsx";
import { ENV_LABEL, explain, folderCsv, formatCents, formatCnpj, formatDate, REASON_LABEL, REGIME_LABEL, SERVICE_LABEL, STATUS_LABEL, todayLocal } from "./labels.ts";
import { type FiscalDocument, type FiscalFolder, type FiscalOverview, type FiscalPort, newKey } from "./port.ts";

/**
 * Roda uma ação, confirma num aviso curto (Toast) e atualiza a tela. Erro: vai para `onError` (formulário, perto dos
 * campos) ou, sem ele, num aviso de erro. Devolve se deu certo.
 */
type Run = (action: () => Promise<unknown>, ok: string, onError?: (err: unknown) => void) => Promise<boolean>;

/** Botão de ação de um toque: mostra o carregando enquanto a ação roda. */
function ActButton({ onAct, ...props }: Omit<ComponentProps<typeof Button>, "onClick" | "loading"> & { onAct: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return <Button {...props} loading={busy} onClick={() => { setBusy(true); void onAct().finally(() => setBusy(false)); }} />;
}

const digits = (v: string) => v.replace(/\D/g, "");

function ProfileForm({ o, port, run, onClose }: { o: FiscalOverview; port: FiscalPort; run: Run; onClose: () => void }) {
  const p = o.profile;
  const [legal, setLegal] = useState(p?.legal_name ?? "");
  const [cnpj, setCnpj] = useState(p ? formatCnpj(p.cnpj) : "");
  const [regime, setRegime] = useState(p?.regime ?? "mei");
  const [ibge, setIbge] = useState(p?.municipality_ibge ?? "");
  const [service, setService] = useState(p?.service_code ?? "06.01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formRef, errors, show } = useFormErrors<"legal" | "cnpj" | "ibge">();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = show({
      legal: !legal.trim() && "Informe a razão social.",
      cnpj: digits(cnpj).length !== 14 && "Informe os 14 números do CNPJ.",
      ibge: ibge.length !== 7 && "Informe os 7 números do código da cidade.",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    await run(async () => {
      await port.saveProfile({ expected_version: p?.version ?? 0, legal_name: legal, cnpj, regime, municipality_ibge: ibge, service_code: service }, newKey());
      onClose();
    }, "Dados fiscais salvos.", (err) => {
      const field = (err as { field?: string } | null)?.field;
      // CNPJ recusado pela conferência dos dígitos: o erro vai para o campo.
      if (field === "cnpj") show({ cnpj: explain(err) });
      else setError(explain(err));
    });
    setBusy(false);
  }
  return (
    <form ref={formRef} className="tn-fsc-form" aria-label="Dados fiscais" onSubmit={(e) => void submit(e)} noValidate>
      <Field label="Razão social" value={legal} maxLength={150} error={errors.legal} onChange={(e) => setLegal(e.target.value)} />
      <Field label="CNPJ" value={cnpj} inputMode="numeric" error={errors.cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
      <Field as="select" label="Regime" value={regime} onChange={(e) => setRegime(e.target.value as typeof regime)}>
        {Object.entries(REGIME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Field>
      <Field label="Código da sua cidade (IBGE)" id="fsc-ibge" value={ibge} inputMode="numeric" maxLength={7} error={errors.ibge}
        onChange={(e) => setIbge(digits(e.target.value))} placeholder="3550308"
        hint="São 7 números que a prefeitura usa na nota. Exemplos: São Paulo 3550308, Rio de Janeiro 3304557, Belo Horizonte 3106200. Não sabe? Pesquise “código IBGE” e o nome da sua cidade, ou pergunte ao seu contador." />
      <Field as="select" label="Serviço (lista nacional)" value={service} onChange={(e) => setService(e.target.value as typeof service)}>
        {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Field>
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      <div className="tn-actions">
        <Button type="submit" loading={busy}>Salvar dados fiscais</Button>
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
            {/* Autorização é consentimento: voltar exige autorizar de novo nos termos, não um "Desfazer". */}
            <ConfirmAction
              trigger="Revogar"
              triggerLabel="Revogar a autorização para emitir em seu nome"
              title="Revogar a autorização?"
              consequence="A Tinindo deixa de emitir notas em seu nome até você autorizar de novo. Notas já emitidas continuam valendo."
              confirmLabel="Sim, revogar"
              onConfirm={() => run(() => port.revoke(newKey()), "Autorização revogada. Notas já emitidas continuam valendo.")}
            />
          </div>
        ) : <ActButton variant="secondary" onAct={() => run(() => port.grant(o.terms.hash, newKey()), "Autorização registrada por um ano.")}>Autorizo nestes termos</ActButton>}
      </section>
      <section className="tn-fsc-step" aria-labelledby="fsc-step-cred">
        <h3 id="fsc-step-cred">3 · Credencial no provedor fiscal</h3>
        <p className="tn-muted">Seu certificado digital (ou procuração) é cadastrado por você direto no provedor fiscal. A Tinindo nunca recebe o certificado nem a senha: só confere com o provedor se a credencial está válida.</p>
        <div className="tn-fsc-row">
          <span>{o.credential ? `Credencial ${o.credential.status === "valid" ? "válida" : o.credential.status === "expired" ? "vencida" : "não encontrada"}${o.credential.valid_until ? ` até ${formatDate(o.credential.valid_until)}` : ""} · conferida em ${formatDate(o.credential.checked_at)}` : "Ainda não conferida."}</span>
          <ActButton variant="secondary" disabled={!o.profile} onAct={() => run(() => port.checkCredential(), "Credencial conferida no provedor.")}>Conferir credencial</ActButton>
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
  const { formRef, errors, show } = useFormErrors<"taker" | "desc" | "amount">();
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
  const [error, setError] = useState<string | null>(null);
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
        {env === "homologacao" ? <p className="tn-muted">Ambiente de teste: a nota sai sem valor fiscal.</p> : <p className="tn-muted">Nota de verdade: depois de emitida, só sai com pedido de cancelamento e motivo.</p>}
        {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
        <div className="tn-actions">
          <Button loading={sending} onClick={() => {
            setSending(true);
            setError(null);
            void run(async () => {
              const d = await port.emit({ receivable_id: rec || null, taker_name: taker, taker_document: doc.trim() || null, description: desc, amount_cents: cents, competence_date: date }, key);
              onClose();
              return d;
            }, "Pedido enviado ao provedor. Emitir não registra recebimento: o Caixa continua igual.", (err) => setError(explain(err))).finally(() => setSending(false));
          }}>Emitir nota</Button>
          <Button variant="ghost" disabled={sending} onClick={() => { setKey(newKey()); setError(null); setReviewing(false); }}>Corrigir</Button>
        </div>
      </Card>
    );
  }
  return (
    <Card aria-labelledby="fsc-new-title">
      <h2 id="fsc-new-title">Nova nota</h2>
      <form ref={formRef} className="tn-fsc-form" aria-label="Nova nota" noValidate onSubmit={(e) => {
        e.preventDefault();
        const ok = show({
          taker: !taker.trim() && "Informe o nome do cliente.",
          desc: desc.trim().length < 3 && "Descreva o serviço (pelo menos 3 letras).",
          amount: !(cents > 0) && "Informe o valor.",
        });
        if (ok) setReviewing(true);
      }}>
        <Field as="select" label="Atendimento cobrado" value={rec} onChange={(e) => pick(e.target.value)}>
          {o.receivables.map((x) => <option key={x.id} value={x.id}>{x.description} · {x.customer_name ?? "cliente"} · {formatCents(x.amount_cents)}</option>)}
          <option value="">Sem vínculo com cobrança</option>
        </Field>
        <Field label="Nome do cliente (tomador)" value={taker} maxLength={150} error={errors.taker} onChange={(e) => setTaker(e.target.value)} />
        <Field label="CPF ou CNPJ do cliente (opcional)" value={doc} inputMode="numeric" onChange={(e) => setDoc(e.target.value)} />
        <Field label="Descrição do serviço" value={desc} maxLength={500} error={errors.desc} onChange={(e) => setDesc(e.target.value)} />
        <Field label="Valor (R$)" value={amount} inputMode="decimal" error={errors.amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="Data do serviço" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {r && cents > r.amount_cents ? <StatusBanner tone="warning">O valor passa o que foi cobrado ({formatCents(r.amount_cents)}).</StatusBanner> : null}
        <div className="tn-actions">
          <Button type="submit">Revisar a nota</Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

function DocItem({ d, port, run }: { d: FiscalDocument; port: FiscalPort; run: Run }) {
  const [reason, setReason] = useState("");
  const label = d.number ? `Nota ${d.number}` : "Nota em emissão";
  return (
    <li className="tn-fsc-doc">
      <div className="tn-fsc-row">
        <span>
          <strong>{label}</strong> · {d.taker_name} · <span className="tn-num">{formatCents(d.amount_cents)}</span>
          <span className="tn-muted"> · {formatDate(`${d.competence_date}T12:00:00Z`)}{d.environment === "homologacao" ? " · homologação" : ""}</span>
        </span>
        <span className="tn-fsc-chip" data-status={d.status}>{STATUS_LABEL[d.status]}</span>
      </div>
      <p className="tn-muted">{d.description}{d.protocol ? ` · protocolo ${d.protocol}` : ""}{d.verification_code ? ` · verificação ${d.verification_code}` : ""}{d.reject_reason ? ` · ${d.reject_reason}` : ""}{d.cancel_reason ? ` · motivo: ${d.cancel_reason}` : ""}</p>
      <div className="tn-actions tn-fsc-links">
        {d.pdf_url ? <a href={d.pdf_url} target="_blank" rel="noreferrer">PDF</a> : null}
        {d.xml_url ? <a href={d.xml_url} target="_blank" rel="noreferrer">XML</a> : null}
        {d.status === "authorized" ? (
          // Cancelar nota não volta atrás: confirma com a consequência e o motivo que vai ao provedor.
          <ConfirmAction
            trigger="Cancelar nota"
            triggerLabel={`Cancelar ${label}`}
            title={d.number ? `Cancelar a nota ${d.number}?` : "Cancelar a nota?"}
            consequence={`O pedido vai ao provedor e a nota de ${d.taker_name} (${formatCents(d.amount_cents)}) perde o valor fiscal. Não dá para desfazer.`}
            confirmLabel="Sim, pedir cancelamento"
            canConfirm={reason.trim().length >= 15}
            missingHint="Escreva o motivo do cancelamento com pelo menos 15 letras."
            onConfirm={async () => {
              let failed: unknown = null;
              await run(() => port.cancel({ document_id: d.id, expected_version: d.version, reason }, newKey()), "Cancelamento pedido ao provedor.", (err) => {
                failed = err;
                toast({ tone: "danger", message: explain(err) });
              });
              if (failed) throw failed;
            }}
          >
            <Field label="Motivo do cancelamento" hint="Pelo menos 15 letras; vai para o provedor." value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </ConfirmAction>
        ) : null}
      </div>
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
      <p className="tn-muted">Notas do mês por data do serviço, para enviar ao seu contador. Canceladas aparecem, mas não somam.</p>
      <div className="tn-fsc-inline">
        <Field label="Mês" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <ActButton variant="secondary" onAct={() => port.folder(month).then((x) => { setF(x); setErr(null); }, (e: unknown) => setErr(explain(e)))}>Ver pasta</ActButton>
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
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    let alive = true;
    port.overview().then((v) => { if (alive) { setO(v); setError(null); } }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const run: Run = async (action, ok, onError) => {
    let done = false;
    try {
      await action();
      toast(ok);
      done = true;
    } catch (e) {
      if (onError) onError(e);
      else toast({ tone: "danger", message: explain(e) });
    }
    setNonce((n) => n + 1);
    return done;
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
      {o ? (
        <>
          {composing && o.eligibility.eligible ? <EmitForm o={o} port={port} run={run} onClose={() => setComposing(false)} /> : null}
          {/* Sem estar pronto para emitir, o passo a passo vem primeiro; pronto, a lista de notas. */}
          {!o.eligibility.eligible ? <Setup key={`setup:${o.profile?.version ?? 0}:${o.representation?.id ?? ""}`} o={o} port={port} run={run} /> : null}
          <Card aria-labelledby="fsc-list-title">
            <h2 id="fsc-list-title">Notas</h2>
            {o.documents.length === 0 ? <p className="tn-muted">Nenhuma nota ainda.{o.eligibility.eligible ? " Comece em “Nova nota”." : ""}</p> : null}
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

// Site e Google (P17): site padronizado montado só do que o perfil público mostra, publicado por aprovação da prévia
// (hash), versionado e reversível; domínio do cliente verificado por DNS; Perfil da Empresa no Google por acesso de
// gerente que o dono concede e revoga; entregas com evidência. Sem promessa de posição no Google.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, ConfirmAction, Field, Help, LinkButton, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { ACTOR_LABEL, CHECK_LABEL, DELIVERY_LABEL, explain, formatCents, formatDateTime, SECTION_LABEL } from "./labels.ts";
import { newKey, type PresenceOverview, type PresencePort, type SiteSection } from "./port.ts";
import { SitePreview } from "./SitePreview.tsx";

/** Executa a ação; sucesso vira toast (com Desfazer quando `undo` existe), erro vira toast de perigo. Devolve se deu certo. */
type Run = (action: () => Promise<PresenceOverview | void>, ok: string, undo?: (after: PresenceOverview) => { ok: string; action: () => Promise<PresenceOverview> }) => Promise<boolean>;
const SECTIONS: SiteSection[] = ["services", "prices", "hours", "booking"];

function SiteCard({ o, run, port }: { o: PresenceOverview; run: Run; port: PresencePort }) {
  const [headline, setHeadline] = useState(o.site.headline ?? "");
  const [sections, setSections] = useState<SiteSection[]>(o.site.sections);
  const [theme, setTheme] = useState(o.site.theme);
  const [ids, setIds] = useState<string[]>(o.site.service_ids);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const live = o.site.status === "published" && o.published;
  const upToDate = live && o.preview_hash === o.published?.snapshot_hash;
  return (
    <Card aria-labelledby="prs-site-title">
      <div className="tn-prs-head">
        <h2 id="prs-site-title">Seu site</h2>
        <span className="tn-prs-chip" data-state={o.site.status}>
          {live ? `No ar · versão ${o.published!.version_no}` : o.site.status === "unpublished" ? "Fora do ar" : "Rascunho"}
        </span>
      </div>
      {!o.profile.published ? (
        <StatusBanner tone="warning">
          <strong>Publique seu perfil público primeiro.</strong> O site usa só o que o perfil mostra (nome, área, link de agendamento).{" "}
          <LinkButton to="/app/perfil" variant="secondary">Abrir Perfil</LinkButton>
        </StatusBanner>
      ) : null}
      <form className="tn-prs-form" aria-label="Conteúdo do site" onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => port.saveSite({ expected_version: o.site.version, headline: headline.trim() || null, sections, theme, service_ids: ids }, newKey()), "Rascunho salvo. Nada foi ao ar: confira a prévia e publique quando quiser.");
      }}>
        <Field label="Frase de apresentação (opcional)" maxLength={o.rules.headline_max} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Ex.: Corte na hora marcada, no centro" />
        <fieldset>
          <legend>O que aparece</legend>
          {SECTIONS.map((s) => (
            <label key={s} className="tn-prs-check">
              <input type="checkbox" checked={sections.includes(s)} onChange={() => setSections(toggle(sections, s))} /> {SECTION_LABEL[s]}
            </label>
          ))}
        </fieldset>
        {sections.includes("services") ? (
          <fieldset>
            <legend>Serviços no site</legend>
            {o.catalog.length === 0 ? <p className="tn-muted">Cadastre serviços em Clientes → Serviços.</p> : null}
            {o.catalog.map((c) => (
              <label key={c.id} className="tn-prs-check">
                <input type="checkbox" checked={ids.includes(c.id)} onChange={() => setIds(toggle(ids, c.id))} /> {c.name}
                <span className="tn-muted"> · {c.duration_min} min{sections.includes("prices") ? ` · ${formatCents(c.base_price_cents)}` : ""}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <Field as="select" label="Aparência" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
          <option value="papel">Clara</option>
          <option value="tinta">Escura</option>
        </Field>
        <div className="tn-actions"><Button type="submit" variant="secondary">Salvar rascunho</Button></div>
      </form>

      {o.preview ? (
        <div className="tn-prs-preview">
          <h3>Prévia</h3>
          <p className="tn-muted">Só entram dados públicos: nunca clientes, contatos, custos ou preço mínimo.</p>
          <SitePreview site={o.preview} />
          <div className="tn-actions">
            {upToDate ? <p className="tn-muted">Esta prévia é exatamente o que está no ar.</p> : (
              <Button onClick={() => void run(() => port.publish(o.preview_hash!, newKey()), "Site publicado: esta versão está no ar.")}>Publicar esta versão</Button>
            )}
            {live ? <LinkButton to={`/s/${o.preview.slug}`} variant="secondary">Ver página pública</LinkButton> : null}
            {/* Tirar do ar volta atrás pondo a mesma versão no ar de novo: executa e oferece Desfazer. */}
            {live ? (
              <Button
                variant="ghost"
                onClick={() => {
                  const versionNo = o.published!.version_no;
                  void run(() => port.unpublish(o.site.version, newKey()), "Site fora do ar. Você pode pôr uma versão de volta quando quiser.", (after) => ({
                    ok: `Versão ${versionNo} no ar de novo, como foi aprovada.`,
                    action: () => port.restore(versionNo, after.site.version, newKey()),
                  }));
                }}
              >
                Tirar do ar
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {o.versions.length ? (
        <details className="tn-prs-versions">
          <summary>Versões publicadas ({o.versions.length})</summary>
          <ul className="tn-prs-list" aria-label="Versões publicadas">
            {o.versions.map((v) => (
              <li key={v.version_no}>
                <span>Versão {v.version_no} · aprovada em {formatDateTime(v.approved_at)} · código {v.snapshot_hash.slice(0, 8)}</span>
                {live && o.published?.version_no === v.version_no ? <strong>No ar</strong> : (
                  <Button variant="ghost" onClick={() => void run(() => port.restore(v.version_no, o.site.version, newKey()), `Versão ${v.version_no} no ar de novo, como foi aprovada.`)}>
                    Pôr no ar de novo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function DomainCard({ o, run, port, onCheck }: { o: PresenceOverview; run: Run; port: PresencePort; onCheck: (text: string, ok: boolean) => void }) {
  const [host, setHost] = useState("");
  const { formRef, errors, show, clear } = useFormErrors<"host">();
  const d = o.domain;
  return (
    <Card aria-labelledby="prs-domain-title">
      <h2 id="prs-domain-title">Domínio</h2>
      <p className="tn-muted">O domínio é seu: você compra e mantém no registrador (ex.: Registro.br). A Tinindo não compra nem registra domínios; só liga o seu ao site depois de verificar no DNS.</p>
      {!d ? (
        <form className="tn-prs-inline" aria-label="Ligar domínio" ref={formRef} noValidate onSubmit={(e) => {
          e.preventDefault();
          if (!show({ host: host.trim().length >= 4 ? null : "Informe seu domínio, por exemplo minhabarbearia.com.br." })) return;
          void run(() => port.addDomain(host, newKey()), "Domínio adicionado. Crie o registro abaixo no DNS e depois verifique.");
        }}>
          <Field
            label="Seu domínio"
            value={host}
            onChange={(e) => { setHost(e.target.value); clear("host"); }}
            placeholder="minhabarbearia.com.br"
            inputMode="url"
            autoCapitalize="none"
            error={errors.host}
          />
          <Button type="submit" variant="secondary">Ligar domínio</Button>
        </form>
      ) : (
        <div className="tn-prs-domain">
          <p><strong>{d.hostname}</strong> · {d.status === "verified" ? `verificado em ${formatDateTime(d.verified_at!)}` : "aguardando verificação"}</p>
          {d.status !== "verified" ? (
            <>
              <ol className="tn-prs-steps">
                <li>No painel do seu domínio, crie um registro <strong>TXT</strong> com o nome <code>{d.txt_name}</code> e o valor <code>{d.txt_value}</code>.</li>
                <li>{o.cname_target ? <>Aponte o domínio (registro CNAME) para <code>{o.cname_target}</code>.</> : "O endereço de destino (CNAME) aparece aqui quando o ambiente hospedado estiver ativo."}</li>
                <li>Volte aqui e toque em “Verificar agora”. Pode levar alguns minutos para o DNS atualizar.</li>
              </ol>
              {d.last_check_result ? <p className="tn-muted">Última verificação: {CHECK_LABEL[d.last_check_result]}</p> : null}
            </>
          ) : null}
          <div className="tn-actions">
            {d.status !== "verified" ? (
              <Button onClick={() => void port.checkDomain(d.id).then((r) => onCheck(CHECK_LABEL[r.result], r.result === "found"), (e: unknown) => onCheck(explain(e), false))}>Verificar agora</Button>
            ) : null}
            {d.status !== "verified" && port.simulateDns ? (
              <Button variant="ghost" onClick={() => { port.simulateDns!(d.txt_name, d.txt_value); onCheck("Demonstração: registro TXT criado no DNS simulado. Agora verifique.", true); }}>
                Simular registro no DNS (demonstração)
              </Button>
            ) : null}
            {/* Ligar de novo pede outro registro no DNS e nova verificação: não há Desfazer, então confirma antes. */}
            <ConfirmAction
              trigger="Desligar domínio"
              title={`Desligar ${d.hostname}?`}
              consequence={`O site deixa de abrir em ${d.hostname}. Para ligar de novo, será preciso criar o registro no DNS e verificar outra vez.`}
              confirmLabel="Sim, desligar"
              onConfirm={async () => {
                if (!(await run(() => port.removeDomain(d.id, d.version, newKey()), "Domínio desligado do site."))) throw new Error("falhou");
              }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function GoogleCard({ o, run, port }: { o: PresenceOverview; run: Run; port: PresencePort }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [declared, setDeclared] = useState(false);
  const { formRef, errors, show, clear } = useFormErrors<"name" | "declared">();
  const g = o.google;
  return (
    <Card aria-labelledby="prs-google-title">
      <h2 id="prs-google-title">Perfil da Empresa no Google</h2>
      <p className="tn-muted">O perfil continua seu. Com acesso de gerente, a equipe Tinindo atualiza horários, fotos, publicações e respostas, e cada entrega aparece abaixo com link de comprovação. Você revoga quando quiser.</p>
      {g.status === "granted" ? (
        <>
          <p><strong>Acesso concedido</strong> ao perfil “{g.profile_name}” como gerente em {formatDateTime(g.granted_at!)}.{g.profile_url ? <> <a href={g.profile_url} target="_blank" rel="noreferrer">Ver no Google Maps</a></> : null}</p>
          <div className="tn-actions">
            {/* Revogar corta o acesso de gerente da equipe Tinindo: confirma antes, sem Desfazer. */}
            <ConfirmAction
              trigger="Revogar acesso"
              triggerVariant="secondary"
              title="Revogar o acesso da Tinindo?"
              consequence={`A equipe Tinindo para de agir no perfil “${g.profile_name}”. Remova também a Tinindo dos gerentes no Google.`}
              confirmLabel="Sim, revogar"
              onConfirm={async () => {
                if (!(await run(() => port.setGoogle({ action: "revoke", expected_version: g.version }, newKey()), "Acesso revogado. Remova também a Tinindo dos gerentes no Google."))) throw new Error("falhou");
              }}
            />
          </div>
        </>
      ) : (
        <form className="tn-prs-form" aria-label="Conceder acesso ao Google" ref={formRef} noValidate onSubmit={(e) => {
          e.preventDefault();
          const ok = show({
            name: name.trim() ? null : "Informe o nome do perfil no Google.",
            declared: declared ? null : "Confirme que adicionou a Tinindo como gerente.",
          });
          if (!ok) return;
          void run(() => port.setGoogle({ action: "grant", profile_name: name, profile_url: url.trim() || null, expected_version: g.version }, newKey()), "Acesso registrado. A equipe Tinindo só age no seu perfil enquanto ele estiver ativo.");
        }}>
          {g.status === "revoked" ? <StatusBanner tone="info">Acesso revogado em {formatDateTime(g.revoked_at!)}. Nada mais é feito no seu perfil.</StatusBanner> : null}
          <ol className="tn-prs-steps">
            <li>No Perfil da Empresa no Google, abra Pessoas e acesso e adicione a equipe Tinindo como <strong>gerente</strong> (nunca proprietária).</li>
            <li>Registre aqui o nome do perfil e, se quiser, o link dele no Google Maps.</li>
          </ol>
          <Field label="Nome do perfil no Google" value={name} maxLength={120} error={errors.name} onChange={(e) => { setName(e.target.value); clear("name"); }} />
          <Field label="Link no Google Maps (opcional)" value={url} maxLength={300} inputMode="url" onChange={(e) => setUrl(e.target.value)} placeholder="https://maps.app.goo.gl/…" />
          <div>
            <label className="tn-prs-check">
              <input
                type="checkbox"
                checked={declared}
                aria-invalid={errors.declared ? true : undefined}
                aria-describedby={errors.declared ? "prs-declared-error" : undefined}
                onChange={(e) => { setDeclared(e.target.checked); clear("declared"); }}
              />{" "}
              Adicionei a Tinindo como gerente e posso revogar quando quiser
            </label>
            {errors.declared ? <span id="prs-declared-error" className="tn-field__error">{errors.declared}</span> : null}
          </div>
          <div className="tn-actions"><Button type="submit">Registrar acesso</Button></div>
        </form>
      )}
    </Card>
  );
}

function Deliveries({ o }: { o: PresenceOverview }) {
  return (
    <Card aria-labelledby="prs-del-title">
      <h2 id="prs-del-title">Entregas</h2>
      {o.deliveries.length === 0 ? <p className="tn-muted">Nada entregue ainda. Cada publicação, verificação e ação no Google aparece aqui com a evidência.</p> : null}
      <ul className="tn-prs-list" aria-label="Entregas">
        {o.deliveries.map((d) => {
          const link = typeof d.evidence.url === "string" ? d.evidence.url : null;
          const hash = typeof d.evidence.snapshot_hash === "string" ? d.evidence.snapshot_hash : null;
          return (
            <li key={d.id}>
              <span>
                <strong>{DELIVERY_LABEL[d.kind]}</strong> · {d.summary}
                <span className="tn-muted"> · {ACTOR_LABEL[d.actor]} · {formatDateTime(d.created_at)}</span>
              </span>
              {link ? <a href={link} target="_blank" rel="noreferrer">Comprovação</a> : hash ? <span className="tn-muted">código {hash.slice(0, 8)}</span> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function PresencePage({ port }: { port: PresencePort }) {
  const [o, setO] = useState<PresenceOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    port.overview().then((v) => { if (alive) { setO(v); setError(null); } }, (e: unknown) => alive && setError(e ?? new Error("erro")));
    return () => { alive = false; };
  }, [port, nonce]);
  const run: Run = async (action, ok, undo) => {
    try {
      const r = await action();
      if (r) setO(r);
      const back = r && undo ? undo(r) : null;
      toast(back ? {
        message: ok,
        action: {
          label: "Desfazer",
          onAction: () => back.action().then((v) => {
            setO(v);
            toast(back.ok);
          }, (e: unknown) => {
            toast({ tone: "danger", message: explain(e) });
            setNonce((n) => n + 1);
          }),
        },
      } : ok);
      return true;
    } catch (e) {
      toast({ tone: "danger", message: explain(e) });
      setNonce((n) => n + 1);
      return false;
    }
  };
  const onCheck = (text: string, good: boolean) => {
    toast({ tone: good ? "success" : "warning", message: text });
    setNonce((n) => n + 1);
  };
  return (
    <div className="tn-prs">
      <PageHeader id="prs-title" title="Site e Google" subtitle="Sua página na internet, seu domínio e seu perfil no Google, com o que foi entregue." />
      <Help><p>O site é montado com o que seu perfil público já mostra e os serviços que você escolher. Nada vai ao ar sem você aprovar a prévia; cada publicação vira uma versão que você pode tirar do ar ou pôr de volta. O domínio continua seu, e o perfil no Google também: a Tinindo entra como gerente e sai quando você revogar.</p></Help>
      <StatusBanner tone="info"><strong>Sem promessa de posição.</strong> Ninguém controla a ordem dos resultados do Google. Aqui você vê o que foi feito, com comprovação.</StatusBanner>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Dados de exemplo; nada é publicado na internet e o DNS é simulado.</StatusBanner> : null}
      {error ? <StatusBanner tone="danger">{explain(error)}</StatusBanner> : null}
      {o ? (
        <>
          <SiteCard key={`site:${o.site.version}`} o={o} run={run} port={port} />
          <DomainCard key={`dom:${o.domain?.id ?? "none"}:${o.domain?.version ?? 0}`} o={o} run={run} port={port} onCheck={onCheck} />
          <GoogleCard key={`g:${o.google.version}`} o={o} run={run} port={port} />
          <Deliveries o={o} />
        </>
      ) : null}
    </div>
  );
}

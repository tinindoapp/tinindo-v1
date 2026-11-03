// P46 · dois painéis do Assistente:
// - "Me ajuda a configurar": um passo da configuração por vez (setup.progress do P44), com o porquê e o botão para a
//   tela que resolve. A confirmação acontece lá, pelas operações normais; aqui só se confere de novo.
// - "Redigir um texto": o dono escreve o rascunho (mensagem, apresentação, campanha), pede uma versão no tom escolhido
//   e edita antes de copiar. Nada é salvo nem enviado por aqui.
import { useEffect, useState } from "react";
import { Button, Field, LinkButton, StatusBanner } from "../../components/ui/index.tsx";
import { type AgentPort, type DraftRequest, newKey } from "./port.ts";
import { nextStep, type SetupProgress } from "./setupGuide.ts";

export function SetupGuidePanel({ port }: { port: AgentPort }) {
  const [progress, setProgress] = useState<SetupProgress | null | undefined>(undefined);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);

  async function load() {
    setChecking(true);
    try {
      setProgress(await port.setupProgress());
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void port.setupProgress().then((p) => alive && setProgress(p));
    return () => {
      alive = false;
    };
  }, [port]);

  if (progress === undefined) return <p className="tn-muted">Conferindo a configuração…</p>;
  if (progress === null) {
    return (
      <StatusBanner tone="info">
        A configuração guiada ainda não está disponível neste ambiente. Enquanto isso, ajuste expediente, serviços e perfil pelo menu.
      </StatusBanner>
    );
  }
  const done = progress.steps.filter((s) => s.done).length;
  const step = nextStep(progress, skipped);
  return (
    <div className="tn-ag-panel-body">
      <p className="tn-ag-progress"><strong>{done} de {progress.steps.length}</strong> passos prontos.</p>
      {step ? (
        <div className="tn-ag-step">
          <h3>{step.title}{step.optional ? <span className="tn-muted"> (opcional)</span> : null}</h3>
          <p>{step.why}</p>
          <div className="tn-actions">
            <LinkButton to={step.href}>Abrir {step.title.toLowerCase()}</LinkButton>
            <Button variant="secondary" loading={checking} loadingText="Conferindo…" onClick={() => void load()}>Já fiz, conferir</Button>
            {step.optional ? (
              <Button variant="ghost" onClick={() => setSkipped((s) => new Set(s).add(step.code))}>Pular por agora</Button>
            ) : null}
          </div>
        </div>
      ) : (
        <StatusBanner tone="success">Tudo pronto{skipped.size ? " (os passos opcionais que você pulou continuam no menu)" : ""}. Seu negócio já pode receber agendamentos.</StatusBanner>
      )}
    </div>
  );
}

const KIND_LABEL: Record<DraftRequest["kind"], string> = {
  message: "Mensagem para cliente",
  bio: "Apresentação do perfil",
  campaign: "Texto de campanha",
};
const TONE_LABEL: Record<NonNullable<DraftRequest["tone"]>, string> = { proximo: "Próximo", direto: "Direto", formal: "Formal" };

export function DraftPanel({ port, initial }: { port: AgentPort; initial?: { kind?: DraftRequest["kind"]; text?: string } }) {
  const [kind, setKind] = useState<DraftRequest["kind"]>(initial?.kind ?? "message");
  const [tone, setTone] = useState<NonNullable<DraftRequest["tone"]>>("proximo");
  const [base, setBase] = useState(initial?.text ?? "");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "danger" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function rewrite() {
    if (!base.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await port.draft({ kind, tone, text: base.trim() }, newKey());
      if (!r.available) setNotice({ tone: "info", text: "A redação pelo assistente está desligada neste ambiente. Seu texto continua como está." });
      else if (r.suggestion === null) setNotice({ tone: "info", text: "Não consegui sugerir um texto que mantenha os mesmos dados. Siga com o seu rascunho." });
      setSuggestion(r.available ? r.suggestion : null);
    } catch {
      setNotice({ tone: "danger", text: "Não foi possível sugerir agora. Seu rascunho não foi alterado." });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(suggestion ?? "");
      setNotice({ tone: "success", text: "Texto copiado. Nada foi salvo nem enviado." });
    } catch {
      setNotice({ tone: "danger", text: "Não consegui copiar. Selecione o texto e copie." });
    }
  }

  return (
    <div className="tn-ag-panel-body">
      <div className="tn-ag-row">
        <Field as="select" label="Tipo de texto" value={kind} onChange={(e) => setKind(e.target.value as DraftRequest["kind"])}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Field>
        <Field as="select" label="Tom" value={tone} onChange={(e) => setTone(e.target.value as NonNullable<DraftRequest["tone"]>)}>
          {Object.entries(TONE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Field>
      </div>
      <Field as="textarea" label="Seu rascunho" rows={4} maxLength={1000} value={base} onChange={(e) => setBase(e.target.value)}
        hint="Escreva do seu jeito. A sugestão mantém números, datas, links e marcadores como {nome}." />
      <div className="tn-actions">
        <Button variant="secondary" loading={busy} loadingText="Redigindo…" disabled={!base.trim()} onClick={() => void rewrite()}>Reescrever no tom escolhido</Button>
      </div>
      {notice ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
      {suggestion !== null ? (
        <>
          <Field as="textarea" label="Sugestão (edite antes de usar)" rows={5} maxLength={600} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} />
          <div className="tn-actions">
            <Button onClick={() => void copy()}>Copiar texto</Button>
            <span className="tn-muted">Revise antes de usar. Nada foi salvo nem enviado.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

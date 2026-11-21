// Assistente dentro da tela (revisão 06/11/2026, §2.1 e §2.2): a faixa "Assistente" com a dica fixa da tela e, quando
// o assistente está ligado, o "Faz comigo": o dono escreve do jeito dele, o assistente devolve um RASCUNHO e a tela de
// sempre fica preenchida, com o selo "preenchido pelo assistente" em cada campo. Quem grava é o botão de sempre da tela.
//
// Sem assistente (LLM_PROVIDER=none), a faixa mostra só a dica fixa e o botão da tela: nada some.
// O componente não conhece módulo nem servidor: a tela passa `onRequest` (a porta dela chama `assist.form_draft`) e
// `onApply` (preenche o formulário). Também traz o selo por campo, o controle dos campos marcados e o "Usar este texto".
import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { Button, Field, StatusBanner } from "./index.tsx";

/** O que a porta da tela devolve (forma de `FormDraftOutput`, em `_shared/domain/agent/forms.ts`). */
export interface AssistDraft<D = Record<string, unknown>> {
  /** false = assistente desligado neste ambiente. */
  available: boolean;
  draft: D | null;
  /** Campos preenchidos pelo assistente. */
  filled: string[];
  notes: { field: string | null; text: string }[];
}

export interface AssistHintProps<D> {
  /** Frase fixa da tela (sem modelo). Sempre aparece. */
  hint: ReactNode;
  /** Exemplo de como escrever, mostrado no campo. */
  example: string;
  /** Rótulo do campo de texto. */
  label?: string;
  /** Pede o rascunho. Erro de rede vira aviso; a tela continua como estava. */
  onRequest(text: string): Promise<AssistDraft<D>>;
  /** Preenche a tela com o rascunho (a tela marca os campos com `useAssistFields`). */
  onApply(draft: D, filled: string[]): void;
  /** Resumo do rascunho antes de aplicar ("Vai ficar: 24 h e 2 h antes"). Sem ele, lista os campos. */
  describe?(draft: D, filled: string[]): ReactNode;
  /** Rótulo dos campos na lista padrão. */
  fieldLabel?(field: string): string;
  /** "Agora não": a tela guarda e não mostra a faixa por um tempo. */
  onDismiss?(): void;
  /** Medição sem conteúdo (T15): a faixa apareceu, o rascunho foi aplicado, a faixa foi dispensada. */
  onEvent?(event: "shown" | "applied" | "dismissed", info: { filled: number }): void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "open" }
  | { kind: "busy" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "result"; result: AssistDraft<unknown> }
  | { kind: "applied"; filled: number };

/**
 * Faixa "Assistente" de uma tela. A dica fixa vem sempre; "Faz comigo" abre o campo para o dono escrever e, com o
 * rascunho de volta, mostra o que vai ser preenchido e o botão "Preencher o formulário". Nada é salvo aqui.
 */
export function AssistHint<D>({ hint, example, label = "Diga do seu jeito", onRequest, onApply, describe, fieldLabel, onDismiss, onEvent }: AssistHintProps<D>) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);

  const open = () => {
    setPhase({ kind: "open" });
    if (!shown) {
      setShown(true);
      onEvent?.("shown", { filled: 0 });
    }
  };

  async function request() {
    if (text.trim().length < 3 || phase.kind === "busy") return;
    setPhase({ kind: "busy" });
    try {
      const r = await onRequest(text.trim());
      setPhase(r.available ? { kind: "result", result: r as AssistDraft<unknown> } : { kind: "unavailable" });
    } catch {
      setPhase({ kind: "error" });
    }
  }

  function apply(result: AssistDraft<unknown>) {
    if (!result.draft) return;
    onApply(result.draft as D, result.filled);
    onEvent?.("applied", { filled: result.filled.length });
    setPhase({ kind: "applied", filled: result.filled.length });
  }

  function dismiss() {
    onEvent?.("dismissed", { filled: 0 });
    onDismiss?.();
    setPhase({ kind: "idle" });
  }

  const result = phase.kind === "result" ? phase.result : null;
  return (
    <section className="tn-setup-hint tn-assist" aria-labelledby={`${id}-title`}>
      <div className="tn-setup-hint__text">
        <p id={`${id}-title`} className="tn-assist__title"><strong>Assistente</strong></p>
        <p>{hint}</p>
      </div>
      {phase.kind === "idle" ? (
        <div className="tn-actions">
          <Button variant="secondary" aria-expanded={false} aria-controls={`${id}-body`} onClick={open}>Faz comigo</Button>
          {onDismiss ? <Button variant="ghost" onClick={dismiss}>Agora não</Button> : null}
        </div>
      ) : (
        <div id={`${id}-body`} className="tn-assist__body" aria-live="polite">
          {phase.kind === "applied" ? (
            <StatusBanner tone="success">
              Preenchi {phase.filled === 1 ? "1 campo" : `${phase.filled} campos`}. Confira cada um e salve pelo botão da tela: nada foi salvo ainda.
            </StatusBanner>
          ) : (
            <>
              <Field as="textarea" label={label} rows={3} maxLength={500} value={text} placeholder={example}
                onChange={(e) => setText(e.target.value)} hint="O assistente preenche; você confere e salva. Não escreva telefone nem endereço de cliente." />
              <div className="tn-actions">
                <Button loading={phase.kind === "busy"} loadingText="Lendo…" disabled={text.trim().length < 3} onClick={() => void request()}>
                  Preencher para eu conferir
                </Button>
                <Button variant="ghost" onClick={() => setPhase({ kind: "idle" })}>Fechar</Button>
              </div>
            </>
          )}
          {phase.kind === "unavailable" ? (
            <StatusBanner tone="info">O assistente não está ligado neste negócio. Preencha o formulário: é o mesmo caminho.</StatusBanner>
          ) : null}
          {phase.kind === "error" ? (
            <StatusBanner tone="danger">Não foi possível ler agora. Nada mudou na tela; tente de novo ou preencha você.</StatusBanner>
          ) : null}
          {result ? <DraftPreview result={result} describe={describe as AssistHintProps<unknown>["describe"]} fieldLabel={fieldLabel} onApply={() => apply(result)} /> : null}
        </div>
      )}
    </section>
  );
}

function DraftPreview({ result, describe, fieldLabel, onApply }: {
  result: AssistDraft<unknown>;
  describe?: (draft: unknown, filled: string[]) => ReactNode;
  fieldLabel?: (field: string) => string;
  onApply(): void;
}) {
  const notes = result.notes.map((n, i) => <li key={i}>{n.text}</li>);
  if (!result.draft) {
    return (
      <StatusBanner tone="info">
        {notes.length ? <ul className="tn-assist__notes">{notes}</ul> : "Não entendi o que preencher. Escreva de outro jeito ou preencha o formulário."}
      </StatusBanner>
    );
  }
  return (
    <div className="tn-assist__preview">
      <p><strong>Vai ficar preenchido:</strong></p>
      {describe ? describe(result.draft, result.filled) : (
        <ul>{result.filled.map((f) => <li key={f}>{fieldLabel ? fieldLabel(f) : f}</li>)}</ul>
      )}
      {notes.length ? <ul className="tn-assist__notes tn-muted">{notes}</ul> : null}
      <div className="tn-actions">
        <Button onClick={onApply}>Preencher o formulário</Button>
        <span className="tn-muted">Você confere e salva. Nada é salvo antes.</span>
      </div>
    </div>
  );
}

/** Selo ao lado do rótulo de um campo que o assistente preencheu. */
export function AssistBadge() {
  return <span className="tn-badge tn-assist__badge" data-tone="info">preenchido pelo assistente</span>;
}

/**
 * Quais campos o assistente preencheu. A tela marca com `mark(filled)` ao aplicar o rascunho e chama `touch(campo)`
 * quando o dono muda o campo à mão (o selo sai: o valor passa a ser dele). `count` alimenta o evento sem conteúdo.
 */
export function useAssistFields() {
  const [fields, setFields] = useState<ReadonlySet<string>>(() => new Set());
  const mark = useCallback((filled: readonly string[]) => setFields(new Set(filled)), []);
  const touch = useCallback((field: string) => setFields((cur) => {
    if (!cur.has(field)) return cur;
    const next = new Set(cur);
    next.delete(field);
    return next;
  }), []);
  const clear = useCallback(() => setFields(new Set()), []);
  return useMemo(() => ({ has: (f: string) => fields.has(f), mark, touch, clear, count: fields.size }), [fields, mark, touch, clear]);
}

/**
 * "Usar este texto" (T5): devolve a sugestão do assistente ao campo de onde ela veio, em vez de só copiar.
 * A tela de origem decide o que fazer com o texto (normalmente, preencher o campo e mostrar o selo).
 */
export function UseTextButton({ text, onUse, max }: { text: string; onUse(text: string): void; max?: number }) {
  const tooLong = max !== undefined && text.length > max;
  return (
    <>
      <Button disabled={!text.trim() || tooLong} onClick={() => onUse(text.trim())}>Usar este texto</Button>
      {tooLong ? <span className="tn-muted">O campo de destino aceita até {max} caracteres. Encurte antes de usar.</span> : null}
    </>
  );
}

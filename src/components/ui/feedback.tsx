// Retorno de ação (auditoria de UX, itens 5 e 6). Um padrão só para o app inteiro:
// - Toast: confirmação curta, fixa acima da barra de abas (sempre à vista, mesmo com a tela rolada), role="status".
// - Desfazer: se a ação volta atrás, executa na hora e o Toast oferece "Desfazer".
// - Confirmar: se não volta, pede confirmação com o verbo e a consequência, e o botão de perigo diz o que faz.
import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "./index.tsx";
import { IconButton } from "./IconButton.tsx";
import { ToneIcon, type Tone } from "./tone.tsx";

export type ToastInput = {
  message: ReactNode;
  tone?: Tone;
  /** "Desfazer" (ou outra ação curta). Ao tocar, o aviso fecha e a ação roda. */
  action?: { label: string; onAction: () => void | Promise<void> };
  /** Tempo na tela em ms. Padrão: 5 s; com ação, 6 s. O tempo para enquanto o ponteiro ou o foco estão no aviso. */
  duration?: number;
};
type ToastItem = ToastInput & { id: number };

// Loja de módulo: qualquer tela chama toast() sem provider; o <Toaster /> do RouteFrame mostra.
let current: ToastItem | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Mostra um aviso curto. Um por vez: o novo substitui o anterior (a última ação é a que importa). */
export function toast(input: ToastInput | string): void {
  const item = typeof input === "string" ? { message: input } : input;
  current = { tone: "success", ...item, id: ++seq };
  emit();
}

export function dismissToast(id?: number): void {
  if (current && (id === undefined || current.id === id)) {
    current = null;
    emit();
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;

/** Região viva única. Fica montada sempre (o leitor de tela só anuncia mudança numa região que já existia). */
export function Toaster() {
  const item = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!item || paused) return;
    const ms = item.duration ?? (item.action ? 6000 : 5000);
    const t = setTimeout(() => dismissToast(item.id), ms);
    return () => clearTimeout(t);
  }, [item, paused]);

  return (
    <div className="tn-toaster" role="status" aria-live="polite" aria-atomic="true">
      {item ? (
        <div
          key={item.id}
          className="tn-toast"
          data-tone={item.tone}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <ToneIcon tone={item.tone ?? "success"} />
          <div className="tn-toast__text">{item.message}</div>
          {item.action ? (
            <button
              type="button"
              className="tn-toast__action"
              onClick={() => {
                const run = item.action!.onAction;
                dismissToast(item.id);
                void run();
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <IconButton icon="fechar" label="Fechar aviso" size="sm" onClick={() => dismissToast(item.id)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Confirmação de ação que não volta atrás, no lugar do botão que a abriu (sem janela por cima).
 * O título é a pergunta com o verbo ("Cancelar orçamento?"), a consequência vem logo abaixo e o botão de perigo
 * repete o verbo ("Sim, cancelar"). Abre com o foco na pergunta; "Voltar" devolve o foco ao botão de origem.
 */
export function ConfirmAction({
  trigger,
  triggerVariant = "ghost",
  triggerLabel,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Voltar",
  onConfirm,
  disabled,
  children,
  canConfirm = true,
  missingHint = "Preencha o que falta acima para confirmar.",
}: {
  /** Texto do botão que abre a confirmação. */
  trigger: ReactNode;
  triggerVariant?: "primary" | "secondary" | "ghost" | "danger";
  /** Nome acessível do botão de origem, quando o texto sozinho é ambíguo numa lista ("Arquivar Ana"). */
  triggerLabel?: string;
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<unknown>;
  disabled?: boolean;
  /** Campos extras dentro da confirmação (ex.: motivo). */
  children?: ReactNode;
  /** Falso enquanto um campo obrigatório da confirmação estiver vazio (o botão explica no envio, não some). */
  canConfirm?: boolean;
  /** O que falta, quando `canConfirm` é falso ("Escreva o motivo com pelo menos 15 letras."). */
  missingHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const titleId = useId();
  const heading = useRef<HTMLParagraphElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reopenFocus = useRef(false);

  useEffect(() => {
    if (open) heading.current?.focus();
    else if (reopenFocus.current) {
      reopenFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return (
      <Button ref={triggerRef} variant={triggerVariant} aria-label={triggerLabel} disabled={disabled} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
    );
  }

  const close = () => {
    reopenFocus.current = true;
    setHint(null);
    setOpen(false);
  };

  return (
    <div className="tn-confirm" role="group" aria-labelledby={titleId}>
      <p id={titleId} ref={heading} tabIndex={-1} className="tn-confirm__title">
        {title}
      </p>
      <div className="tn-confirm__body">{consequence}</div>
      {children}
      {hint ? <p className="tn-field__error">{hint}</p> : null}
      <div className="tn-actions">
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            if (!canConfirm) {
              setHint(missingHint);
              return;
            }
            setBusy(true);
            try {
              await onConfirm();
              setOpen(false);
            } catch {
              // Quem chama mostra o erro (perto da ação); a confirmação continua aberta para tentar de novo.
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={close} disabled={busy}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

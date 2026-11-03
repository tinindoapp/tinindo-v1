// Folha inferior (bottom sheet) e painel de formulário (auditoria de UX, item 20).
// - <Sheet>: <dialog> nativo aberto com showModal() (o resto da tela fica inerte), título ligado por aria-labelledby,
//   foco preso dentro, Esc / "Fechar" / toque no fundo fecham e o foco volta ao botão que abriu. A rolagem da página
//   fica travada enquanto a folha está aberta. A folha fica por cima da barra de abas (inerte durante o modal) e o
//   rodapé respeita a área segura do iPhone.
// - <FormPanel>: no celular (mesma faixa em que a barra de abas aparece) abre o formulário numa <Sheet>; no desktop,
//   mostra o formulário num cartão no lugar de sempre, rola até ele e foca o primeiro campo.
// Um bloco com `data-sheet-footer` (ex.: os botões Salvar/Cancelar) fica fixo no rodapé da folha.
import { type KeyboardEvent, type ReactNode, type SyntheticEvent, useEffect, useId, useRef, useState } from "react";
import { IconButton } from "./IconButton.tsx";
import "./sheet.css";

/** Mesma faixa do shell: abaixo de 900 px há barra de abas e o menu vira folha. */
export const COMPACT_QUERY = "(max-width: 899.98px)";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

const focusables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]") && el.getAttribute("aria-hidden") !== "true");

/** Primeiro campo do formulário (ou, sem campo, o primeiro elemento focável) dentro de `root`. */
function focusFirstField(root: HTMLElement | null, fallback?: HTMLElement | null) {
  const target = root?.querySelector<HTMLElement>(FIELD) ?? fallback ?? (root ? focusables(root)[0] : null);
  target?.focus({ preventScroll: true });
}

/** true no celular (abaixo de 900 px). Sem matchMedia (testes), desktop. */
export function useCompact(): boolean {
  const query = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_QUERY) : null);
  const [compact, setCompact] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return compact;
}

/** Guarda quem tinha o foco ao montar e devolve o foco a ele ao desmontar (se ainda estiver na tela). */
function useReturnFocus() {
  const [opener] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  });
  useEffect(
    () => () => {
      // Depois de desmontar: o foco caiu no body (o elemento focado sumiu). Volta para quem abriu.
      queueMicrotask(() => {
        const now = document.activeElement;
        if (opener?.isConnected && (!now || now === document.body)) opener.focus({ preventScroll: true });
      });
    },
    [opener],
  );
}

/**
 * Folha modal. Fica aberta enquanto estiver montada: quem usa decide com `{aberto ? <Sheet …/> : null}`.
 * `onClose` é chamado por Esc, pelo botão "Fechar" e pelo toque no fundo.
 */
export function Sheet({ title, onClose, children, closeLabel = "Fechar" }: { title: ReactNode; onClose: () => void; children: ReactNode; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useReturnFocus();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (typeof d.showModal === "function") {
      if (!d.open) d.showModal();
    } else d.setAttribute("open", "");
    document.body.dataset.sheetOpen = "true";
    focusFirstField(d.querySelector<HTMLElement>(".tn-sheet__body"), closeRef.current);
    return () => {
      if (typeof d.close === "function" && d.open) d.close();
      else d.removeAttribute("open");
      if (!document.querySelector("dialog.tn-sheet[open]")) delete document.body.dataset.sheetOpen;
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      // Esc fecha pela tela (estado do React), não pelo navegador.
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    // Foco preso: do último volta ao primeiro, e vice-versa.
    const list = focusables(ref.current);
    if (list.length === 0) return;
    const first = list[0]!;
    const last = list.at(-1)!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={ref}
      className="tn-sheet"
      aria-labelledby={titleId}
      aria-modal="true"
      onKeyDown={onKeyDown}
      onCancel={(e: SyntheticEvent) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        // Toque no fundo (fora da folha): o alvo é o próprio <dialog>.
        if (e.target === ref.current) onCloseRef.current();
      }}
    >
      <div className="tn-sheet__frame">
        <div className="tn-sheet__head">
          <h2 id={titleId}>{title}</h2>
          <IconButton ref={closeRef} icon="fechar" label={closeLabel} onClick={() => onCloseRef.current()} />
        </div>
        <div className="tn-sheet__body">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * Formulário de criar/editar: folha no celular; no desktop, cartão no lugar de sempre, rolado até a vista e com o foco
 * no primeiro campo. Nos dois casos, ao fechar o foco volta ao botão que abriu.
 */
export function FormPanel({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const compact = useCompact();
  if (compact) {
    return (
      <Sheet title={title} onClose={onClose}>
        {children}
      </Sheet>
    );
  }
  return <InlinePanel title={title}>{children}</InlinePanel>;
}

function InlinePanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useReturnFocus();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
    focusFirstField(el);
  }, []);
  return (
    <section ref={ref} className="tn-card tn-form-panel" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  );
}

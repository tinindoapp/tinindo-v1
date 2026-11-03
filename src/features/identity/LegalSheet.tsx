// Folha com os termos de uso e a política de privacidade (auditoria de UX, E8).
// Os textos de docs/legal são rascunho marcado "NÃO PUBLICAR" (docs/legal/PENDENCIAS.md): não entram no app nem no
// pacote publicado. Até a versão final existir, a folha diz que o texto está em revisão e qual versão o aceite registra.
// Nada de texto jurídico é escrito aqui. Folha local: o integrador unifica com a folha do sistema depois.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
import "./identity.css";

export type LegalDoc = "terms" | "privacy";

export const LEGAL_TITLE: Record<LegalDoc, string> = {
  terms: "Termos de uso",
  privacy: "Política de privacidade",
};


/**
 * Folha modal acessível sobre o `<dialog>` nativo: prende o foco, fecha com Esc, com "Fechar" e tocando fora, e devolve
 * o foco para quem abriu. No celular sobe de baixo; no computador fica no centro.
 */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      titleRef.current?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      opener.current?.focus();
      opener.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="tn-id-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Toque no fundo escurecido (fora da caixa) fecha.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="tn-id-sheet__panel">
          <div className="tn-id-sheet__head">
            <h2 id={titleId} ref={titleRef} tabIndex={-1}>
              {title}
            </h2>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
          </div>
          <div className="tn-id-sheet__body">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

const WHAT: Record<LegalDoc, string> = { terms: "dos Termos de uso", privacy: "da Política de privacidade" };

function LegalText({ doc }: { doc: LegalDoc }) {
  return (
    <div className="tn-stack">
      <StatusBanner tone="info">
        <strong>Texto em revisão.</strong> A versão final {WHAT[doc]} está em revisão jurídica e vai aparecer aqui quando for
        publicada.
      </StatusBanner>
      <p>Nesta fase de piloto, o aceite registra a versão do piloto, combinada com a Tinindo ao entrar no teste.</p>
    </div>
  );
}

export function LegalSheet({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  // Guarda o último documento para o texto não sumir enquanto a folha fecha.
  const [last, setLast] = useState<LegalDoc>(doc ?? "terms");
  if (doc && doc !== last) setLast(doc);
  return (
    <Sheet open={doc !== null} title={LEGAL_TITLE[doc ?? last]} onClose={onClose}>
      <LegalText key={doc ?? last} doc={doc ?? last} />
    </Sheet>
  );
}

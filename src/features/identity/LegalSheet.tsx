// Folha com os termos de uso e a política de privacidade (auditoria de UX, E8). O texto é o de docs/legal, como está no
// repositório (rascunho para revisão jurídica, com o aviso do próprio documento no topo): nada é escrito aqui.
// Folha local da Conta: o integrador unifica com src/components/ui/sheet.tsx depois.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
import { type LegalBlock, LegalBlocks, parseLegal } from "./legalMarkdown.tsx";
import "./identity.css";

export type LegalDoc = "terms" | "privacy";

export const LEGAL_TITLE: Record<LegalDoc, string> = {
  terms: "Termos de uso",
  privacy: "Política de privacidade",
};

// Só carrega o texto quando a pessoa abre a folha (fica fora do pacote principal).
const LOADERS: Record<LegalDoc, () => Promise<{ default: string }>> = {
  terms: () => import("../../../docs/legal/termos-de-uso.md?raw"),
  privacy: () => import("../../../docs/legal/politica-de-privacidade.md?raw"),
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

type Load = { kind: "loading" } | { kind: "ready"; blocks: LegalBlock[] } | { kind: "error" };

function LegalText({ doc }: { doc: LegalDoc }) {
  const [state, setState] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    LOADERS[doc]().then(
      (m) => alive && setState({ kind: "ready", blocks: parseLegal(m.default) }),
      () => alive && setState({ kind: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [doc]);
  if (state.kind === "loading") return <p role="status">Carregando…</p>;
  if (state.kind === "error") return <StatusBanner tone="danger">Não deu para abrir o texto agora. Tente de novo.</StatusBanner>;
  return (
    <div className="tn-id-legal">
      <LegalBlocks blocks={state.blocks} />
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

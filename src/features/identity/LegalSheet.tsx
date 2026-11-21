// Folha com os termos de uso e a política de privacidade (auditoria de UX, E8; issue #87).
// O texto vem de docs/legal (src/features/identity/legal.ts), carregado só quando a folha abre. Enquanto o documento
// estiver como "rascunho", a folha diz isso numa faixa e mostra a versão que o aceite registra. Nada de texto jurídico
// é escrito no código. Folha local: o integrador unifica com a folha do sistema depois.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
import "./identity.css";

import { type Block, inlineParts, LEGAL, type LegalDoc, parseLegal } from "./legal.ts";

export type { LegalDoc };
export const LEGAL_TITLE: Record<LegalDoc, string> = { terms: LEGAL.terms.title, privacy: LEGAL.privacy.title };


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

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, i) =>
        part.strong ? <strong key={i}>{part.text}</strong> : part.pending ? <mark key={i} className="tn-id-legal__pending">{part.text}</mark> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

function LegalText({ doc }: { doc: LegalDoc }) {
  const meta = LEGAL[doc];
  const [blocks, setBlocks] = useState<Block[] | null | "error">(null);
  useEffect(() => {
    let alive = true;
    meta.load().then((md) => alive && setBlocks(parseLegal(md)), () => alive && setBlocks("error"));
    return () => {
      alive = false;
    };
  }, [meta]);
  return (
    <div className="tn-stack tn-id-legal">
      {meta.status === "rascunho" ? (
        <StatusBanner tone="warning">
          <strong>Rascunho em revisão jurídica.</strong> Este ainda não é o texto final. Os trechos marcados dependem de
          decisão e vão mudar antes de o cadastro abrir para fora do piloto.
        </StatusBanner>
      ) : null}
      <p className="tn-muted">
        Versão que o aceite registra: <span className="tn-num">{meta.version}</span>
        {meta.publishedAt ? <> · publicada em {meta.publishedAt}</> : null}. O aceite fica guardado com a data quando você cria o negócio.
      </p>
      {blocks === null ? <p role="status">Carregando o texto…</p> : null}
      {blocks === "error" ? <StatusBanner tone="danger">Não foi possível abrir o texto agora. Tente de novo em instantes.</StatusBanner> : null}
      {Array.isArray(blocks)
        ? blocks.map((b, i) =>
            b.kind === "h" ? (
              b.level === 1 ? null : b.level === 2 ? <h3 key={i}><Inline text={b.text} /></h3> : <h4 key={i}><Inline text={b.text} /></h4>
            ) : b.kind === "p" ? (
              <p key={i}><Inline text={b.text} /></p>
            ) : (
              <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>
            ),
          )
        : null}
    </div>
  );
}

export function LegalSheet({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  // Guarda o último documento para o texto não sumir enquanto a folha fecha.
  const [last, setLast] = useState<LegalDoc>(doc ?? "terms");
  if (doc && doc !== last) setLast(doc);
  return (
    <Sheet open={doc !== null} title={LEGAL[doc ?? last].title} onClose={onClose}>
      <LegalText key={doc ?? last} doc={doc ?? last} />
    </Sheet>
  );
}

// Linha de lista da Lista de espera (P54): mesma marcação do `ActionRow` do kit (uma ação visível e o resto no "⋯"),
// mais o selo de estado e o que abre embaixo da linha (confirmação). O `ActionRow` do kit não aceita conteúdo embaixo.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActionsMenu, Button, type MenuAction } from "../../components/ui/index.tsx";

export function Row({ title, meta, badge, action, more, moreLabel = "Mais ações", below, className }: {
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  more?: MenuAction[];
  moreLabel?: string;
  below?: ReactNode;
  className?: string;
}) {
  const hasActions = Boolean(action) || Boolean(more?.length);
  return (
    <li className={className ? `tn-wl-row ${className}` : "tn-wl-row"}>
      <div className={hasActions ? "tn-list__row tn-list__row--split" : "tn-list__row"}>
        <span className="tn-list__main">
          <span className="tn-list__text">
            <span className="tn-list__title">{title}</span>
            {badge ? <span className="tn-wl-row__badge">{badge}</span> : null}
            {meta ? <span className="tn-list__meta">{meta}</span> : null}
          </span>
        </span>
        {hasActions ? (
          <span className="tn-list__actions">
            {action}
            {more?.length ? <ActionsMenu label={moreLabel} actions={more} /> : null}
          </span>
        ) : null}
      </div>
      {below ? <div className="tn-wl-row__below">{below}</div> : null}
    </li>
  );
}

/**
 * Confirmação de ação que não volta atrás, embaixo da linha. Pergunta com o verbo, consequência e o botão de perigo
 * que repete o verbo. Abre com o foco na pergunta; "Voltar" devolve o foco ao botão que abriu (`data-return`) ou ao "⋯".
 */
export function InlineConfirm({ title, consequence, confirmLabel, onConfirm, onClose }: {
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const heading = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const back = () => {
    const li = heading.current?.closest("li");
    const target = li?.querySelector<HTMLElement>("[data-return]") ?? li?.querySelector<HTMLElement>(".tn-menu > button");
    onClose();
    target?.focus();
  };
  return (
    <div className="tn-confirm" role="group" aria-label={title}>
      <p ref={heading} tabIndex={-1} className="tn-confirm__title">{title}</p>
      <div className="tn-confirm__body">{consequence}</div>
      <div className="tn-actions">
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch {
              // Quem chama mostra o erro; a confirmação continua aberta para tentar de novo.
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={back} disabled={busy}>Voltar</Button>
      </div>
    </div>
  );
}

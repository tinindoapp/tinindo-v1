// Peças comuns do Caixa: contextos (porta e página), rótulos, a seção com título focável, a linha de lista com uma ação
// e o "⋯", e a confirmação aberta pelo menu (estorno, cancelar cobrança).
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExpenseCategory, Receivable } from "@contracts";
import { ActionsMenu, Button, Field, type MenuAction } from "../../components/ui/index.tsx";
import { explainFinanceError, METHOD_LABEL, METHODS, type Method } from "../../lib/collect.ts";
import type { FinanceBase, FinancePort } from "./port.ts";

const PortContext = createContext<FinancePort | null>(null);
export const FinancePortProvider = PortContext.Provider;
export function usePort(): FinancePort {
  const p = useContext(PortContext);
  if (!p) throw new Error("usePort fora do Caixa");
  return p;
}

export interface Ctx {
  base: FinanceBase;
  today: string;
  reload(): void;
  notify(tone: "success" | "danger", text: string): void;
  customerName(id: string | null): string;
  serviceName(id: string): string;
  /** Atendimento pedido pelo link `?atendimento=<id>` (vindo da Agenda): a linha dele fica marcada. */
  focusBooking: string | null;
}
export const PageContext = createContext<Ctx | null>(null);
export const usePage = () => useContext(PageContext)!;

export const explain = explainFinanceError;

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  supplies: "Material", rent: "Aluguel", utilities: "Contas (luz, água, internet)", fees: "Taxas",
  transport: "Transporte", marketing: "Divulgação", other: "Outro",
};
export const STATUS_LABEL: Record<Receivable["status"], string> = {
  open: "Em aberto", partially_paid: "Recebido em parte", paid: "Recebido", cancelled: "Cancelado",
};

export function MethodField({ id, value, onChange }: { id: string; value: Method; onChange: (m: Method) => void }) {
  return (
    <Field as="select" label="Forma" id={id} value={value} onChange={(e) => onChange(e.target.value as Method)}>
      {METHODS.map((m) => (
        <option key={m} value={m}>
          {METHOD_LABEL[m]}
        </option>
      ))}
    </Field>
  );
}

/**
 * Seção com título (mesmas classes do `Section` do kit), com o h2 focável: depois de uma ação que tira o item da lista,
 * o foco volta para o título (o `Section` do kit não deixa o h2 receber foco).
 */
export function FinSection({ id, title, count, children, className }: { id: string; title: ReactNode; count?: number; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `tn-section ${className}` : "tn-section"} aria-labelledby={id}>
      <div className="tn-section__head">
        <h2 id={id} tabIndex={-1} className="tn-fin-h2">
          {title}
          {count ? <span className="tn-section__count" aria-hidden="true"> · <span className="tn-num">{count}</span></span> : null}
        </h2>
      </div>
      {children}
    </section>
  );
}

/**
 * Item que sai da lista depois da ação (cobrado, recebido, cancelado): se o foco estava nele, vai para o título da
 * seção em vez de cair no body. A limpeza do layout effect roda antes de o React tirar o <li> do DOM.
 */
export function useFocusHandoff(headingId: string) {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const li = ref.current;
    return () => {
      if (li?.contains(document.activeElement)) document.getElementById(headingId)?.focus();
    };
  }, [headingId]);
  return ref;
}

/**
 * Linha de lista com uma ação visível e o resto no "⋯" (mesma marcação do `ActionRow` do kit), mais o que abre embaixo
 * da linha (formulário, confirmação, escolha da forma). O `ActionRow` do kit não aceita conteúdo embaixo nem atributos
 * no <li>.
 */
export function Row({ title, meta, value, action, more, moreLabel, below, wrap, stack, liRef, id, focus, booking }: {
  title: ReactNode;
  meta?: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
  more?: MenuAction[];
  moreLabel: string;
  below?: ReactNode;
  /** Ação larga ("Recebi R$ 60,00 no Pix ▾"): no celular, desce para a linha de baixo em vez de espremer o texto. */
  wrap?: boolean;
  /** Título em cima; embaixo, o apoio à esquerda e a ação à direita (a ação larga não esmaga o título). */
  stack?: boolean;
  liRef?: RefObject<HTMLLIElement | null>;
  id?: string;
  focus?: boolean;
  booking?: string | null;
}) {
  const hasActions = Boolean(action) || Boolean(more?.length);
  const actions = hasActions ? (
    <span className="tn-list__actions">
      {action}
      {more?.length ? <ActionsMenu label={moreLabel} actions={more} /> : null}
    </span>
  ) : null;
  if (stack) {
    return (
      <li ref={liRef} id={id} className="tn-fin-row" data-focus={focus ? "true" : undefined} data-booking={booking ?? undefined}>
        <div className="tn-list__row tn-fin-row__stack">
          <span className="tn-list__title">{title}</span>
          <span className="tn-fin-row__line">
            {meta ? <span className="tn-list__meta tn-num">{meta}</span> : <span />}
            {actions}
          </span>
        </div>
        {below ? <div className="tn-fin-row__below">{below}</div> : null}
      </li>
    );
  }
  return (
    <li ref={liRef} id={id} className="tn-fin-row" data-focus={focus ? "true" : undefined} data-booking={booking ?? undefined}>
      <div className={hasActions ? "tn-list__row tn-list__row--split" : "tn-list__row"} data-wrap={wrap || undefined}>
        <span className="tn-list__main">
          <span className="tn-list__text">
            <span className="tn-list__title">{title}</span>
            {meta ? <span className="tn-list__meta tn-num">{meta}</span> : null}
          </span>
          {value !== undefined ? <span className="tn-list__value tn-num">{value}</span> : null}
        </span>
        {actions}
      </div>
      {below ? <div className="tn-fin-row__below">{below}</div> : null}
    </li>
  );
}

/**
 * Confirmação de ação que não volta atrás, aberta por um item do "⋯" (o `ConfirmAction` do kit só abre pelo próprio
 * botão). Mesmo desenho: pergunta com o verbo, consequência, campo opcional e o botão de perigo que repete o verbo.
 * Abre com o foco na pergunta; "Voltar" devolve o foco ao "⋯" da linha.
 */
export function InlineConfirm({ title, consequence, confirmLabel, onConfirm, onClose, children, canConfirm = true, missingHint }: {
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
  canConfirm?: boolean;
  missingHint?: string;
}) {
  const heading = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const back = () => {
    const menu = heading.current?.closest("li")?.querySelector<HTMLElement>(".tn-menu > button");
    onClose();
    menu?.focus();
  };
  return (
    <div className="tn-confirm" role="group" aria-label={title}>
      <p ref={heading} tabIndex={-1} className="tn-confirm__title">{title}</p>
      <div className="tn-confirm__body">{consequence}</div>
      {children}
      {hint ? <p className="tn-field__error">{hint}</p> : null}
      <div className="tn-actions">
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            if (!canConfirm) {
              setHint(missingHint ?? null);
              return;
            }
            setBusy(true);
            try {
              await onConfirm();
              back();
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

/** Estorno pelo "⋯": confirma com a consequência e pede o motivo quando o contrato guarda. */
export function ReverseConfirm({ label, consequence, withReason = true, onReverse, onClose }: {
  label: string; consequence: string; withReason?: boolean; onReverse: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <InlineConfirm
      title={`Estornar ${label}?`}
      consequence={consequence}
      confirmLabel="Sim, estornar"
      canConfirm={!withReason || !!reason.trim()}
      missingHint="Escreva o motivo do estorno."
      onConfirm={() => onReverse(reason.trim())}
      onClose={onClose}
    >
      {withReason ? <Field label="Motivo do estorno" maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
    </InlineConfirm>
  );
}


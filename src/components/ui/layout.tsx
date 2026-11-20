// Padrões de layout do ciclo principal (P54; revisão de 10/11, doc 07 §5 e doc 06): abertura de tela fica no PageHeader;
// aqui ficam o resumo de número, a linha de lista com uma ação, o fim de lista ("Ver todos", lista cortada), a barra de
// ações e o selo de estado com tom. Regras que valem para qualquer tela:
//   - preto preenchido só para ação (botão principal); valor escolhido, navegação e estado nunca são pílula preta;
//   - uma ação principal por tela; numa linha, no máximo uma ação visível e o resto no menu "⋯";
//   - o número principal fica sozinho, grande e tabular, com rótulo em caixa-alta (D17 b); os outros, em linhas;
//   - lista longa mostra poucos itens e "Ver todos (N)"; lista cortada pelo servidor diz que foi cortada.
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { Icon } from "./icons.tsx";
import { ActionsMenu, type MenuAction } from "./menu.tsx";
import { ToneIcon, type Tone } from "./tone.tsx";

/** Número principal da tela (ex.: "Sobrou no mês"): rótulo em caixa-alta, valor grande e tabular, nota opcional. */
export function SummaryHero({ label, value, hint, id }: { label: ReactNode; value: ReactNode; hint?: ReactNode; id?: string }) {
  return (
    <div className="tn-summary__hero">
      <p className="tn-caps tn-summary__hero-label" id={id}>{label}</p>
      <p className="tn-summary__hero-value tn-num" aria-describedby={id}>{value}</p>
      {hint ? <p className="tn-summary__hero-hint">{hint}</p> : null}
    </div>
  );
}

export interface SummaryRowData {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** A linha leva à tela que detalha o número. */
  to?: string;
  key?: string;
}

/** Números secundários em linhas: rótulo à esquerda, valor à direita (20 px tabular), nota embaixo. */
export function SummaryRows({ label, rows }: { label: string; rows: SummaryRowData[] }) {
  return (
    <ul className="tn-summary__rows" aria-label={label}>
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="tn-summary__row-label">{r.label}</span>
            <span className="tn-summary__row-value tn-num">{r.value}</span>
            {r.hint ? <span className="tn-summary__row-hint">{r.hint}</span> : null}
          </>
        );
        return (
          <li key={r.key ?? i}>
            {r.to ? <Link to={r.to} className="tn-summary__row">{body}</Link> : <div className="tn-summary__row">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Resumo de número completo: o principal em destaque e os outros em linhas. */
export function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tn-summary" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * Linha de lista com uma ação visível. `to` torna a parte do texto um link; `action` é a ação de um toque (botão
 * compacto) e `more` vai para o menu "⋯". Link e ação são irmãos: nunca botão dentro de link.
 */
export function ActionRow({ to, title, meta, value, action, more, moreLabel, badge }: {
  to?: string;
  title: ReactNode;
  meta?: ReactNode;
  value?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  more?: MenuAction[];
  moreLabel?: string;
}) {
  const text = (
    <span className="tn-list__text">
      <span className="tn-list__title">{title}</span>
      {meta ? <span className="tn-list__meta">{meta}</span> : null}
    </span>
  );
  const main = (
    <>
      {text}
      {badge ? <span className="tn-list__trailing">{badge}</span> : null}
      {value !== undefined ? <span className="tn-list__value tn-num">{value}</span> : null}
      {to ? <Icon name="seta" size={18} className="tn-list__chevron" /> : null}
    </>
  );
  const hasActions = Boolean(action) || Boolean(more?.length);
  return (
    <li>
      <div className={hasActions ? "tn-list__row tn-list__row--split" : "tn-list__row"}>
        {to ? <Link to={to} className="tn-list__main">{main}</Link> : <span className="tn-list__main">{main}</span>}
        {hasActions ? (
          <span className="tn-list__actions">
            {action}
            {more?.length ? <ActionsMenu label={moreLabel ?? "Mais ações"} actions={more} /> : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Lista longa com teto (doc 07 regra 5.3): mostra `limit` itens e "Ver todos (N)"; `truncated` diz que o servidor
 * cortou a lista ("Mostrando os 200 mais recentes."). `plain`: sem caixa em volta, quando já está num cartão.
 */
export function CappedList<T>({ items, limit = 5, label, render, truncated, truncatedText, plain, moreLabel }: {
  items: readonly T[];
  limit?: number;
  label: string;
  render: (item: T, index: number) => ReactNode;
  truncated?: boolean;
  truncatedText?: string;
  plain?: boolean;
  moreLabel?: (total: number) => string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;
  return (
    <>
      <ul className="tn-list" data-plain={plain || undefined} aria-label={label}>
        {shown.map(render)}
      </ul>
      {hidden > 0 || truncated ? (
        <div className="tn-list-foot">
          {truncated ? <ListCutNote text={truncatedText} /> : <span />}
          {hidden > 0 ? (
            <button type="button" className="tn-button" data-variant="ghost" data-size="compact" onClick={() => setAll(true)}>
              {moreLabel ? moreLabel(items.length) : `Ver todos (${items.length})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Aviso de lista cortada pelo servidor (P56: listas com teto devolvem `truncated`). */
export function ListCutNote({ text = "Mostrando os 200 mais recentes." }: { text?: string }) {
  return <p className="tn-list-foot__note" role="note">{text}</p>;
}

/** Barra de ações: uma principal (`primary`), outras como fantasma (`children`) e o resto no "⋯" (`more`). */
export function ActionBar({ primary, children, more, moreLabel = "Mais ações" }: { primary?: ReactNode; children?: ReactNode; more?: MenuAction[]; moreLabel?: string }) {
  return (
    <div className="tn-actionbar">
      {primary}
      {children}
      {more?.length ? <ActionsMenu label={moreLabel} actions={more} /> : null}
    </div>
  );
}

export type BadgeTone = Tone | "neutral";

/** Selo de estado: ícone do tom + texto, nunca só cor. `neutral` é o estado que não pede atenção (ex.: "Confirmado"). */
export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className="tn-badge" data-tone={tone}>
      {tone === "neutral" ? null : <ToneIcon tone={tone} size={14} />}
      {children}
    </span>
  );
}

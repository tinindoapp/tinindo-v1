// Componentes visuais base (dono: integrador; propostas de novos componentes via PR pequeno). ADR-0024: linguagem de app
// (cabeçalho de página, seções com título, listas agrupadas, indicadores) sobre os mesmos tokens da marca.
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import symbolColor from "@brand/assets/logo/tinindo-symbol-color.svg";
import symbolNegative from "@brand/assets/logo/tinindo-symbol-negativo-cor.svg";
import wordmarkColor from "@brand/assets/logo/tinindo-wordmark-color.svg";
import wordmarkNegative from "@brand/assets/logo/tinindo-wordmark-negativo-cor.svg";
import { Icon, type IconName } from "./icons.tsx";
import { ToneIcon, TONE_LABEL, type Tone } from "./tone.tsx";
import "./ui.css";

export { IconButton } from "./IconButton.tsx";
export { ConfirmAction, dismissToast, toast, Toaster, type ToastInput } from "./feedback.tsx";
export { Field, focusFirstInvalid, useFormErrors, type FieldProps } from "./form.tsx";
export { ChipNav, ChoiceCard, Segmented } from "./selection.tsx";
export { ToneIcon, type Tone } from "./tone.tsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Botão padrão. `danger` só para confirmar uma ação que não volta atrás. `loading` (item 11 da auditoria): mostra o
 * indicador, marca aria-busy e desliga o botão enquanto a ação roda; `loadingText` troca o texto ("Salvando…").
 */
export function Button({
  variant = "primary",
  type = "button",
  block,
  loading,
  loadingText,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; block?: boolean; loading?: boolean; loadingText?: ReactNode }) {
  return (
    <button
      type={type}
      className="tn-button"
      data-variant={variant}
      data-block={block || undefined}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="tn-spinner" aria-hidden="true" /> : null}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

/** Link com aparência de botão (navegação, nunca ação com efeito). */
export function LinkButton({ to, variant = "primary", block, children }: { to: string; variant?: Variant; block?: boolean; children: ReactNode }) {
  return (
    <Link to={to} className="tn-button" data-variant={variant} data-block={block || undefined}>
      {children}
    </Link>
  );
}

export function Card({ children, as: Tag = "section", ...rest }: { children: ReactNode; as?: "section" | "div" | "article" } & { "aria-labelledby"?: string }) {
  return (
    <Tag className="tn-card" {...rest}>
      {children}
    </Tag>
  );
}

/** Cabeçalho de tela: título (h1 único da rota), apoio curto e ações. Sem cartão em volta. */
export function PageHeader({ title, id, eyebrow, subtitle, actions }: { title: ReactNode; id?: string; eyebrow?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="tn-page-header">
      <div className="tn-page-header__text">
        {eyebrow ? <p className="tn-caps">{eyebrow}</p> : null}
        <h1 id={id}>{title}</h1>
        {subtitle ? <p className="tn-page-header__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="tn-page-header__actions">{actions}</div> : null}
    </header>
  );
}

/** Explicação longa recolhida ("Como funciona"): a tela abre direto no que importa; o texto continua a um toque. */
export function Help({ children, label = "Como funciona" }: { children: ReactNode; label?: string }) {
  return (
    <details className="tn-help">
      <summary>
        <Icon name="info" size={18} />
        {label}
      </summary>
      <div className="tn-help__body">{children}</div>
    </details>
  );
}

/** Seção com título (h2) e ação opcional à direita. */
export function Section({ title, id, action, children }: { title: ReactNode; id: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="tn-section" aria-labelledby={id}>
      <div className="tn-section__head">
        <h2 id={id}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Lista agrupada (linhas tocáveis num bloco único). */
export function List({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul className="tn-list" aria-label={label}>
      {children}
    </ul>
  );
}

export function ListItem({ to, icon, title, meta, trailing }: { to?: string; icon?: IconName; title: ReactNode; meta?: ReactNode; trailing?: ReactNode }) {
  const body = (
    <>
      {icon ? (
        <span className="tn-list__icon">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <span className="tn-list__text">
        <span className="tn-list__title">{title}</span>
        {meta ? <span className="tn-list__meta">{meta}</span> : null}
      </span>
      {trailing ? <span className="tn-list__trailing">{trailing}</span> : null}
      {to ? <Icon name="seta" size={18} className="tn-list__chevron" /> : null}
    </>
  );
  return <li>{to ? <Link to={to} className="tn-list__row">{body}</Link> : <div className="tn-list__row">{body}</div>}</li>;
}

/** Indicador numérico com rótulo e nota (o número sempre com contexto). */
export function Stat({ label, value, hint, to }: { label: string; value: ReactNode; hint?: ReactNode; to?: string }) {
  const inner = (
    <>
      <span className="tn-stat__label">{label}</span>
      <span className="tn-stat__value tn-num">{value}</span>
      {hint ? <span className="tn-stat__hint">{hint}</span> : null}
    </>
  );
  return to ? <Link to={to} className="tn-stat">{inner}</Link> : <div className="tn-stat">{inner}</div>;
}

export function Stats({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tn-stats" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Aviso dentro da tela (item 7 da auditoria): fundo por tom, barra de 4 px na cor do tom e ícone próprio de cada tom. */
export function StatusBanner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className="tn-banner" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <ToneIcon tone={tone} size={18} />
      <div>
        <span className="tn-visually-hidden">{TONE_LABEL[tone]}: </span>
        {children}
      </div>
    </div>
  );
}

/** Wordmark original (mínimo 120 px de largura). Troca para a versão negativa no tema escuro. */
export function Wordmark({ width = 132 }: { width?: number }) {
  const w = Math.max(width, 120);
  return (
    <picture>
      <source srcSet={wordmarkNegative} media="(prefers-color-scheme: dark)" />
      <img src={wordmarkColor} width={w} alt="Tinindo" style={{ display: "block", height: "auto" }} />
    </picture>
  );
}

/** Símbolo original sem anel (mínimo 32 px; abaixo disso a marca pede a variante óptica). */
export function BrandSymbol({ size = 32 }: { size?: number }) {
  const s = Math.max(size, 32);
  return (
    <picture>
      <source srcSet={symbolNegative} media="(prefers-color-scheme: dark)" />
      <img src={symbolColor} width={s} height={s} alt="Tinindo" style={{ display: "block" }} />
    </picture>
  );
}

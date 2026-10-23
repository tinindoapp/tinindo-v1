// Componentes visuais base (dono: integrador; propostas de novos componentes via PR pequeno). ADR-0024: linguagem de app
// (cabeçalho de página, seções com título, listas agrupadas, indicadores) sobre os mesmos tokens da marca.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { Link } from "react-router";
import symbolColor from "@brand/assets/logo/tinindo-symbol-color.svg";
import symbolNegative from "@brand/assets/logo/tinindo-symbol-negativo-cor.svg";
import wordmarkColor from "@brand/assets/logo/tinindo-wordmark-color.svg";
import wordmarkNegative from "@brand/assets/logo/tinindo-wordmark-negativo-cor.svg";
import { Icon, type IconName } from "./icons.tsx";
import "./ui.css";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  type = "button",
  block,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  return <button type={type} className="tn-button" data-variant={variant} data-block={block || undefined} {...props} />;
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

export function Field({
  label,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="tn-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} {...input} />
      {error ? (
        <span id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

type Tone = "info" | "success" | "warning" | "danger";

/** Estado nunca só por cor: ícone + rótulo textual. */
const TONE_LABEL: Record<Tone, string> = {
  info: "Informação",
  success: "Concluído",
  warning: "Atenção",
  danger: "Erro",
};

export function StatusBanner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className="tn-banner" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d={tone === "success" ? "M5 8.2l2 2 4-4.4" : "M8 4.5v4.5M8 11v.5"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
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

// Componentes visuais base (dono: integrador; propostas de novos componentes via PR pequeno).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import wordmarkColor from "@brand/assets/logo/tinindo-wordmark-color.svg";
import wordmarkNegative from "@brand/assets/logo/tinindo-wordmark-negativo-cor.svg";
import "./ui.css";

export function Button({
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button type={type} className="tn-button" data-variant={variant} {...props} />;
}

export function Card({ children, as: Tag = "section", ...rest }: { children: ReactNode; as?: "section" | "div" | "article" } & { "aria-labelledby"?: string }) {
  return (
    <Tag className="tn-card" {...rest}>
      {children}
    </Tag>
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

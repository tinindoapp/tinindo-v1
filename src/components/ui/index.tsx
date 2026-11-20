// Componentes visuais base (dono: integrador; propostas de novos componentes via PR pequeno). ADR-0024: linguagem de app
// (cabeçalho de página, seções com título, listas agrupadas, indicadores) sobre os mesmos tokens da marca.
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
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
export { ActionsMenu, type MenuAction } from "./menu.tsx";
export { COMPACT_QUERY, FormPanel, Sheet, useCompact } from "./sheet.tsx";
export { ChipGroup, ChipNav, ChoiceCard, Segmented, WEEKDAY_CHIPS, WEEKDAY_SHORTCUTS } from "./selection.tsx";
export { COPY_FAILED, CopyButton, copyText, ShareActions, type ShareHow, whatsappHref } from "./share.tsx";
export { ToneIcon, type Tone } from "./tone.tsx";
export { SetupHint } from "./SetupHint.tsx";
export { ActionBar, ActionRow, type BadgeTone, CappedList, ListCutNote, StatusBadge, Summary, SummaryHero, SummaryRows, type SummaryRowData } from "./layout.tsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Botão padrão. `danger` só para confirmar uma ação que não volta atrás. `loading` (item 11 da auditoria): mostra o
 * indicador, marca aria-busy e desliga o botão enquanto a ação roda; `loadingText` troca o texto ("Salvando…").
 */
export function Button({
  variant = "primary",
  size,
  type = "button",
  block,
  loading,
  loadingText,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: "compact"; block?: boolean; loading?: boolean; loadingText?: ReactNode }) {
  return (
    <button
      type={type}
      className="tn-button"
      data-variant={variant}
      data-size={size}
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

/**
 * Botão de ação de um toque que chama o servidor (onda 3): fica em "carregando" enquanto a promessa de `onAct` roda e
 * volta sozinho, deu certo ou não. O retorno (Toast, erro) é de quem chama. Um segundo toque durante a ação é ignorado.
 */
export function ActionButton({
  onAct,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "loading"> & { onAct: () => Promise<unknown> | unknown }) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void Promise.resolve()
      .then(onAct)
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
        if (alive.current) setBusy(false);
      });
  }
  return <Button {...props} loading={busy} onClick={run} />;
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

/**
 * Abertura de tela (P54; revisão de 10/11, doc 07 regra 5.1), sempre na mesma ordem: rótulo em caixa-alta, título (h1
 * único da rota), uma linha de apoio, a ação principal (`actions`), o filtro da tela (`filter`: período, segmentado) e a
 * ajuda recolhida (`help`). Sem cartão em volta e sem aviso de ambiente (D11 b: a faixa do topo já diz "Demonstração").
 */
export function PageHeader({ title, id, eyebrow, subtitle, actions, filter, help }: {
  title: ReactNode;
  id?: string;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  filter?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <header className="tn-page-header">
      <div className="tn-page-header__text">
        {eyebrow ? <p className="tn-caps">{eyebrow}</p> : null}
        <h1 id={id}>{title}</h1>
        {subtitle ? <p className="tn-page-header__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="tn-page-header__actions">{actions}</div> : null}
      {filter ? <div className="tn-page-header__filter">{filter}</div> : null}
      {help ? <Help>{help}</Help> : null}
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

/**
 * Seção com título (h2), contagem opcional e ação à direita (doc 07 regra 5.2): 32 px entre seções e 16 entre blocos.
 * Seção de lista não leva cartão em volta. `collapsed`: seção secundária que nasce recolhida em uma linha.
 */
export function Section({ title, id, action, count, collapsed, children }: {
  title: ReactNode;
  id: string;
  action?: ReactNode;
  count?: number;
  collapsed?: boolean;
  children: ReactNode;
}) {
  const heading = (
    <>
      {title}
      {/* A contagem fica fora do nome da região (a lista já diz quantos itens tem): "A receber", não "A receber · 3". */}
      {count !== undefined ? <span className="tn-section__count" aria-hidden="true"> · <span className="tn-num">{count}</span></span> : null}
    </>
  );
  if (collapsed !== undefined) {
    return (
      <details className="tn-section tn-section--fold" open={!collapsed} aria-labelledby={id}>
        <summary className="tn-section__head">
          <h2 id={id}>{heading}</h2>
          <Icon name="seta" size={18} className="tn-section__fold-icon" />
        </summary>
        <div className="tn-section__body">{children}</div>
      </details>
    );
  }
  return (
    <section className="tn-section" aria-labelledby={id}>
      <div className="tn-section__head">
        <h2 id={id}>{heading}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Lista agrupada (linhas tocáveis num bloco único). `timeline`: linha do tempo do dia (hora numa coluna, D17 b). */
export function List({ label, timeline, children }: { label?: string; timeline?: boolean; children: ReactNode }) {
  return (
    <ul className="tn-list" data-timeline={timeline || undefined} aria-label={label}>
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
/** `wide`: o ladrilho ocupa a linha inteira onde a tela usa colunas estreitas (valor em reais no celular). */
export function Stat({ label, value, hint, to, wide }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; wide?: boolean }) {
  const inner = (
    <>
      <span className="tn-stat__label">{label}</span>
      <span className="tn-stat__value tn-num">{value}</span>
      {hint ? <span className="tn-stat__hint">{hint}</span> : null}
    </>
  );
  const className = wide ? "tn-stat tn-stat--wide" : "tn-stat";
  return to ? <Link to={to} className={className}>{inner}</Link> : <div className={className}>{inner}</div>;
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

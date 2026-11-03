// "Selecionado" com uma aparência só (auditoria de UX, item 9). Três peças sobre os tokens --tn-selected-*:
// - Segmented: escolha única entre poucas opções (Dia/Semana, Ativos/Arquivados). Rádios nativos.
// - ChipNav: navegação entre telas irmãs (links com aria-current="page").
// - ChoiceCard: opção grande e tocável, única (radio) ou múltipla (checkbox), com ✓ quando marcada.
// - ChipGroup (item 18, onda 3): várias opções curtas em linha (dias da semana, horas de lembrete), chip de 44 px com ✓,
//   texto sem quebra e atalhos opcionais ("Dias úteis").
// O estado nunca é só cor: preenchimento + peso 600 + ✓ (ChoiceCard).
import type { ReactNode } from "react";
import { useId } from "react";
import { Link } from "react-router";

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
  name,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  hideLabel?: boolean;
  name?: string;
}) {
  const auto = useId();
  return (
    <fieldset className="tn-segmented">
      <legend className={hideLabel ? "tn-visually-hidden" : "tn-segmented__legend"}>{label}</legend>
      <div className="tn-segmented__track">
        {options.map((o) => (
          <label key={o.value} className="tn-segmented__option" data-selected={o.value === value || undefined}>
            <input type="radio" name={name ?? auto} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ChipNav({ label, items }: { label: string; items: readonly { to: string; label: ReactNode; current?: boolean }[] }) {
  return (
    <nav className="tn-chipnav" aria-label={label}>
      <ul>
        {items.map((i) => (
          <li key={i.to}>
            <Link to={i.to} aria-current={i.current ? "page" : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ChoiceCard({
  type = "radio",
  name,
  value,
  checked,
  onChange,
  title,
  description,
  disabled,
  invalid,
  describedBy,
}: {
  /** Grupo com erro (validação no envio): o primeiro cartão recebe o foco pelo useFormErrors. */
  invalid?: boolean;
  /** id da mensagem de erro do grupo. */
  describedBy?: string;
  type?: "radio" | "checkbox";
  name: string;
  value: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="tn-choice" data-selected={checked || undefined} data-disabled={disabled || undefined}>
      <input type={type} name={name} value={value} checked={checked} disabled={disabled} aria-invalid={invalid || undefined}
        aria-describedby={describedBy} onChange={(e) => onChange(e.target.checked)} />
      <span className="tn-choice__text">
        <span className="tn-choice__title">{title}</span>
        {description ? <span className="tn-choice__desc">{description}</span> : null}
      </span>
      <svg className="tn-choice__check" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"
        fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 10.5l3.2 3.2L15 6.8" />
      </svg>
    </label>
  );
}

/** Opções curtas, várias marcadas ao mesmo tempo. Caixas de seleção nativas por baixo (teclado e leitor de tela). */
export function ChipGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  shortcuts,
  error,
  errorId,
  hint,
}: {
  label: ReactNode;
  options: readonly { value: T; label: ReactNode; /** Nome lido quando o rótulo é curto ("Seg" → "Segunda"). */ name?: string }[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  /** Atalhos que trocam a seleção inteira ("Dias úteis", "1 dia e 2 h antes"). Ficam marcados quando batem com o valor. */
  shortcuts?: readonly { label: string; values: readonly T[] }[];
  /** Erro do grupo (validação no envio): o primeiro chip recebe aria-invalid e o foco pelo useFormErrors. */
  error?: string | null;
  errorId?: string;
  hint?: ReactNode;
}) {
  const auto = useId();
  const errId = errorId ?? `${auto}-error`;
  const hintId = hint ? `${auto}-hint` : undefined;
  const order = (vs: readonly T[]) => options.map((o) => o.value).filter((v) => vs.includes(v));
  const same = (vs: readonly T[]) => vs.length === value.length && vs.every((v) => value.includes(v));
  const describedBy = [hintId, error ? errId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset className="tn-chips" aria-describedby={describedBy}>
      <legend className="tn-chips__legend">{label}</legend>
      {hint ? <span id={hintId} className="tn-chips__hint">{hint}</span> : null}
      {shortcuts?.length ? (
        <div className="tn-chips__shortcuts">
          {shortcuts.map((sc) => (
            <button key={sc.label} type="button" className="tn-chips__shortcut" aria-pressed={same(sc.values)} onClick={() => onChange(order(sc.values))}>
              {sc.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="tn-chips__list">
        {options.map((o, i) => {
          const on = value.includes(o.value);
          return (
            <label key={String(o.value)} className="tn-chip" data-selected={on || undefined}>
              <input
                type="checkbox"
                checked={on}
                aria-label={o.name}
                aria-invalid={error && i === 0 ? true : undefined}
                onChange={(e) => onChange(order(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value)))}
              />
              <svg className="tn-chip__check" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false"
                fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 10.5l3.2 3.2L15 6.8" />
              </svg>
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
      {error ? <span id={errId} className="tn-field__error">{error}</span> : null}
    </fieldset>
  );
}

/** Dias da semana para o ChipGroup, de segunda a domingo (0 = domingo, como no contrato). O nome inteiro é o lido. */
export const WEEKDAY_CHIPS = [
  { value: 1, label: "Seg", name: "Segunda" },
  { value: 2, label: "Ter", name: "Terça" },
  { value: 3, label: "Qua", name: "Quarta" },
  { value: 4, label: "Qui", name: "Quinta" },
  { value: 5, label: "Sex", name: "Sexta" },
  { value: 6, label: "Sáb", name: "Sábado" },
  { value: 0, label: "Dom", name: "Domingo" },
] as const satisfies readonly { value: number; label: string; name: string }[];

export const WEEKDAY_SHORTCUTS = [
  { label: "Dias úteis", values: [1, 2, 3, 4, 5] },
  { label: "Seg a sáb", values: [1, 2, 3, 4, 5, 6] },
  { label: "Todos os dias", values: [0, 1, 2, 3, 4, 5, 6] },
] as const satisfies readonly { label: string; values: readonly number[] }[];

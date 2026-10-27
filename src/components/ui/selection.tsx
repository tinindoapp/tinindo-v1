// "Selecionado" com uma aparência só (auditoria de UX, item 9). Três peças sobre os tokens --tn-selected-*:
// - Segmented: escolha única entre poucas opções (Dia/Semana, Ativos/Arquivados). Rádios nativos.
// - ChipNav: navegação entre telas irmãs (links com aria-current="page").
// - ChoiceCard: opção grande e tocável, única (radio) ou múltipla (checkbox), com ✓ quando marcada.
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

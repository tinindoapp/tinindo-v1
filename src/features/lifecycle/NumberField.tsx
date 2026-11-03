// Campo numérico de Relacionamento (auditoria de UX, item 42): guarda o TEXTO digitado (apagar não vira "0"), mostra a
// unidade como sufixo e tem − / + de 44 px que andam dentro da faixa. A conversão e a validação são de quem salva.
import { useId } from "react";

/** Texto → inteiro; null quando vazio ou não é número inteiro. */
export function parseWhole(text: string): number | null {
  const t = text.trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

/** Mensagem de faixa ou null quando o texto está dentro dela. */
export function rangeError(text: string, min: number, max: number, unit: string, what: string): string | null {
  const n = parseWhole(text);
  if (n === null) return text.trim() ? `Use só números inteiros, de ${min} a ${max} ${unit}.` : `Informe ${what}, de ${min} a ${max} ${unit}.`;
  if (n < min || n > max) return `Escolha de ${min} a ${max} ${unit}.`;
  return null;
}

export function NumberField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  error,
  hint,
}: {
  label: string;
  /** Unidade no plural, como aparece depois do número ("dias", "envios"). */
  unit: string;
  value: string;
  onChange: (text: string) => void;
  min: number;
  max: number;
  error?: string | null;
  hint?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  // "Menos 1 dia" / "Mais 1 envio"; o nome do campo vai na descrição (sem repetir o rótulo no nome do botão, que
  // confundiria a busca do campo pelo rótulo).
  const one = unit.replace(/s$/, "");
  const errorId = `${id}-error`;
  const n = parseWhole(value);
  const step = (d: number) => onChange(String(Math.min(max, Math.max(min, n === null ? min : n + d))));
  return (
    <div className="tn-field tn-lc-number" data-invalid={error ? true : undefined}>
      <label id={labelId} htmlFor={id}>{label}</label>
      <div className="tn-lc-number__row">
        <button type="button" className="tn-button tn-lc-number__step" data-variant="secondary" aria-label={`Menos 1 ${one}`} aria-describedby={labelId} disabled={n !== null && n <= min} onClick={() => step(-1)}>
          −
        </button>
        <span className="tn-lc-number__box">
          <input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="tn-lc-number__unit" aria-hidden="true">{unit}</span>
        </span>
        <button type="button" className="tn-button tn-lc-number__step" data-variant="secondary" aria-label={`Mais 1 ${one}`} aria-describedby={labelId} disabled={n !== null && n >= max} onClick={() => step(1)}>
          +
        </button>
      </div>
      <span id={hintId} className="tn-field__hint">{hint ?? `De ${min} a ${max} ${unit}.`}</span>
      {error ? <span id={errorId} className="tn-field__error">{error}</span> : null}
    </div>
  );
}

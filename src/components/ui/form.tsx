// Campo padrão e validação no envio (auditoria de UX, itens 12 e 15).
// - <Field as="input|select|textarea"> é a única fonte de campo: rótulo, dica, erro embaixo do campo e
//   aria-describedby/aria-invalid ligados sozinhos.
// - Botão de enviar fica sempre ativo (só desliga enquanto envia). Ao enviar, a tela valida, mostra cada erro
//   embaixo do seu campo e o foco vai para o primeiro campo com erro (useFormErrors).
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type Common = {
  label: ReactNode;
  /** Explicação curta sempre visível embaixo do campo ("Pelo menos 8 caracteres"). */
  hint?: ReactNode;
  /** Mensagem de erro embaixo do campo. Também marca aria-invalid. */
  error?: string | null;
  /** Classe extra no contêiner (layout do módulo). */
  className?: string;
};
type InputField = Common & { as?: "input" } & Omit<ComponentProps<"input">, "className">;
type SelectField = Common & { as: "select"; children: ReactNode } & Omit<ComponentProps<"select">, "className">;
type TextareaField = Common & { as: "textarea" } & Omit<ComponentProps<"textarea">, "className">;
export type FieldProps = InputField | SelectField | TextareaField;

export function Field(props: FieldProps) {
  const { label, hint, error, className, id: idProp, ...rest } = props;
  const auto = useId();
  const id = idProp ?? auto;
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [rest["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  const a11y = { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };

  let control: ReactNode;
  if (rest.as === "select") {
    const { as: _as, ...select } = rest;
    control = <select {...select} {...a11y} />;
  } else if (rest.as === "textarea") {
    const { as: _as, ...textarea } = rest;
    control = <textarea {...textarea} {...a11y} />;
  } else {
    const { as: _as, ...input } = rest;
    control = <input {...input} {...a11y} />;
  }

  return (
    <div className={className ? `tn-field ${className}` : "tn-field"} data-invalid={error ? true : undefined}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint ? (
        <span id={hintId!} className="tn-field__hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId!} className="tn-field__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Foca o primeiro campo marcado como inválido dentro de `root` (ordem do documento). */
export function focusFirstInvalid(root: ParentNode | null | undefined): boolean {
  const el = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!el) return false;
  el.focus();
  if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

/**
 * Erros por campo de um formulário. `show(errors)` grava os erros e, depois de renderizar, foca o primeiro campo
 * com erro dentro de `formRef`. Devolve `true` quando não há erro (pode enviar).
 */
export function useFormErrors<K extends string = string>(): {
  formRef: RefObject<HTMLFormElement | null>;
  errors: Partial<Record<K, string>>;
  show: (errors: Partial<Record<K, string | null | undefined | false>>) => boolean;
  clear: (key?: K) => void;
} {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    if (focusTick) focusFirstInvalid(formRef.current);
  }, [focusTick]);

  const show = useCallback((next: Partial<Record<K, string | null | undefined | false>>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => typeof v === "string" && v)) as Partial<Record<K, string>>;
    setErrors(clean);
    const ok = Object.keys(clean).length === 0;
    if (!ok) setFocusTick((t) => t + 1);
    return ok;
  }, []);

  const clear = useCallback((key?: K) => {
    setErrors((prev) => {
      if (key === undefined) return Object.keys(prev).length ? {} : prev;
      if (!(key in prev)) return prev;
      const { [key]: _gone, ...rest } = prev;
      return rest as Partial<Record<K, string>>;
    });
  }, []);

  return { formRef, errors, show, clear };
}

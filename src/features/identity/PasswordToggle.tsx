// "Mostrar senha" (auditoria de UX, E7): um botão de alternância (aria-pressed, 44 px) que mostra ou esconde as senhas
// do formulário. O nome do botão não muda; o estado vai no aria-pressed, como pede o padrão de botão de alternância.
import { useState } from "react";
import "./identity.css";

/** Estado de visibilidade das senhas de um formulário: `type` vai em cada campo de senha. */
export function usePasswordVisibility() {
  const [visible, setVisible] = useState(false);
  return { visible, type: visible ? "text" : "password", toggle: () => setVisible((v) => !v) } as const;
}

export function PasswordToggle({ visible, onToggle, controls }: { visible: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" className="tn-password-toggle" aria-pressed={visible} aria-controls={controls} onClick={onToggle}>
      <span className="tn-password-toggle__box" aria-hidden="true">
        {visible ? "✓" : ""}
      </span>
      Mostrar senha
    </button>
  );
}

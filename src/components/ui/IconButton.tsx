// Botão só de ícone (auditoria de UX, item 17): uma implementação para o app inteiro. Alvo de 44 × 44 px (40 no
// tamanho "sm", dentro de avisos), nome acessível obrigatório e desabilitado com o token --tn-opacity-disabled.
import type { ComponentProps } from "react";
import { Icon, type IconName } from "./icons.tsx";

export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  type = "button",
  className,
  ...rest
}: Omit<ComponentProps<"button">, "children" | "aria-label"> & {
  icon: IconName;
  /** Nome acessível (lido pelo leitor de tela e mostrado como dica ao passar o mouse). */
  label: string;
  size?: "sm" | "md";
  variant?: "ghost" | "secondary";
}) {
  return (
    <button type={type} className={className ? `tn-icon-button ${className}` : "tn-icon-button"} data-size={size} data-variant={variant} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size === "sm" ? 18 : 22} />
    </button>
  );
}

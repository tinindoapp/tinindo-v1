// Botão "⋯" com menu de ações (auditoria de UX, itens 35 e 44). Nasceu na ficha de clientes (onda 2) e veio para o
// sistema na onda 3 para ser usado também nas Avaliações ("Denunciar" deixa de ter o mesmo peso de "Responder").
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { IconButton } from "./IconButton.tsx";
import "./menu.css";

const menuItems = (menu: HTMLElement | null) => Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

export interface MenuAction {
  label: string;
  onSelect: () => void;
  /** Desligado (ex.: demonstração somente leitura): continua no menu, com o motivo em `hint`. */
  disabled?: boolean;
  /** Ação que pede cuidado (ex.: "Denunciar…"): mesmo peso visual, só a cor do texto muda. */
  tone?: "danger";
}

/**
 * Botão "⋯" com menu (padrão de botão de menu do WAI-ARIA): abre com clique, Enter, Espaço ou setas; setas, Home e End
 * andam pelos itens; Esc fecha e devolve o foco ao botão; Tab ou clique fora fecham. Escolher um item devolve o foco ao
 * botão antes de rodar a ação, para que uma folha ou confirmação aberta pela ação saiba para onde voltar.
 */
export function ActionsMenu({ label, actions, hint }: { label: string; actions: MenuAction[]; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<"first" | "last">("first");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hintId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const list = menuItems(menu.current);
    (start === "last" ? list.at(-1) : list[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, start]);

  function openWith(where: "first" | "last") {
    setStart(where);
    setOpen(true);
  }

  function onButtonKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openWith(e.key === "ArrowUp" ? "last" : "first");
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    const list = menuItems(menu.current);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(list.length - 1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="tn-menu" ref={wrap}>
      <IconButton
        ref={button}
        icon="opcoes"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openWith("first"))}
        onKeyDown={onButtonKey}
      />
      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label={label} aria-describedby={hint ? hintId : undefined} className="tn-menu__list" onKeyDown={onMenuKey}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="tn-menu__item"
              data-tone={a.tone}
              aria-disabled={a.disabled || undefined}
              onClick={() => {
                if (a.disabled) return;
                close(true);
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
          {hint ? (
            <p id={hintId} className="tn-menu__hint">
              {hint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

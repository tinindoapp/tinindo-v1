// Peças do cartão e da ficha do cliente: ligar, WhatsApp e o menu "⋯" das ações de cadastro (auditoria de UX, item 35).
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { telHref, whatsappHref } from "./format.ts";
import { IconButton } from "../../components/ui/index.tsx";

/** "Ligar" (tel:) e "WhatsApp" (wa.me). Sem telefone cadastrado, nenhum dos dois aparece. */
export function ContactButtons({ name, phone }: { name: string; phone: string | null }) {
  const tel = telHref(phone);
  const wa = whatsappHref(phone);
  if (!tel || !wa) return null;
  return (
    <>
      <a className="tn-button crm-contact" data-variant="secondary" href={tel} aria-label={`Ligar para ${name}`}>
        Ligar
      </a>
      <a
        className="tn-button crm-contact"
        data-variant="secondary"
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`WhatsApp de ${name} (abre o WhatsApp)`}
      >
        WhatsApp
      </a>
    </>
  );
}

const menuItems = (menu: HTMLElement | null) => Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

export interface MenuAction {
  label: string;
  onSelect: () => void;
  /** Desligado (ex.: demonstração somente leitura): continua no menu, com o motivo em `hint`. */
  disabled?: boolean;
}

/**
 * Botão "⋯" com menu (padrão de botão de menu do WAI-ARIA): abre com clique, Enter, Espaço ou setas; setas, Home e End
 * andam pelos itens; Esc fecha e devolve o foco ao botão; Tab ou clique fora fecham.
 */
export function ActionsMenu({ label, actions, hint }: { label: string; actions: MenuAction[]; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<"first" | "last">("first");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const hintId = useId();

  const items = () => menuItems(menu.current);
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
    const list = items();
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
    <div className="crm-menu" ref={wrap}>
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
        <div ref={menu} id={menuId} role="menu" aria-label={label} aria-describedby={hint ? hintId : undefined} className="crm-menu__list" onKeyDown={onMenuKey}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="crm-menu__item"
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
            <p id={hintId} className="crm-menu__hint">
              {hint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

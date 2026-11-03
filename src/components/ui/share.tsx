// Compartilhar e copiar (auditoria de UX, onda 3): um componente só para orçamento, Relacionamento, perfil, convite e
// cobrança. Antes havia quatro cópias nos módulos (sales, lifecycle, network e payments).
// A Tinindo não envia mensagens: "compartilhado" só quer dizer que o dono abriu ou copiou, nunca que chegou.
import { useEffect, useRef, useState } from "react";
import { Button } from "./index.tsx";

export type ShareHow = "whatsapp" | "share" | "copy";

/** Link wa.me: com o telefone (só dígitos, com DDI) abre a conversa da pessoa; sem ele, o WhatsApp pede o contato. */
export function whatsappHref(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const q = `?text=${encodeURIComponent(text)}`;
  return digits.length >= 10 ? `https://wa.me/${digits}${q}` : `https://wa.me/${q}`;
}

export const COPY_FAILED = "Não deu para copiar. Toque e segure no link para copiar.";

/** Copia para a área de transferência. Devolve false quando o navegador não deixa (sem permissão, sem API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const canNativeShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * "Enviar pelo WhatsApp" (wa.me com o texto pronto), "Compartilhar…" (folha do sistema, se o aparelho tiver) e copiar,
 * com o retorno escrito ao lado ("Copiado ✓"). `onShared` só é chamado depois que deu certo (ou ao abrir o WhatsApp):
 * nada é marcado como compartilhado se a cópia falhar.
 */
export function ShareActions({
  message,
  copyText: toCopy,
  copyLabel,
  phone,
  onShared,
  whatsappLabel = "Enviar pelo WhatsApp",
}: {
  /** Mensagem pronta (com o link) para WhatsApp e compartilhar. */
  message: string;
  /** O que vai para a área de transferência. */
  copyText: string;
  copyLabel: string;
  phone?: string | null;
  onShared?: (how: ShareHow) => void;
  whatsappLabel?: string;
}) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flash = (text: string) => {
    setStatus({ ok: true, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 2000);
  };
  const fail = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus({ ok: false, text });
  };

  async function copy() {
    if (!(await copyText(toCopy))) {
      fail(COPY_FAILED);
      return;
    }
    flash("Copiado ✓");
    onShared?.("copy");
  }

  async function share() {
    try {
      await navigator.share({ text: message });
    } catch (e) {
      // Fechar a folha sem escolher não é erro.
      if ((e as { name?: string } | null)?.name !== "AbortError") fail("Não deu para abrir o compartilhamento. Use o WhatsApp ou copie o link.");
      return;
    }
    flash("Compartilhado ✓");
    onShared?.("share");
  }

  return (
    <div className="tn-share">
      <div className="tn-actions">
        <a
          className="tn-button"
          data-variant="primary"
          href={whatsappHref(phone, message)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onShared?.("whatsapp")}
        >
          {whatsappLabel}
        </a>
        {canNativeShare() ? <Button variant="secondary" onClick={() => void share()}>Compartilhar…</Button> : null}
        <Button variant="secondary" onClick={() => void copy()}>{copyLabel}</Button>
      </div>
      <p role="status" className="tn-share__status" data-ok={status ? String(status.ok) : undefined}>{status?.text ?? ""}</p>
    </div>
  );
}

/**
 * Botão de copiar com o retorno no próprio botão ("Copiado ✓") e, se falhar, a explicação escrita ao lado.
 * `what` entra no anúncio para leitor de tela ("Pix copiado."); `failHint` diz onde copiar à mão.
 */
export function CopyButton({
  text,
  label,
  what,
  variant = "primary",
  failHint = "Toque e segure no texto para copiar.",
  onCopied,
}: {
  text: string;
  label: string;
  what: string;
  variant?: "primary" | "secondary";
  failHint?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    const ok = await copyText(text);
    setState(ok ? "ok" : "fail");
    window.clearTimeout(timer.current);
    if (ok) {
      timer.current = window.setTimeout(() => setState("idle"), 4000);
      onCopied?.();
    }
  }
  return (
    <span className="tn-copy">
      <Button variant={variant} onClick={() => void copy()}>{state === "ok" ? "Copiado ✓" : label}</Button>
      <span role="status" className={state === "fail" ? "tn-copy__fail" : "tn-visually-hidden"}>
        {state === "ok" ? `${what} copiado.` : state === "fail" ? `Não deu para copiar. ${failHint}` : ""}
      </span>
    </span>
  );
}

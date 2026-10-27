// Compartilhar um texto pronto: WhatsApp (wa.me), folha do sistema (navigator.share) e copiar, com retorno visível.
// A Tinindo não envia mensagens: "compartilhado" só quer dizer que o dono abriu/copiou, nunca que chegou.
// Cópia idêntica em src/features/sales/share.tsx (módulos não importam um ao outro); pode subir para o sistema depois.
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/index.tsx";

export type ShareHow = "whatsapp" | "share" | "copy";

/** Link wa.me: com o telefone (só dígitos, com DDI) abre a conversa da cliente; sem ele, o WhatsApp pede o contato. */
export function whatsappHref(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const q = `?text=${encodeURIComponent(text)}`;
  return digits.length >= 10 ? `https://wa.me/${digits}${q}` : `https://wa.me/${q}`;
}

export const COPY_FAILED = "Não deu para copiar. Toque e segure no link para copiar.";

export function ShareActions({
  message,
  copyText,
  copyLabel,
  phone,
  onShared,
}: {
  /** Mensagem pronta (com o link) para WhatsApp e compartilhar. */
  message: string;
  /** O que vai para a área de transferência. */
  copyText: string;
  copyLabel: string;
  phone?: string | null;
  /** Chamado só depois que a cópia/compartilhamento deu certo (ou ao abrir o WhatsApp). */
  onShared?: (how: ShareHow) => void;
}) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

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
    try {
      if (!navigator.clipboard?.writeText) throw new Error("sem área de transferência");
      await navigator.clipboard.writeText(copyText);
    } catch {
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
      <div className="tn-share__actions">
        <a
          className="tn-button"
          data-variant="primary"
          href={whatsappHref(phone, message)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onShared?.("whatsapp")}
        >
          Enviar pelo WhatsApp
        </a>
        {canShare ? <Button variant="secondary" onClick={() => void share()}>Compartilhar…</Button> : null}
        <Button variant="secondary" onClick={() => void copy()}>{copyLabel}</Button>
      </div>
      <p role="status" className="tn-share__status" data-ok={status ? String(status.ok) : undefined}>{status?.text ?? ""}</p>
    </div>
  );
}

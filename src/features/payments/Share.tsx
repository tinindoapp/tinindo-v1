// Copiar e compartilhar a cobrança: "Copiar Pix" primeiro, depois WhatsApp e link. O código inteiro fica em "Ver código".
// Copiar pode falhar (navegador sem permissão): a tela diz e o código continua à mão para copiar.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/index.tsx";
import { pixMessage, whatsappUrl } from "./labels.ts";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label, variant = "primary", what }: { text: string; label: string; variant?: "primary" | "secondary"; what: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    const ok = await writeClipboard(text);
    setState(ok ? "ok" : "fail");
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setState("idle"), 4000);
  }
  return (
    <span className="tn-pay-copy">
      <Button variant={variant} onClick={() => void copy()}>{state === "ok" ? "Copiado ✓" : label}</Button>
      <span role="status" className={state === "fail" ? "tn-pay-copy__fail" : "tn-visually-hidden"}>
        {state === "ok" ? `${what} copiado.` : state === "fail" ? `Não deu para copiar. Abra "Ver código" e copie à mão.` : ""}
      </span>
    </span>
  );
}

/** Código e link completos, recolhidos. */
export function CodeDetails({ pix, url }: { pix?: string | null; url?: string | null }) {
  if (!pix && !url) return null;
  return (
    <details className="tn-pay-details">
      <summary>Ver código</summary>
      {pix ? (
        <>
          <p className="tn-pay-muted">Pix copia e cola:</p>
          <code className="tn-pay-code" aria-label="Pix copia e cola">{pix}</code>
        </>
      ) : null}
      {url ? (
        <>
          <p className="tn-pay-muted">Link de pagamento:</p>
          <code className="tn-pay-code" aria-label="Link de pagamento">{url}</code>
        </>
      ) : null}
    </details>
  );
}

/** Painel da cobrança recém-criada: copiar o Pix, mandar pelo WhatsApp, copiar o link, abrir como a cliente. */
export function ShareCharge({ description, amountCents, pix, url, openLink }: { description: string; amountCents: number; pix: string | null; url: string; openLink: ReactNode }) {
  return (
    <div className="tn-pay-share" role="group" aria-label="Enviar a cobrança">
      <div className="tn-pay-actions">
        {pix ? <CopyButton text={pix} label="Copiar Pix" what="Pix" /> : null}
        <a className="tn-button" data-variant="secondary" href={whatsappUrl(pixMessage(description, amountCents, url))} target="_blank" rel="noreferrer">
          Enviar pelo WhatsApp
        </a>
        <CopyButton text={url} label="Copiar link" variant="secondary" what="Link" />
      </div>
      <p className="tn-pay-muted">Abrir o WhatsApp não confirma que a cliente recebeu. O pagamento só aparece aqui quando o banco confirma.</p>
      {openLink}
      <CodeDetails pix={pix} url={url} />
    </div>
  );
}

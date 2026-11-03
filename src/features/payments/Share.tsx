// Copiar e compartilhar a cobrança: "Copiar Pix" primeiro, depois WhatsApp e link. O código inteiro fica em "Ver código".
// Copiar pode falhar (navegador sem permissão): a tela diz e o código continua à mão para copiar.
import type { ReactNode } from "react";
import { CopyButton as BaseCopyButton, whatsappHref } from "../../components/ui/index.tsx";
import { pixMessage } from "./labels.ts";

/** Copiar da cobrança: se falhar, o código continua à mão em "Ver código". */
export function CopyButton(props: { text: string; label: string; variant?: "primary" | "secondary"; what: string }) {
  return <BaseCopyButton {...props} failHint={'Abra "Ver código" e copie à mão.'} />;
}

/** Código e link completos, recolhidos. */
export function CodeDetails({ pix, url }: { pix?: string | null; url?: string | null }) {
  if (!pix && !url) return null;
  return (
    <details className="tn-pay-details">
      <summary>Ver código</summary>
      {pix ? (
        <>
          <p className="tn-muted">Pix copia e cola:</p>
          <code className="tn-pay-code" aria-label="Pix copia e cola">{pix}</code>
        </>
      ) : null}
      {url ? (
        <>
          <p className="tn-muted">Link de pagamento:</p>
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
      <div className="tn-actions">
        {pix ? <CopyButton text={pix} label="Copiar Pix" what="Pix" /> : null}
        <a className="tn-button" data-variant="secondary" href={whatsappHref(null, pixMessage(description, amountCents, url))} target="_blank" rel="noreferrer">
          Enviar pelo WhatsApp
        </a>
        <CopyButton text={url} label="Copiar link" variant="secondary" what="Link" />
      </div>
      <p className="tn-muted">Abrir o WhatsApp não confirma que a cliente recebeu. O pagamento só aparece aqui quando o banco confirma.</p>
      {openLink}
      <CodeDetails pix={pix} url={url} />
    </div>
  );
}

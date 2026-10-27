// Link para compartilhar manualmente. Abrir o compartilhamento não é "entregue":
// a Tinindo não sabe se a mensagem chegou e não envia nada sozinha.
import { useEffect, useState } from "react";
import { Button, Field, StatusBanner, toast } from "../../components/ui/index.tsx";
import type { ReferralLinkData } from "./api.ts";
import { formatDateTime } from "./useNetworkApi.ts";

/** Link de "Mandar no WhatsApp": abre o WhatsApp da pessoa com o texto pronto; ela escolhe o contato e envia. */
export function whatsappShareHref(text: string, url: string) {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

/** Campo com o link + Copiar, Mandar no WhatsApp (se houver texto) e Compartilhar (se o aparelho tiver). */
export function ShareActions({ url, label, whatsappText }: { url: string; label: string; whatsappText?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("sem área de transferência");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Link copiado. Cole na conversa com a pessoa.");
    } catch {
      setCopied(false);
      toast({ tone: "warning", message: "Não foi possível copiar. Selecione o link e copie manualmente." });
    }
  }

  async function share() {
    try {
      await navigator.share(whatsappText ? { url, text: whatsappText } : { url });
      toast({ tone: "info", message: "Compartilhamento aberto. A Tinindo não confirma se a mensagem foi entregue." });
    } catch {
      /* cancelado pela pessoa: nada a fazer */
    }
  }

  return (
    <>
      <Field label={label} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      <div className="tn-actions">
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? "Copiado" : "Copiar link"}
        </Button>
        {whatsappText ? (
          <a
            className="tn-button"
            data-variant="secondary"
            href={whatsappShareHref(whatsappText, url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => toast({ tone: "info", message: "WhatsApp aberto. Escolha a conversa e envie: a Tinindo não confirma se a mensagem foi entregue." })}
          >
            Mandar no WhatsApp
          </a>
        ) : null}
        {typeof navigator.share === "function" ? (
          <Button variant="secondary" onClick={() => void share()}>
            Compartilhar
          </Button>
        ) : null}
      </div>
    </>
  );
}

export function ShareLink({ link, demo }: { link: ReferralLinkData; demo: boolean }) {
  return (
    <div className="tn-stack tn-net-share">
      <StatusBanner tone="success">
        Link criado. Vale até <span className="tn-num">{formatDateTime(link.expires_at)}</span> e pode ser usado uma vez.
        {demo ? " Demonstração: o link só funciona nesta aba." : null}
      </StatusBanner>
      <ShareActions url={link.share_url} label="Link para compartilhar" />
    </div>
  );
}

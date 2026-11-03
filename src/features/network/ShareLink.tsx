// Link para compartilhar manualmente. Abrir o compartilhamento não é "entregue":
// a Tinindo não sabe se a mensagem chegou e não envia nada sozinha.
import { Field, ShareActions as BaseShareActions, StatusBanner } from "../../components/ui/index.tsx";
import type { ReferralLinkData } from "./api.ts";
import { formatDateTime } from "./useNetworkApi.ts";

/** Campo com o link + Enviar pelo WhatsApp (com o texto pronto), Compartilhar… (se o aparelho tiver) e Copiar link. */
export function ShareActions({ url, label, whatsappText }: { url: string; label: string; whatsappText?: string }) {
  return (
    <>
      <Field label={label} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      <BaseShareActions message={whatsappText ? `${whatsappText} ${url}` : url} copyText={url} copyLabel="Copiar link" />
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

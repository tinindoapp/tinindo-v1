// Link pessoal para compartilhar manualmente. Abrir o compartilhamento não é "entregue":
// a Tinindo não sabe se a mensagem chegou e não envia nada sozinha.
import { useState } from "react";
import { Button, StatusBanner } from "../../components/ui/index.tsx";
import type { ReferralLinkData } from "./api.ts";
import { formatDateTime } from "./useNetworkApi.ts";

export function ShareLink({ link, demo }: { link: ReferralLinkData; demo: boolean }) {
  const [status, setStatus] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.share_url);
      setStatus("Link copiado. Cole na conversa com a pessoa.");
    } catch {
      setStatus("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  }

  async function share() {
    try {
      await navigator.share({ url: link.share_url });
      setStatus("Compartilhamento aberto. A Tinindo não confirma se a mensagem foi entregue.");
    } catch {
      /* cancelado pela pessoa: nada a fazer */
    }
  }

  return (
    <div className="tn-stack tn-net-share">
      <StatusBanner tone="success">
        Link criado. Vale até <span className="tn-num">{formatDateTime(link.expires_at)}</span> e pode ser usado uma vez.
        {demo ? " Demonstração: o link só funciona nesta aba." : null}
      </StatusBanner>
      <label className="tn-field">
        <span>Link para compartilhar</span>
        <input readOnly value={link.share_url} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="tn-net-actions">
        <Button variant="secondary" onClick={() => void copy()}>
          Copiar link
        </Button>
        {typeof navigator.share === "function" ? (
          <Button variant="secondary" onClick={() => void share()}>
            Compartilhar
          </Button>
        ) : null}
      </div>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}

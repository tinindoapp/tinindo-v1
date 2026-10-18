// Página pública da oferta de vaga (/oferta#t=…). O token sai da URL na hora e só vai ao servidor por POST.
// Abrir não reserva; aceitar e recusar são ações explícitas. Aceitar de novo mostra a mesma reserva.
import { useEffect, useState } from "react";
import type { WaitlistOfferView } from "@contracts";
import type { z } from "zod";
import { Button, Card, StatusBanner, Wordmark } from "../../components/ui/index.tsx";
import { formatCents, formatDateTime, formatSlot } from "./format.ts";
import { newKey, type OfferLinkPort } from "./port.ts";

const KEY = "tinindo.offer";

function takeToken(): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
  if (m?.[1]) {
    try {
      sessionStorage.setItem(KEY, m[1]);
    } catch {
      /* sem armazenamento: vale enquanto a página estiver aberta */
    }
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return m[1];
  }
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

type View = z.infer<typeof WaitlistOfferView>;

export function OfferPage({ port }: { port: OfferLinkPort }) {
  const [token] = useState(takeToken);
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "accepted" | "declined" | "error">(token ? "loading" : "missing");
  const [message, setMessage] = useState<string | null>(null);
  const [keys] = useState(() => ({ accept: newKey(), decline: newKey() }));
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    port.view(token).then(
      (v) => { if (alive) { setView(v); setState(v.status === "accepted" ? "accepted" : v.status === "declined" ? "declined" : "ready"); } },
      () => alive && setState("missing"),
    );
    return () => { alive = false; };
  }, [port, token]);

  async function act(kind: "accept" | "decline") {
    if (!token) return;
    setPending(true);
    setMessage(null);
    try {
      if (kind === "accept") {
        await port.accept(token, keys.accept);
        setState("accepted");
      } else {
        await port.decline(token, keys.decline);
        setState("declined");
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      setMessage(code === "POLICY_REJECTED" ? "Esta oferta venceu ou não está mais disponível. Nenhuma reserva foi feita." : "Não foi possível concluir agora. Tentar de novo é seguro.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="tn-auth">
      <Card aria-labelledby="offer-title">
        <Wordmark width={144} />
        <h1 id="offer-title" className="tn-auth__title">Vaga disponível</h1>
        {port.kind === "demo" ? <StatusBanner tone="info"><strong>Dados de exemplo.</strong> Demonstração sem servidor.</StatusBanner> : null}
        {state === "loading" ? <p role="status">Carregando…</p> : null}
        {state === "missing" ? <StatusBanner tone="warning">Este link não é válido ou já foi usado em outro aparelho.</StatusBanner> : null}
        {view && state !== "missing" ? (
          <dl className="tn-wl-offer">
            <dt>Onde</dt><dd>{view.business_name}</dd>
            <dt>Serviço</dt><dd>{view.service_name}</dd>
            <dt>Quando</dt><dd>{formatSlot(view.slot, view.timezone)}</dd>
            <dt>Valor</dt><dd className="tn-num">{formatCents(view.price_cents)}</dd>
          </dl>
        ) : null}
        {state === "ready" && view?.status === "offered" ? (
          <>
            <p className="tn-wl-muted">Abrir esta página não reserva nada. A oferta vale até {formatDateTime(view.expires_at, view.timezone)}.</p>
            {message ? <StatusBanner tone="danger">{message}</StatusBanner> : null}
            <div className="tn-wl-actions">
              <Button disabled={pending} onClick={() => void act("accept")}>Aceitar e reservar</Button>
              <Button variant="secondary" disabled={pending} onClick={() => void act("decline")}>Não quero</Button>
            </div>
          </>
        ) : null}
        {state === "ready" && view && view.status !== "offered" ? (
          <StatusBanner tone="warning">Esta oferta não está mais disponível ({view.status === "expired" ? "venceu" : "encerrada"}).</StatusBanner>
        ) : null}
        {state === "accepted" ? <StatusBanner tone="success">Reserva confirmada. Até lá!</StatusBanner> : null}
        {state === "declined" ? <StatusBanner tone="info">Tudo bem: a vaga foi liberada para outra pessoa.</StatusBanner> : null}
      </Card>
    </main>
  );
}

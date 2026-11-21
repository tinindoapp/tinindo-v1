// Selo de não lidas na aba "Mensagens" (auditoria de UX, item 39). O shell lê o contador leve `inbox.unread_count`
// (recado #89) a cada troca de tela e, com a aba visível, a cada minuto. Sem canal, sem permissão (só o dono lê o canal)
// ou com erro, não mostra selo. Nunca inventa número.
import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { createDemoPort } from "./demoPort.ts";
import type { Inbox, MessagingPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

export { unreadLabel } from "./labels.ts";

/** Com a aba visível, o selo se atualiza sozinho neste intervalo (sem esperar a troca de tela). */
export const UNREAD_POLL_MS = 60_000;

export const unreadTotal = (inbox: Inbox) => inbox.contacts.reduce((n, k) => n + k.unread_count, 0);

/** Total de mensagens não lidas do negócio. `refreshKey` (a rota atual) faz ler de novo. */
export function useUnreadMessages(refreshKey: string, active = true): number {
  const { state } = useSession();
  // P53 (recado #148): o cliente da sessão, não um cliente próprio.
  const { demo, call, tenantId } = useApi();
  // P51: `active` falso (Mensagens não aparece para o negócio) = não lê nada.
  const ready = active && (state.status === "offline_demo" || state.status === "signed_in");
  const port = useMemo<MessagingPort | null>(() => {
    if (!ready) return null;
    if (demo) return createDemoPort();
    if (!tenantId || !call) return null;
    return createServerPort(call, tenantId);
  }, [ready, demo, call, tenantId]);
  const [count, setCount] = useState<{ port: MessagingPort; n: number } | null>(null);
  useEffect(() => {
    if (!port) return;
    let alive = true;
    const read = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      port.unreadCount().then(
        (c) => alive && setCount({ port, n: c.unread }),
        () => alive && setCount({ port, n: 0 }),
      );
    };
    read();
    const timer = setInterval(read, UNREAD_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [port, refreshKey]);
  return count && count.port === port ? count.n : 0;
}

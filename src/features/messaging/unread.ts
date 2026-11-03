// Selo de não lidas na aba "Mensagens" (auditoria de UX, item 39). O shell lê a caixa de entrada a cada troca de tela;
// sem canal, sem permissão (só o dono lê o canal) ou com erro, não mostra selo. Nunca inventa número.
import { useEffect, useMemo, useState } from "react";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createDemoPort } from "./demoPort.ts";
import type { Inbox, MessagingPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";

export { unreadLabel } from "./labels.ts";

export const unreadTotal = (inbox: Inbox) => inbox.contacts.reduce((n, k) => n + k.unread_count, 0);

/** Total de mensagens não lidas do negócio. `refreshKey` (a rota atual) faz ler de novo. */
export function useUnreadMessages(refreshKey: string): number {
  const { state, tenantId, getAccessToken } = useSession();
  const demo = state.status === "offline_demo" || !appEnv.supabase;
  const ready = state.status === "offline_demo" || state.status === "signed_in";
  const port = useMemo<MessagingPort | null>(() => {
    if (!ready) return null;
    if (demo) return createDemoPort();
    if (!tenantId || !appEnv.supabase) return null;
    return createServerPort(createApiClient({ baseUrl: appEnv.supabase.url, publishableKey: appEnv.supabase.publishableKey, getAccessToken }), tenantId);
  }, [ready, demo, tenantId, getAccessToken]);
  const [count, setCount] = useState<{ port: MessagingPort; n: number } | null>(null);
  useEffect(() => {
    if (!port) return;
    let alive = true;
    port.inbox().then(
      (inbox) => alive && setCount({ port, n: unreadTotal(inbox) }),
      () => alive && setCount({ port, n: 0 }),
    );
    return () => {
      alive = false;
    };
  }, [port, refreshKey]);
  return count && count.port === port ? count.n : 0;
}

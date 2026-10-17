// Início: demonstra o caminho request → autorização → banco (Edge Function `context`).
import { useEffect, useState } from "react";
import { ContextResponse } from "@contracts";
import { Card, StatusBanner } from "../../components/ui/index.tsx";
import { ApiError, createApiClient } from "../../lib/api/client.ts";
import { appEnv } from "../env.ts";
import { useSession } from "../session.tsx";

type Check =
  | { kind: "idle" }
  | { kind: "ok"; tenant: string; role: string; requestId: string }
  | { kind: "error"; message: string; requestId: string | null };

const ROLE_LABEL: Record<string, string> = { owner: "dono", staff: "equipe" };

export function Home() {
  const session = useSession();
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const tenantId = session.tenantId;
  const online = session.state.status === "signed_in";
  const { getAccessToken } = session;

  useEffect(() => {
    if (!online || !tenantId || !appEnv.supabase) return;
    const call = createApiClient({
      baseUrl: appEnv.supabase.url,
      publishableKey: appEnv.supabase.publishableKey,
      getAccessToken,
    });
    let cancelled = false;
    call("/context", ContextResponse, { tenantId })
      .then(({ data, meta }) => {
        if (!cancelled) setCheck({ kind: "ok", tenant: data.tenant_name, role: data.role, requestId: meta.request_id });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : null;
        setCheck({ kind: "error", message: err?.message ?? "Falha inesperada.", requestId: err?.requestId ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [online, tenantId, getAccessToken]);

  return (
    <div className="tn-stack">
      <Card aria-labelledby="home-title">
        <p className="tn-caps">Início</p>
        <h1 id="home-title">Seu negócio em ordem</h1>
        <p>
          Esta é a fundação do aplicativo. Agenda, clientes, caixa e assistente chegam pelos pacotes P01 a P09.
        </p>
        {session.state.status === "offline_demo" ? (
          <StatusBanner tone="info">
            Demonstração sem servidor: dados de exemplo, nada é salvo. Configure o Supabase para entrar de verdade.
          </StatusBanner>
        ) : null}
        {check.kind === "ok" ? (
          <StatusBanner tone="success">
            Acesso confirmado pelo servidor: <strong>{check.tenant}</strong> como {ROLE_LABEL[check.role] ?? check.role}.
            <br />
            <span className="tn-num">Pedido {check.requestId.slice(0, 8)}</span>
          </StatusBanner>
        ) : null}
        {check.kind === "error" ? (
          <StatusBanner tone="danger">
            {check.message}
            {check.requestId ? <span className="tn-num"> Pedido {check.requestId.slice(0, 8)}.</span> : null}
          </StatusBanner>
        ) : null}
      </Card>
    </div>
  );
}

// Telas de Mensagens, carregadas sob demanda pelo manifesto (module.tsx).
// Sem Supabase (demonstração offline) usa a emulação local, sempre rotulada; com Supabase, a função `messaging`.
// P53: o fuso vem do contexto do negócio na sessão (antes começava com o da fixture e trocava depois de pedir /context).
import { useContext } from "react";
import { useParams } from "react-router";
import { BusinessPending, useBusinessTimezone, usePort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoPort } from "./demoPort.ts";
import { InboxExtraContext } from "./inbox-extra.ts";
import { ConversationPage, InboxPage } from "./InboxPage.tsx";
import type { MessagingPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import { SimulatorPage } from "./SimulatorPage.tsx";

function useMessaging() {
  const { tenantId } = useSession();
  const port = usePort<MessagingPort>({ demo: createDemoPort, server: createServerPort });
  return { port, tenantId, ...useBusinessTimezone() };
}

function NoTenant({ title }: { title: string }) {
  return (
    <div className="tn-stack">
      <PageHeader id="msg-no-tenant" title={title} />
      <StatusBanner tone="info">Selecione um negócio para ver o canal.</StatusBanner>
    </div>
  );
}

export function InboxLayout() {
  const { port, timezone, failed, retry, tenantId } = useMessaging();
  const extra = useContext(InboxExtraContext);
  if (!port) return <NoTenant title="Mensagens" />;
  if (!timezone) return <BusinessPending failed={failed} retry={retry} />;
  return <InboxPage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} extra={extra} />;
}

export function ConversationLayout() {
  const { port, timezone, failed, retry, tenantId } = useMessaging();
  const { contactId = "" } = useParams();
  if (!port) return <NoTenant title="Mensagens" />;
  if (!timezone) return <BusinessPending failed={failed} retry={retry} />;
  return <ConversationPage key={`${port.kind}:${tenantId ?? ""}:${contactId}`} port={port} timezone={timezone} contactId={contactId} />;
}

export function SimulatorLayout() {
  const { port, timezone, failed, retry, tenantId } = useMessaging();
  if (!port) return <NoTenant title="Simulador do telefone" />;
  if (!timezone) return <BusinessPending failed={failed} retry={retry} />;
  return <SimulatorPage key={`${port.kind}:${tenantId ?? ""}`} port={port} timezone={timezone} />;
}

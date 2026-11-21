// Tela do módulo Calendário e avisos. O manifesto (module.tsx) vai pronto no recado #203: o registro e o vocabulário da
// telemetria (src/lib/telemetry) são de fora da área.
import { useMemo } from "react";
import { usePort } from "../../app/api.tsx";
import { createDemoPushPort, createServerPushPort, type PushPort } from "../../app/pwa/push-client.ts";
import { browserPushEnv } from "../../app/pwa/PushSettings.tsx";
import { CalendarPage } from "./CalendarPage.tsx";

export function CalendarLayout() {
  const push = usePort<PushPort>({ demo: createDemoPushPort, server: (call, tenantId) => createServerPushPort(call as never, tenantId) });
  const env = useMemo(() => browserPushEnv(), []);
  return <CalendarPage push={push} pushEnv={env} />;
}

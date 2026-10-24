// Layout do módulo: escolhe a fonte de dados e carrega o contexto (fuso, serviços, clientes).
// Sem Supabase (demonstração offline) usa a emulação sobre fixtures, sempre rotulada.
import { createContext, useContext, useEffect, useEffectEvent, useMemo, useState } from "react";
import { Outlet } from "react-router";
import { appEnv } from "../../app/env.ts";
import { useSession } from "../../app/session.tsx";
import { createApiClient } from "../../lib/api/client.ts";
import { createFixturePort, type Simulation } from "./fixturePort.ts";
import type { CustomerRef, SchedulingContext, SchedulingPort } from "./port.ts";
import { createServerPort } from "./serverPort.ts";
import type { ProviderService } from "@contracts";
import { ErrorPanel } from "./parts.tsx";
import "./scheduling.css";

let demoPort: SchedulingPort | null = null;

function readSimulation(): Simulation {
  try {
    const v = new URLSearchParams(window.location.search).get("simular");
    return v === "conflito" || v === "versao" ? v : null;
  } catch {
    return null;
  }
}

/** Uma emulação por carregamento de página: as mudanças valem enquanto a aba estiver aberta. */
export function getDemoPort(): SchedulingPort {
  demoPort ??= createFixturePort({ simulate: readSimulation(), latencyMs: 120 });
  return demoPort;
}

/** Só para testes. */
export function resetDemoPort(port: SchedulingPort | null = null) {
  demoPort = port;
}

const PortContext = createContext<SchedulingPort | null>(null);

export function usePort(): SchedulingPort {
  const port = useContext(PortContext);
  if (!port) throw new Error("usePort fora do módulo de agenda");
  return port;
}

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload(): void;
}

/** Carrega `load` sempre que `key` mudar; `reload` força nova leitura. */
export function useAsync<T>(key: string, load: () => Promise<T>): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const fullKey = `${key}#${nonce}`;
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown } | null>(null);
  const run = useEffectEvent(load);
  useEffect(() => {
    let alive = true;
    run().then(
      (data) => alive && setState({ key: fullKey, data }),
      (error: unknown) => alive && setState({ key: fullKey, error: error ?? new Error("erro") }),
    );
    return () => {
      alive = false;
    };
  }, [fullKey]);
  const current = state?.key === fullKey ? state : null;
  return useMemo(
    () => ({ data: current?.data, error: current?.error, loading: current === null, reload: () => setNonce((n) => n + 1) }),
    [current],
  );
}

export interface SchedulingBase {
  ctx: SchedulingContext;
  services: ProviderService[];
  customers: CustomerRef[];
}

const BaseContext = createContext<SchedulingBase | null>(null);

export function useBase(): SchedulingBase {
  const base = useContext(BaseContext);
  if (!base) throw new Error("useBase fora do módulo de agenda");
  return base;
}

function BaseLoader({ port }: { port: SchedulingPort }) {
  const base = useAsync(`base:${port.kind}`, async () => {
    const [ctx, services, customers] = await Promise.all([port.context(), port.listServices(), port.listCustomers()]);
    return { ctx, services: services.filter((s) => s.active), customers };
  });
  if (base.error) {
    return (
      <section aria-labelledby="agenda-title">
          <h1 id="agenda-title">Agenda</h1>
        <ErrorPanel error={base.error} operation="load" onRetry={base.reload} />
      </section>
    );
  }
  if (!base.data) {
    return (
      <p role="status" className="tn-sched-loading">
        Carregando agenda…
      </p>
    );
  }
  return (
    <BaseContext.Provider value={base.data}>
      <Outlet />
    </BaseContext.Provider>
  );
}

export function SchedulingLayout() {
  const session = useSession();
  const { state, tenantId, getAccessToken } = session;
  const port = useMemo<SchedulingPort | null>(() => {
    if (state.status === "offline_demo" || !appEnv.supabase) return getDemoPort();
    if (!tenantId) return null;
    const call = createApiClient({
      baseUrl: appEnv.supabase.url,
      publishableKey: appEnv.supabase.publishableKey,
      getAccessToken,
    });
    return createServerPort(call, tenantId);
  }, [state.status, tenantId, getAccessToken]);

  if (!port) return <p>Selecione um negócio para ver a agenda.</p>;
  return (
    <PortContext.Provider value={port}>
      <BaseLoader key={`${port.kind}:${tenantId ?? ""}`} port={port} />
    </PortContext.Provider>
  );
}

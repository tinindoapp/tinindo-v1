// Escopo visível do negócio na sessão (P51; decisões D1 a, D3 b e D4): profissão, plano e quais módulos aparecem.
// O servidor é a fonte (`setup.scope`): 10 módulos do piloto sempre, 6 que o dono liga em Conta › Mais recursos e 11
// guardados. Enquanto o escopo carrega (ou se a leitura falhar) só os módulos do piloto aparecem: nunca um link para
// algo que o negócio não tem. A chave decide o que APARECE; quem autoriza cada operação continua sendo o banco.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type BusinessScope, MODULE_LEVELS, type ModuleId, type ModuleLevel, type Profession, SetupModuleSetOutput, SetupScopeOutput } from "@contracts";
import { appEnv } from "./env.ts";
import type { ModuleDefinition } from "./module-types.ts";
import { demoScope, demoSetModule } from "./scope-demo.ts";
import { useSession } from "./session.tsx";

export interface ScopeApi {
  /** `loading` e `error` mostram só o piloto. */
  status: "loading" | "ready" | "error";
  profession: Profession | null;
  /** Só o nome do plano: no piloto ele não libera nem esconde nada (D3 b). */
  plan: BusinessScope["plan"] | null;
  levelOf(module: ModuleId): ModuleLevel;
  /** O módulo aparece para este negócio agora. */
  isVisible(module: ModuleId): boolean;
  /** Módulo dono de um caminho do app (`/app/<segmento>/…`); null fora dos módulos (Hoje, páginas públicas, links externos). */
  moduleOf(path: string): ModuleId | null;
  /** O caminho pode virar link: fora dos módulos, sempre; dentro, só se o módulo está visível. */
  canOpen(path: string): boolean;
  /** Os módulos registrados com rótulo, destino e estado, na ordem do registro (para a tela "Mais recursos"). */
  catalog: readonly ScopeModule[];
  /** Só o dono liga e desliga recursos. */
  canManage: boolean;
  /** Liga ou desliga um módulo "por ativação". A chave de idempotência vem de quem chama (src/lib/idempotency.ts). */
  setModule(module: ModuleId, enabled: boolean, idempotencyKey: string): Promise<void>;
  reload(): void;
}

export interface ScopeModule {
  id: ModuleId;
  level: ModuleLevel;
  label: string;
  to: string;
  enabled: boolean;
}

const levelOf = (module: ModuleId): ModuleLevel => MODULE_LEVELS[module];

/** Fora do shell (teste de uma tela isolada): nada é escondido, como antes do P51. O app sempre monta o provider. */
const OPEN: ScopeApi = {
  status: "ready",
  profession: null,
  plan: null,
  levelOf,
  isVisible: () => true,
  moduleOf: () => null,
  canOpen: () => true,
  catalog: [],
  canManage: false,
  setModule: () => Promise.reject(new Error("escopo fora do shell")),
  reload: () => undefined,
};

const ScopeContext = createContext<ScopeApi>(OPEN);

/** `/app/agenda/novo?x=1#y` → "agenda". */
function segmentOf(path: string): string | null {
  return /^\/app\/([a-z0-9-]+)/.exec(path)?.[1] ?? null;
}

type Loaded = { tenant: string; scope: BusinessScope | null };

export function ScopeProvider({ modules, children }: { modules: readonly ModuleDefinition[]; children: ReactNode }) {
  const { state, tenantId, api: sessionApi } = useSession();
  const demo = state.status === "offline_demo" || !appEnv.supabase || !sessionApi;
  const role = state.status === "signed_in" || state.status === "offline_demo" ? (state.memberships.find((m) => m.tenant_id === tenantId)?.role ?? null) : null;
  const call = demo ? null : sessionApi;
  // Guardado com o negócio a que pertence: trocar de negócio volta a "carregando" sem mostrar o escopo do anterior.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [demoState, setDemoState] = useState<BusinessScope>(demoScope);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (demo || !call || !tenantId) return;
    let alive = true;
    call("/setup/setup.scope", SetupScopeOutput, { method: "POST", tenantId, body: {} }).then(
      (r) => alive && setLoaded({ tenant: tenantId, scope: r.data }),
      () => alive && setLoaded({ tenant: tenantId, scope: null }),
    );
    return () => {
      alive = false;
    };
  }, [demo, call, tenantId, tick]);

  const current = demo ? null : loaded && loaded.tenant === tenantId ? loaded : null;
  const scope = demo ? demoState : (current?.scope ?? null);
  // Sem negócio selecionado não há o que carregar: fica o piloto (a Conta é do piloto).
  const status: ScopeApi["status"] = demo || !tenantId ? "ready" : current ? (current.scope ? "ready" : "error") : "loading";

  const byPath = useMemo(() => new Map(modules.map((m) => [m.path, m.id])), [modules]);
  const enabled = useMemo(() => new Set(scope?.modules.filter((m) => m.enabled).map((m) => m.module)), [scope]);

  const setModule = useCallback(
    async (module: ModuleId, on: boolean, idempotencyKey: string) => {
      if (demo) {
        setDemoState(demoSetModule(module, on));
        return;
      }
      if (!call || !tenantId) throw new Error("sem negócio selecionado");
      const r = await call("/setup/setup.module_set", SetupModuleSetOutput, { method: "POST", tenantId, body: { module, enabled: on }, idempotencyKey });
      setLoaded({ tenant: tenantId, scope: r.data.scope });
    },
    [demo, call, tenantId],
  );
  const reload = useCallback(() => {
    if (demo) setDemoState(demoScope());
    else {
      setLoaded(null);
      setTick((n) => n + 1);
    }
  }, [demo]);

  const api = useMemo<ScopeApi>(() => {
    const isVisible = (module: ModuleId) => (scope ? enabled.has(module) : levelOf(module) === "pilot");
    const moduleOf = (path: string) => {
      const segment = segmentOf(path);
      return segment ? (byPath.get(segment) ?? null) : null;
    };
    return {
      status,
      profession: scope?.profession ?? null,
      plan: scope?.plan ?? null,
      levelOf,
      isVisible,
      moduleOf,
      canOpen: (path) => {
        const module = moduleOf(path);
        return module === null || isVisible(module);
      },
      catalog: modules.map((m) => ({ id: m.id, level: m.level, label: m.navLabel, to: `/app/${m.path}`, enabled: isVisible(m.id) })),
      canManage: role === "owner",
      setModule,
      reload,
    };
  }, [status, scope, enabled, byPath, modules, role, setModule, reload]);

  return <ScopeContext.Provider value={api}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeApi {
  return useContext(ScopeContext);
}

/** Módulos que aparecem para o negócio, na ordem do registro. */
export function visibleModules(modules: readonly ModuleDefinition[], scope: Pick<ScopeApi, "isVisible">): ModuleDefinition[] {
  return modules.filter((m) => scope.isVisible(m.id));
}

// P32 bloco 1 · uso do app sem dado pessoal. Dois eventos por negócio, gravados em lote pela função `analytics`
// (`usage.record`):
//   screen  · tela aberta: a rota sem id (cleanRoute, a mesma regra do banco), só dentro de /app;
//   command · comando concluído (ok), recusado (4xx, com o código do catálogo) ou com erro (5xx ou sem rede).
// Nunca sai valor, nome, telefone, texto digitado, corpo, query, usuário ou mensagem de erro: o evento é montado só
// com o caminho da chamada, o status e o código. O banco confere o vocabulário de novo (check e filtro na RPC).
// Captura: no ponto único de chamada (`instrument`, usado por `useApi()` em src/app/api.tsx) e na navegação
// (`watchNavigation`, que observa o history do navegador; o roteador usa o history). Na demonstração, nada sai.
import { z } from "zod";
import { ApiError, type CallOptions } from "../api/client.ts";
import type { ApiCall } from "../api/session-client.ts";
import { now } from "../time.ts";
import { cleanRoute } from "./index.ts";

export type UsageOutcome = "ok" | "refused" | "error";
export interface UsageEvent {
  kind: "screen" | "command";
  name: string;
  outcome: UsageOutcome | null;
  code: string | null;
  at: string;
}

export const USAGE_RECORD_PATH = "/analytics/usage.record";
const SCREEN = /^\/app(\/[a-z0-9:._-]{1,40})*$/;
const COMMAND = /^[a-z][a-z0-9-]{0,40}\/[a-z][a-z0-9_]{0,40}\.[a-z][a-z0-9_]{0,40}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,39}$/;

/**
 * Vocabulário fechado das telas: os trechos fixos das rotas dos módulos (module.tsx, router.tsx). Qualquer outro trecho
 * (id, slug, nome que alguém digitou num endereço) vira ":id". O teste `usage.test.ts` confere que toda rota nova entra
 * aqui; se faltar, a tela aparece com ":id" no lugar do trecho, nunca com o texto.
 */
export const SCREEN_SEGMENTS: ReadonlySet<string> = new Set([
  "agenda","app","assinaturas","assistente","atendimento","avaliacoes","avaliar","caixa","campanhas","clientes","configurar","conta","contas","convite","criar-conta","custo","diretorio","domicilio","entrar","equipe","horarios","importar","indicacoes","indicar","lista-de-espera","materiais","mensagens","metas","notas","nova-senha","novo","novo-negocio","oferta","operacao","orcamento","orcamentos","p","pagamentos","pagar","perfil","precos","previa","privacidade","reagendar","recuperar-senha","recursos","relacionamento","reserva","reservas","resultado","retorno","s","saude","servicos","servicos-tinindo","simulador","site","vincular", "piloto",
]);

/** Tela: só rotas do app (/app…), com cada trecho do vocabulário fechado ou ":id". Fora de /app, null. */
export function screenName(pathname: string | null | undefined): string | null {
  const route = cleanRoute(pathname);
  if (!route || !route.startsWith("/app")) return null;
  const closed = route.split("/").map((s, i) => (i === 0 || s === ":id" || SCREEN_SEGMENTS.has(s) ? s : ":id")).join("/");
  return SCREEN.test(closed) && closed.length <= 160 ? closed : null;
}

/** Comando: "<função>/<operação>" a partir do caminho da chamada; query, id ou qualquer outra coisa → null. */
export function commandName(path: string): string | null {
  const clean = (path.split("?")[0] ?? "").split("#")[0]!.replace(/^\/+/, "").toLowerCase();
  return COMMAND.test(clean) ? clean : null;
}

/** Resultado do comando pelo erro: 4xx é recusa (com o código), o resto é erro. A mensagem nunca sai. */
export function outcomeOf(err: unknown): { outcome: UsageOutcome; code: string | null } {
  if (err instanceof ApiError) {
    const code = CODE.test(err.code) ? err.code : null;
    return { outcome: err.status >= 400 && err.status < 500 ? "refused" : "error", code };
  }
  return { outcome: "error", code: "NETWORK" };
}

const RecordOutput = z.object({ recorded: z.int().min(0), enabled: z.boolean() }).passthrough();
export type UsageSend = (batch: { batch_id: string; events: UsageEvent[] }) => Promise<{ enabled: boolean }>;

export interface UsageRecorderOptions {
  send: UsageSend;
  /** Lote: envia ao juntar `maxBatch` (padrão 20, teto 50) ou a cada `flushMs` (padrão 15 s). */
  maxBatch?: number;
  flushMs?: number;
  /** Teto por carregamento de página (padrão 600). */
  maxPerPage?: number;
  newId?: () => string;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export interface UsageRecorder {
  screen(pathname: string): void;
  command(path: string, result: { outcome: UsageOutcome; code: string | null }): void;
  flush(): Promise<void>;
  /** O servidor respondeu que o negócio desligou a medição: para de juntar até recarregar. */
  readonly enabled: boolean;
  readonly pending: number;
}

export function createUsageRecorder(opts: UsageRecorderOptions): UsageRecorder {
  const maxBatch = Math.min(Math.max(opts.maxBatch ?? 20, 1), 50);
  const flushMs = opts.flushMs ?? 15_000;
  const maxPerPage = opts.maxPerPage ?? 600;
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let queue: UsageEvent[] = [];
  let taken = 0;
  let enabled = true;
  let timer: unknown = null;
  let lastScreen: string | null = null;

  const push = (e: Omit<UsageEvent, "at">) => {
    if (!enabled || taken >= maxPerPage) return;
    taken += 1;
    queue.push({ ...e, at: now().toISOString() });
    if (queue.length >= maxBatch) void flush();
    else if (timer === null) timer = schedule(() => { timer = null; void flush(); }, flushMs);
  };

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const events = queue.splice(0, 50);
    try {
      const r = await opts.send({ batch_id: newId(), events });
      if (!r.enabled) {
        enabled = false;
        queue = [];
      }
    } catch {
      // Medir nunca vira erro na tela; o lote perdido não volta (sem fila no aparelho).
    }
    if (queue.length) await flush();
  }

  return {
    screen(pathname) {
      const name = screenName(pathname);
      if (!name || name === lastScreen) return;
      lastScreen = name;
      push({ kind: "screen", name, outcome: null, code: null });
    },
    command(path, result) {
      const name = commandName(path);
      if (!name) return;
      push({ kind: "command", name, outcome: result.outcome, code: result.outcome === "ok" ? null : result.code });
    },
    flush,
    get enabled() {
      return enabled;
    },
    get pending() {
      return queue.length;
    },
  };
}

/** Envio pela própria sessão (JWT do dono), pela função `analytics`. */
export function sessionUsageSend(call: ApiCall, tenantId: string): UsageSend {
  return async (batch) => {
    const { data } = await call(USAGE_RECORD_PATH, RecordOutput, { method: "POST", tenantId, body: batch });
    return { enabled: data.enabled };
  };
}

/**
 * O cliente da sessão, medindo os comandos. Comando = chamada com chave de idempotência (todo comando do registro
 * tem; leitura não tem). O evento vai para o gravador do negócio da chamada. O resultado e o erro voltam iguais.
 */
export function instrument(call: ApiCall, recorderFor: UsageRecorder | ((tenantId: string) => UsageRecorder | null)): ApiCall {
  const pick = typeof recorderFor === "function" ? recorderFor : () => recorderFor;
  const wrapped = (async (path: string, schema: z.ZodType, options: CallOptions = {}) => {
    const recorder = options.idempotencyKey && options.tenantId && !path.startsWith(USAGE_RECORD_PATH) ? pick(options.tenantId) : null;
    if (!recorder) return call(path, schema, options);
    try {
      const out = await call(path, schema, options);
      recorder.command(path, { outcome: "ok", code: null });
      return out;
    } catch (err) {
      recorder.command(path, outcomeOf(err));
      throw err;
    }
  }) as ApiCall;
  return wrapped;
}

// ---------------------------------------------------------------------------------------------------------------------
// Uma medição por aba e por sessão: um só cliente medido (a regra do P53 de um cliente por sessão continua), um
// gravador por negócio, e as telas vão para o negócio escolhido agora. Trocar de negócio envia o que estava juntado.

interface Session {
  call: ApiCall;
  wrapped: ApiCall;
  recorders: Map<string, UsageRecorder>;
  current: string | null;
}
let session: Session | null = null;
let unwatch: (() => void) | null = null;
let factory: (call: ApiCall, tenantId: string) => UsageRecorder = (call, tenantId) =>
  createUsageRecorder({ send: sessionUsageSend(call, tenantId) });

function recorderOf(s: Session, tenantId: string): UsageRecorder {
  let r = s.recorders.get(tenantId);
  if (!r) {
    r = factory(s.call, tenantId);
    s.recorders.set(tenantId, r);
  }
  return r;
}

/** O cliente medido da sessão (o mesmo objeto enquanto a sessão não muda). Sem negócio, as telas não são medidas. */
export function usageCall(call: ApiCall, tenantId: string | null): ApiCall {
  if (!session || session.call !== call) {
    if (session) for (const r of session.recorders.values()) void r.flush();
    const s: Session = { call, wrapped: call, recorders: new Map(), current: null };
    s.wrapped = instrument(call, (t) => recorderOf(s, t));
    session = s;
  }
  const s = session;
  if (tenantId !== s.current) {
    if (s.current) void s.recorders.get(s.current)?.flush();
    s.current = tenantId;
    if (tenantId && typeof window !== "undefined") {
      unwatch ??= watchNavigation(window, (path) => {
        const cur = session?.current;
        if (session && cur) recorderOf(session, cur).screen(path);
      });
      recorderOf(s, tenantId).screen(window.location.pathname);
    }
  }
  return s.wrapped;
}

/**
 * Observa a navegação do app: pushState/replaceState (o roteador usa) e popstate (voltar). Ao esconder a aba, envia o
 * lote juntado. Devolve a função que desfaz.
 */
export function watchNavigation(win: Window, onPath: (pathname: string) => void): () => void {
  const history = win.history;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  const emit = () => onPath(win.location.pathname);
  history.pushState = (...args: Parameters<History["pushState"]>) => { push(...args); emit(); };
  history.replaceState = (...args: Parameters<History["replaceState"]>) => { replace(...args); emit(); };
  const onHide = () => {
    if (win.document.visibilityState === "hidden") for (const r of session?.recorders.values() ?? []) void r.flush();
  };
  win.addEventListener("popstate", emit);
  win.document.addEventListener("visibilitychange", onHide);
  return () => {
    history.pushState = push;
    history.replaceState = replace;
    win.removeEventListener("popstate", emit);
    win.document.removeEventListener("visibilitychange", onHide);
  };
}

/** Só para testes: troca a fábrica do gravador e zera a medição da aba. */
export function resetUsageForTests(make?: typeof factory): void {
  unwatch?.();
  unwatch = null;
  session = null;
  if (make) factory = make;
}

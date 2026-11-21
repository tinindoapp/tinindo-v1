// Sem internet (P34, item 2): a Hoje e a Agenda do dia abrem com a última resposta que este aparelho recebeu, com um
// aviso claro. Nada é gravado sem conexão e nada fica em fila escondida: o comando sem rede recebe na hora o erro
// "Sem conexão: nada foi salvo", como qualquer falha de rede.
//
// O que fica guardado, e com que chave:
// - Só as LEITURAS da lista abaixo (as da Hoje e da Agenda). Comandos nunca.
// - Chave = pessoa (o `sub` do login) + negócio (cabeçalho X-Tinindo-Tenant) + endereço + corpo do pedido. Outro negócio,
//   outra pessoa ou outra janela da agenda nunca recebem esta resposta.
// - Sem login (página pública), nada é guardado.
// - Validade de 24 h: depois disso, a resposta guardada não é mostrada e sai do aparelho.
// - Ao entrar outra pessoa neste aparelho, o que era da anterior sai.
// - Ao sair da conta, a página pede para limpar tudo (register.ts).

export const OFFLINE_CACHE = "tinindo-offline-v1";
export const OFFLINE_MAX_AGE_MS = 24 * 3_600_000;
export const SAVED_AT_HEADER = "X-Tinindo-Saved-At";
export const OFFLINE_AT_HEADER = "X-Tinindo-Offline-At";
const TENANT_HEADER = "x-tinindo-tenant";
const REQUEST_ID_HEADER = "x-request-id";

/** Leituras da Hoje e da Agenda do dia (caminho depois de /functions/v1). GET de consulta, POST das leituras por RPC. */
const OFFLINE_READS: { method: "GET" | "POST"; path: RegExp }[] = [
  { method: "GET", path: /^\/context$/ },
  { method: "GET", path: /^\/crm\/(services|customers)$/ },
  { method: "POST", path: /^\/scheduling\/(booking\.list|booking\.get|schedule\.settings|schedule\.day_plans|availability\.list)$/ },
  { method: "POST", path: /^\/finance\/(finance\.summary|finance\.uncharged)$/ },
  { method: "POST", path: /^\/growth-advice\/insight\.list$/ },
  { method: "POST", path: /^\/setup\/setup\.progress$/ },
  { method: "POST", path: /^\/waitlist\/waitlist\.list$/ },
];

/** Caminho depois de /functions/v1, ou null se não for uma Edge Function. */
export function functionPath(url: string): string | null {
  try {
    const u = new URL(url);
    const i = u.pathname.indexOf("/functions/v1/");
    return i < 0 ? null : u.pathname.slice(i + "/functions/v1".length);
  } catch {
    return null;
  }
}

export function isOfflineRead(method: string, url: string): boolean {
  const path = functionPath(url);
  return path !== null && OFFLINE_READS.some((r) => r.method === method && r.path.test(path));
}

/** `sub` do JWT (sem conferir assinatura: só serve para separar as pessoas no cache; quem autoriza é o servidor). */
export function subOfBearer(authorization: string | null): string | null {
  const m = /^Bearer\s+([^.]+)\.([^.]+)\./.exec(authorization ?? "");
  if (!m) return null;
  try {
    const json = atob(m[2]!.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(m[2]!.length / 4) * 4, "="));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Endereço sintético da resposta guardada: /__offline__/<pessoa>/<pedido>. A pessoa no caminho permite apagar por pessoa. */
export async function offlineKeyUrl(origin: string, parts: { sub: string; tenant: string | null; method: string; url: string; body: string }): Promise<string> {
  // Sem a query `apikey` nem cabeçalhos voláteis (request id): o mesmo pedido de leitura dá a mesma chave.
  const person = (await sha256(`pessoa:${parts.sub}`)).slice(0, 32);
  const request = await sha256(JSON.stringify([parts.tenant ?? "", parts.method, parts.url, parts.body]));
  return `${origin}/__offline__/${person}/${request}`;
}

export const personPrefix = (keyUrl: string) => keyUrl.slice(0, keyUrl.lastIndexOf("/") + 1);

/** Resposta de erro no envelope v1, para a tela mostrar a mensagem de sempre. */
export function offlineError(requestId: string | null, kind: "write" | "read"): Response {
  const message = kind === "write"
    ? "Sem conexão: nada foi salvo. Tente de novo quando a internet voltar."
    : "Sem conexão, e este aparelho ainda não tem estes dados guardados.";
  // O cliente da API sempre manda X-Request-Id; sem ele (chamada de fora do app), o id nulo do formato.
  const id = requestId && /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : "00000000-0000-4000-8000-000000000000";
  return new Response(JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message, retryable: true }, request_id: id }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export interface OfflineDeps {
  fetch: typeof fetch;
  caches: CacheStorage;
  origin: string;
  now(): number;
  /** Avisa a tela que mostrou dados guardados (hora em que foram guardados) ou que voltou a receber da rede. */
  notify(msg: { type: "tinindo:offline-data"; savedAt: string } | { type: "tinindo:online-data" }): void;
}

/** Trata uma chamada às Edge Functions: leitura da lista com a última resposta guardada; o resto, só a rede. */
export async function handleApi(req: Request, deps: OfflineDeps): Promise<Response> {
  const requestId = req.headers.get(REQUEST_ID_HEADER);
  if (!isOfflineRead(req.method, req.url)) {
    // Comando (ou leitura fora da lista): só a rede. Sem rede, erro na hora; nunca fila.
    try {
      return await deps.fetch(req);
    } catch {
      return offlineError(requestId, req.method === "GET" ? "read" : "write");
    }
  }
  const sub = subOfBearer(req.headers.get("authorization"));
  const body = req.method === "GET" ? "" : await req.clone().text();
  const key = sub
    ? await offlineKeyUrl(deps.origin, { sub, tenant: req.headers.get(TENANT_HEADER), method: req.method, url: stripApiKey(req.url), body })
    : null;
  let res: Response;
  try {
    res = await deps.fetch(req);
  } catch {
    return key ? (await fromOffline(key, deps)) ?? offlineError(requestId, "read") : offlineError(requestId, "read");
  }
  if (key && res.ok) {
    const copy = res.clone();
    const headers = new Headers(copy.headers);
    headers.set(SAVED_AT_HEADER, new Date(deps.now()).toISOString());
    const stored = new Response(await copy.arrayBuffer(), { status: copy.status, statusText: copy.statusText, headers });
    const cache = await deps.caches.open(OFFLINE_CACHE);
    await cache.put(key, stored);
    // Outra pessoa entrou neste aparelho: o que era da anterior sai.
    const mine = personPrefix(key);
    for (const k of await cache.keys()) if (!k.url.startsWith(mine)) await cache.delete(k);
    deps.notify({ type: "tinindo:online-data" });
  }
  return res;
}

async function fromOffline(key: string, deps: OfflineDeps): Promise<Response | null> {
  const cache = await deps.caches.open(OFFLINE_CACHE);
  const hit = await cache.match(key);
  if (!hit) return null;
  const savedAt = hit.headers.get(SAVED_AT_HEADER);
  const at = savedAt ? Date.parse(savedAt) : NaN;
  if (!Number.isFinite(at) || deps.now() - at > OFFLINE_MAX_AGE_MS) {
    await cache.delete(key);
    return null;
  }
  const headers = new Headers(hit.headers);
  headers.set(OFFLINE_AT_HEADER, savedAt!);
  deps.notify({ type: "tinindo:offline-data", savedAt: savedAt! });
  return new Response(await hit.arrayBuffer(), { status: hit.status, statusText: hit.statusText, headers });
}

/** A chave pública (apikey) pode vir na query; não muda a resposta e não entra na chave. */
function stripApiKey(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("apikey");
    return u.toString();
  } catch {
    return url;
  }
}

/** Apaga tudo o que foi guardado para uso sem internet (ao sair da conta). */
export async function clearOffline(caches: CacheStorage): Promise<void> {
  await caches.delete(OFFLINE_CACHE);
}

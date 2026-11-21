// Service worker do app instalável (P34). Montado pelo plugin `tinindoServiceWorker` do vite.config.ts em dist/sw.js,
// com a versão e a lista de arquivos do build trocadas em __SW_VERSION__ e __PRECACHE__. As regras estão em
// sw-logic.ts (testadas sem navegador); aqui só ficam os eventos.
//
// Atualização segura: a versão nova baixa tudo e só então assume (a anterior fica guardada para a aba aberta). A página
// mostra "Nova versão disponível"; "Atualizar" recarrega no código novo. Sem o toque, a próxima abertura já é a nova:
// ninguém fica preso numa versão velha, e ninguém perde o que está digitando por uma troca no meio.
import { cacheNames, cachesToDelete, classify, SW_MESSAGE } from "./sw-logic.ts";
import { clearOffline, handleApi } from "./sw-offline.ts";

declare const __SW_VERSION__: string;
declare const __PRECACHE__: string[];

// Tipos mínimos do escopo do service worker (o tsconfig do app usa a lib DOM, que não tem estes).
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  clientId: string;
  respondWith(r: Response | Promise<Response>): void;
}
interface MessageEventLike extends ExtendableEvent {
  data: unknown;
}
interface SwScope {
  location: Location;
  clients: { claim(): Promise<void>; get(id: string): Promise<{ postMessage(m: unknown): void } | undefined> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", fn: (e: FetchEvent) => void): void;
  addEventListener(type: "message", fn: (e: MessageEventLike) => void): void;
}

const sw = self as unknown as SwScope;
const VERSION = __SW_VERSION__;
const PRECACHE = new Set(__PRECACHE__);
const { shell: SHELL } = cacheNames(VERSION);

sw.addEventListener("install", (event) => {
  // Assume assim que guardou tudo. Isso é seguro porque este service worker não guarda estado da tela: só serve arquivos.
  // A aba aberta continua com o código dela, e os pedaços que ela ainda não abriu vêm do cache da versão anterior,
  // que fica guardado (cachesToDelete). Se a instalação falhar, a versão em uso continua.
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll([...PRECACHE].map((p) => new Request(p, { cache: "reload" }))))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(cachesToDelete(keys, SHELL).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === SW_MESSAGE.skipWaiting) event.waitUntil(sw.skipWaiting());
  if (data?.type === SW_MESSAGE.clearOffline) event.waitUntil(clearOffline(caches));
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  const kind = classify({ url: req.url, method: req.method, mode: req.mode, origin: sw.location.origin }, PRECACHE);
  if (kind === "navigation") event.respondWith(navigation(req));
  else if (kind === "asset" || kind === "precached") event.respondWith(fromCache(req));
  else if (kind === "api") {
    // Item 2 (sem internet): leituras da Hoje e da Agenda com a última resposta; comandos só pela rede, nunca em fila.
    const clientId = event.clientId;
    event.respondWith(handleApi(req, {
      fetch: (r) => fetch(r),
      caches,
      origin: sw.location.origin,
      now: () => Date.now(),
      notify: (msg) => {
        if (clientId) void sw.clients.get(clientId).then((c) => c?.postMessage(msg));
      },
    }));
  }
  // "passthrough": a rede, sem passar por aqui.
});

/** Rede primeiro (a tela sempre abre na versão no ar); sem rede, a casca guardada. */
async function navigation(req: Request): Promise<Response> {
  try {
    return await fetch(req);
  } catch {
    const cached = (await caches.match("/index.html", { cacheName: SHELL })) ?? (await caches.match("/index.html"));
    return cached ?? Response.error();
  }
}

/** Arquivo com hash: o mesmo nome é sempre o mesmo conteúdo. Procura em todos os caches do app (versão anterior incluída). */
async function fromCache(req: Request): Promise<Response> {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && new URL(req.url).pathname.startsWith("/assets/")) {
    const copy = res.clone();
    void caches.open(SHELL).then((c) => c.put(req, copy));
  }
  return res;
}

// Gateway de teste da jornada com gravação real (P59): fala o que o navegador espera de um projeto Supabase e
// entrega cada pedido aos handlers de PRODUÇÃO montados em tests/integration/harness.ts, sobre um Postgres local.
//   /auth/v1/*       login simulado dos usuários do seed (senha conferida no banco; JWT HS256 com segredo de teste)
//   /rest/v1/*       só o que a jornada lê (vínculos, negócio e my_is_operator), com o papel `authenticated` e RLS
//   /functions/v1/*  o Request segue para o handler do harness; o `sub` do JWT vira o "token" que o harness espera
// Não é o Supabase: GoTrue, PostgREST, runtime Deno e CORS de produção ficam de fora (ver README.md desta pasta).
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handlers, pool, rpc, runDispatch } from "../../integration/harness.ts";

// Segredo montado em tempo de execução (baixa entropia no fonte: a varredura de segredos não o confunde com vazamento).
const JWT_SECRET = "segredo-jwt-da-jornada-".repeat(2);
const ACCESS_TTL_S = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Claims { sub: string; email: string; role: string; aud: string; exp: number; iat: number; uso: "acesso" | "renovacao" }
interface AuthUser { id: string; email: string }

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const sign = (data: string) => createHmac("sha256", JWT_SECRET).update(data).digest();

function issue(user: AuthUser, uso: Claims["uso"], ttl: number): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: Claims = { sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + ttl, uso };
  const head = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  return `${head}.${b64url(sign(head))}`;
}

function verify(token: string, uso: Claims["uso"]): Claims | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const expected = sign(`${h}.${p}`);
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as Claims;
    return claims.uso === uso && UUID.test(claims.sub) && claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}

function session(user: AuthUser) {
  const now = new Date().toISOString();
  return {
    access_token: issue(user, "acesso", ACCESS_TTL_S),
    token_type: "bearer",
    expires_in: ACCESS_TTL_S,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_S,
    refresh_token: issue(user, "renovacao", 7 * 24 * 3600),
    user: userJson(user, now),
  };
}

function userJson(user: AuthUser, now = new Date().toISOString()) {
  return {
    id: user.id, aud: "authenticated", role: "authenticated", email: user.email, email_confirmed_at: now, phone: "",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: now, updated_at: now,
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const authError = (status: number, code: string, msg: string) => json(status, { code: status, error_code: code, msg });

/** Quem fala: o `sub` do JWT de acesso. Chave pública no lugar do token (como o supabase-js manda sem login) = anônimo. */
function actorOf(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? verify(auth.slice(7).trim(), "acesso")?.sub ?? null : null;
}

async function auth(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (path === "/token" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      // A senha do seed é conferida no banco (crypt), como o GoTrue faria com auth.users.
      const { rows } = await pool.query<AuthUser>(
        "select id::text as id, email::text as email from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)",
        [String(body.email ?? ""), String(body.password ?? "")]);
      return rows[0] ? json(200, session(rows[0])) : authError(400, "invalid_credentials", "Invalid login credentials");
    }
    if (grant === "refresh_token") {
      const claims = verify(String(body.refresh_token ?? ""), "renovacao");
      return claims ? json(200, session({ id: claims.sub, email: claims.email })) : authError(400, "refresh_token_not_found", "Invalid Refresh Token");
    }
    return authError(400, "unsupported_grant_type", "grant_type não coberto pelo gateway de teste");
  }
  if (path === "/user" && req.method === "GET") {
    const auth = req.headers.get("Authorization") ?? "";
    const claims = verify(auth.replace(/^Bearer\s+/, ""), "acesso");
    return claims ? json(200, userJson({ id: claims.sub, email: claims.email })) : authError(401, "bad_jwt", "invalid JWT");
  }
  if (path === "/logout" && req.method === "POST") return new Response(null, { status: 204 });
  return authError(501, "not_implemented", `gateway de teste não cobre ${req.method} /auth/v1${path}`);
}

/** Leitura com o papel `authenticated` e os claims do usuário, como o PostgREST: a RLS decide o que volta. */
async function readAs<T extends Record<string, unknown>>(actor: string | null, text: string, values: unknown[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    if (actor === null) {
      await client.query("set local role anon");
    } else {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actor, role: "authenticated" })]);
      await client.query("set local role authenticated");
    }
    const { rows } = await client.query<T>(text, values);
    await client.query("commit");
    return rows;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const MEMBERSHIPS_SELECT = "tenant_id,role,tenants(name)";
const TENANT_COLUMNS = ["name", "profession"];

async function rest(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/rest\/v1/, "");
  const actor = actorOf(req);
  const q = url.searchParams;
  // src/app/session.tsx · loadMemberships: os vínculos ativos do usuário com o nome do negócio.
  if (path === "/tenant_memberships" && req.method === "GET") {
    const userId = /^eq\.(.+)$/.exec(q.get("user_id") ?? "")?.[1];
    const limit = Number(q.get("limit") ?? "50");
    const known = [...q.keys()].every((k) => ["select", "user_id", "active", "limit"].includes(k));
    if (!known || q.get("select")?.replace(/\s/g, "") !== MEMBERSHIPS_SELECT || !userId || !UUID.test(userId) || q.get("active") !== "eq.true" || !(limit >= 1 && limit <= 1000)) {
      return notCovered(req, url);
    }
    const rows = await readAs(actor,
      `select m.tenant_id, m.role, (select jsonb_build_object('name', t.name) from public.tenants t where t.id = m.tenant_id) as tenants
       from public.tenant_memberships m where m.user_id = $1 and m.active = true limit $2`, [userId, limit]);
    return json(200, rows);
  }
  // src/features/crm/module.tsx (lista de Clientes): nome e profissão do negócio selecionado, por id.
  if (path === "/tenants" && req.method === "GET") {
    const id = /^eq\.(.+)$/.exec(q.get("id") ?? "")?.[1];
    const cols = (q.get("select") ?? "").split(",").map((c) => c.trim());
    const known = [...q.keys()].every((k) => ["select", "id"].includes(k));
    if (!known || !id || !UUID.test(id) || cols.length === 0 || !cols.every((c) => TENANT_COLUMNS.includes(c))) return notCovered(req, url);
    // Colunas vêm da lista fechada acima (nunca do texto do pedido).
    return json(200, await readAs(actor, `select ${cols.join(", ")} from public.tenants where id = $1`, [id]));
  }
  // src/app/session.tsx · loadIsOperator.
  if (path === "/rpc/my_is_operator" && req.method === "POST") {
    const r = await rpc(actor, "my_is_operator", {});
    return r.error ? json(400, { code: r.error.code, message: r.error.message, details: null, hint: r.error.hint }) : json(200, r.data);
  }
  return notCovered(req, url);
}

/** Falha alta: o que a jornada não cobre responde 501 no formato de erro do PostgREST e sai no log do gateway. */
function notCovered(req: Request, url: URL): Response {
  const message = `gateway de teste não cobre ${req.method} ${url.pathname}${url.search}`;
  return json(501, { code: "GATEWAY_501", message, details: "tests/e2e/servidor/gateway.ts cobre só o que a jornada chama", hint: null });
}

async function functions(req: Request, url: URL): Promise<Response> {
  const [, , , module] = url.pathname.split("/");
  const handler = module ? handlers[module] : undefined;
  if (!handler) return json(404, { message: `função ${module ?? ""} não existe no harness` });
  const headers = new Headers(req.headers);
  headers.delete("Authorization");
  // O harness usa o id do usuário como token; aqui ele sai do JWT conferido, nunca do que o navegador afirmar.
  const actor = actorOf(req);
  if (actor) headers.set("Authorization", `Bearer ${actor}`);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  return handler(new Request(url, { method: req.method, headers, body }));
}

export interface GatewayOptions {
  port: number;
  allowedOrigins: string[];
  /**
   * Imita o cron do `messaging/channel.dispatch` (1 min na homologação): sem ele, nada sai do canal simulado (código de
   * verificação do número, código da reserva pelo link). Omitido ou 0 = desligado, como na jornada do P59.
   */
  dispatchEveryMs?: number;
}

/** Rodadas do despacho em série (nunca duas ao mesmo tempo), como o cron chamaria a função. */
function startDispatchLoop(everyMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const r = await runDispatch();
      if (r.sent || r.failed || r.unknown) console.log(`[gateway] despacho: ${r.sent} enviada(s), ${r.failed} falha(s), ${r.unknown} desconhecida(s)`);
    } catch (e) {
      console.error("[gateway] erro no despacho do canal:", e);
    }
    if (!stopped) timer = setTimeout(() => void tick(), everyMs);
  };
  timer = setTimeout(() => void tick(), everyMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function cors(req: IncomingMessage, allowed: string[]): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "authorization, content-type, apikey",
    "Access-Control-Expose-Headers": "X-Request-Id, Content-Range",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function toRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
}

async function send(res: ServerResponse, out: Response, extra: Record<string, string>) {
  const headers: Record<string, string> = {};
  out.headers.forEach((v, k) => {
    // O CORS desta jornada é o do gateway (os handlers do harness não liberam origem nenhuma).
    if (!k.toLowerCase().startsWith("access-control-")) headers[k] = v;
  });
  res.writeHead(out.status, { ...headers, ...extra });
  res.end(out.body ? Buffer.from(await out.arrayBuffer()) : undefined);
}

export function startGateway(opts: GatewayOptions): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const allow = cors(req, opts.allowedOrigins);
    void (async () => {
      try {
        if (req.method === "OPTIONS") return await send(res, new Response(null, { status: 204 }), allow);
        if (url.pathname === "/__saude") {
          await pool.query("select 1");
          return await send(res, json(200, { ok: true }), allow);
        }
        const request = await toRequest(req, url);
        const out = url.pathname.startsWith("/auth/v1/") ? await auth(request, url)
          : url.pathname.startsWith("/rest/v1/") ? await rest(request, url)
          : url.pathname.startsWith("/functions/v1/") ? await functions(request, url)
          : json(404, { message: `gateway de teste: caminho desconhecido ${url.pathname}` });
        if (out.status >= 400) console.error(`[gateway] ${out.status} ${req.method} ${url.pathname}${url.search}`);
        await send(res, out, allow);
      } catch (e) {
        console.error(`[gateway] erro em ${req.method} ${url.pathname}:`, e);
        if (!res.headersSent) await send(res, json(500, { message: "erro no gateway de teste" }), allow);
        else res.end();
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      if (opts.dispatchEveryMs && opts.dispatchEveryMs > 0) server.once("close", startDispatchLoop(opts.dispatchEveryMs));
      resolve(server);
    });
  });
}

// Gateway de teste da jornada com gravação real (P59): fala o que o navegador espera de um projeto Supabase e
// entrega cada pedido aos handlers de PRODUÇÃO montados em tests/integration/harness.ts, sobre um Postgres local.
//   /auth/v1/*       login simulado dos usuários do seed (senha conferida no banco; JWT HS256 com segredo de teste)
//   /rest/v1/*       só o que a jornada lê (vínculos, negócio e my_is_operator), com o papel `authenticated` e RLS
//   /functions/v1/*  o Request segue para o handler do harness; o `sub` do JWT vira o "token" que o harness espera
// Não é o Supabase: GoTrue, PostgREST, runtime Deno e CORS de produção ficam de fora (ver README.md desta pasta).
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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

/**
 * Cadastro: imita o `/auth/v1/signup` do GoTrue nos dois modos da homologação.
 * - Confirmação DESLIGADA (o caso de hoje, "autoconfirm"): grava em auth.users já confirmado e devolve a sessão.
 *   E-mail repetido: 422 `user_already_exists`.
 * - Confirmação LIGADA: grava sem confirmar, devolve só o usuário (sem sessão) e "manda" o link de confirmação para a
 *   caixa simulada (`/__teste/correio`). E-mail repetido: usuário falso, sem dizer que existe (como o GoTrue).
 * O modo é trocado pela própria spec em `/__teste/confirmacao` (só existe neste gateway de teste).
 */
const signupMode = { confirmEmail: false };
/** Caixa de e-mail simulada: e-mail → links de confirmação enviados, do mais antigo ao mais novo. */
const mailbox = new Map<string, string[]>();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Mínimo do GoTrue padrão (o app pede 8, com letras e números, antes de chamar). */
const MIN_PASSWORD = 6;

async function signup(req: Request, url: URL): Promise<Response> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!EMAIL_RE.test(email)) return authError(400, "email_address_invalid", "Unable to validate email address: invalid format");
  if (password.length < MIN_PASSWORD) {
    return json(422, { code: 422, error_code: "weak_password", msg: `Password should be at least ${MIN_PASSWORD} characters.`, weak_password: { reasons: ["length"] } });
  }
  const confirm = signupMode.confirmEmail;
  const token = randomBytes(24).toString("hex");
  const client = await pool.connect();
  let user: AuthUser | null;
  try {
    await client.query("begin");
    const { rows } = await client.query<AuthUser>(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                               raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                               confirmation_token, recovery_token, email_change_token_new, email_change)
       select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1::text,
              extensions.crypt($2::text, extensions.gen_salt('bf')), case when $3::boolean then null else now() end,
              '{"provider":"email","providers":["email"]}', $4::jsonb, now(), now(),
              case when $3::boolean then $5::text else '' end, '', '', ''
       where not exists (select 1 from auth.users where lower(email) = $1::text)
       returning id::text as id, email::text as email`,
      [email, password, confirm, JSON.stringify(body.data ?? {}), token]);
    user = rows[0] ?? null;
    if (user) {
      await client.query(
        `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, $1::text,
                 jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', not $3::boolean), 'email', now(), now(), now())`,
        [user.id, email, confirm]);
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  if (!confirm) return user ? json(200, session(user)) : authError(422, "user_already_exists", "User already registered");
  const pending = (u: AuthUser) => ({ ...userJson(u), email_confirmed_at: null, confirmation_sent_at: new Date().toISOString() });
  // E-mail já cadastrado com confirmação ligada: usuário falso e nenhum e-mail sai.
  if (!user) return json(200, pending({ id: randomUUID(), email }));
  const link = new URL(`${url.origin}/auth/v1/verify`);
  link.searchParams.set("token", token);
  link.searchParams.set("type", "signup");
  const redirect = url.searchParams.get("redirect_to");
  if (redirect) link.searchParams.set("redirect_to", redirect);
  mailbox.set(email, [...(mailbox.get(email) ?? []), link.toString()]);
  return json(200, pending(user));
}

/**
 * Link do e-mail de confirmação, como o GoTrue no fluxo implícito: confirma, abre a sessão e volta ao app com os
 * tokens no fragmento (o supabase-js lê com detectSessionInUrl). redirect_to só para uma origem liberada.
 */
async function confirmEmail(url: URL, allowedOrigins: string[]): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  let target: URL | null;
  try {
    const t = new URL(url.searchParams.get("redirect_to") ?? "");
    target = allowedOrigins.includes(t.origin) ? t : null;
  } catch {
    target = null;
  }
  if (url.searchParams.get("type") !== "signup" || !token || !target) return authError(400, "validation_failed", "link de confirmação inválido");
  const { rows } = await pool.query<AuthUser>(
    `update auth.users set email_confirmed_at = now(), confirmation_token = '', updated_at = now()
     where confirmation_token = $1 and email_confirmed_at is null returning id::text as id, email::text as email`, [token]);
  const user = rows[0];
  if (!user) {
    target.hash = new URLSearchParams({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" }).toString();
  } else {
    const s = session(user);
    target.hash = new URLSearchParams({
      access_token: s.access_token, expires_at: String(s.expires_at), expires_in: String(s.expires_in),
      refresh_token: s.refresh_token, token_type: "bearer", type: "signup",
    }).toString();
  }
  return new Response(null, { status: 303, headers: { Location: target.toString() } });
}

/** Controles que só a spec usa: modo do cadastro e caixa de e-mail simulada. Não existem num Supabase de verdade. */
async function testControl(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/__teste/confirmacao" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { ligada?: unknown };
    if (typeof body.ligada !== "boolean") return json(400, { message: "ligada: true ou false" });
    signupMode.confirmEmail = body.ligada;
    return json(200, { ligada: signupMode.confirmEmail });
  }
  if (url.pathname === "/__teste/correio" && req.method === "GET") {
    return json(200, { links: mailbox.get((url.searchParams.get("para") ?? "").toLowerCase()) ?? [] });
  }
  return json(404, { message: `controle de teste desconhecido ${req.method} ${url.pathname}` });
}

async function auth(req: Request, url: URL, allowedOrigins: string[]): Promise<Response> {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (path === "/signup" && req.method === "POST") return signup(req, url);
  if (path === "/verify" && req.method === "GET") return confirmEmail(url, allowedOrigins);
  if (path === "/token" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      // A senha é conferida no banco (crypt), como o GoTrue faria com auth.users.
      const { rows } = await pool.query<AuthUser & { confirmed: boolean }>(
        `select id::text as id, email::text as email, email_confirmed_at is not null as confirmed
         from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`,
        [String(body.email ?? "").trim(), String(body.password ?? "")]);
      const found = rows[0];
      if (!found) return authError(400, "invalid_credentials", "Invalid login credentials");
      // Cadastro com confirmação ligada e e-mail ainda não confirmado: o GoTrue não deixa entrar.
      if (!found.confirmed) return authError(400, "email_not_confirmed", "Email not confirmed");
      return json(200, session({ id: found.id, email: found.email }));
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
  // src/features/identity/services.tsx · loadOnboarding (Conta, passo "antecedência para cancelar").
  if (path === "/tenant_onboarding" && req.method === "GET") {
    const id = /^eq\.(.+)$/.exec(q.get("tenant_id") ?? "")?.[1];
    const known = [...q.keys()].every((k) => ["select", "tenant_id"].includes(k));
    if (!known || !id || !UUID.test(id) || q.get("select")?.replace(/\s/g, "") !== ONBOARDING_SELECT) return notCovered(req, url);
    return json(200, await readAs(actor, `select ${ONBOARDING_SELECT} from public.tenant_onboarding where tenant_id = $1`, [id]));
  }
  // src/features/identity/services.tsx · loadSetup ("Primeiros passos" da Conta): só a contagem, com HEAD.
  const count = COUNTS[path];
  if (count && req.method === "HEAD") {
    const id = /^eq\.(.+)$/.exec(q.get("tenant_id") ?? "")?.[1];
    const extra = [...q.keys()].filter((k) => k !== "select" && k !== "tenant_id");
    const sameFilters = extra.length === Object.keys(count.filters).length && extra.every((k) => q.get(k) === count.filters[k]);
    if (q.get("select") !== "id" || !id || !UUID.test(id) || !sameFilters || !/count=exact/.test(req.headers.get("Prefer") ?? "")) return notCovered(req, url);
    const [row] = await readAs<{ n: number }>(actor, `select count(*)::int as n from public.${count.table} where tenant_id = $1 ${count.where}`, [id]);
    const n = Number(row?.n ?? 0);
    return new Response(null, { status: 200, headers: { "Content-Range": n === 0 ? "*/0" : `0-${n - 1}/${n}` } });
  }
  // src/app/session.tsx · loadIsOperator; src/features/identity/services.tsx · loadMyLinks e loadMyBookings (Conta).
  const fn = /^\/rpc\/([a-z_]+)$/.exec(path)?.[1];
  if (fn && READ_RPCS.includes(fn) && req.method === "POST") {
    const r = await rpc(actor, fn, {});
    return r.error ? json(400, { code: r.error.code, message: r.error.message, details: null, hint: r.error.hint }) : json(200, r.data);
  }
  return notCovered(req, url);
}

const ONBOARDING_SELECT = "tenant_id,goal,cancellation_notice_hours,late_cancellation_fee_bps,completed_at,version";
/** RPCs de leitura sem argumento que o app chama direto pelo PostgREST (a RLS e o auth.uid() decidem o que volta). */
const READ_RPCS = ["my_is_operator", "my_customer_links", "my_bookings"];
/** Contagens de loadSetup: tabela, filtros exatos além de tenant_id e o SQL equivalente (texto fixo, nunca do pedido). */
const COUNTS: Record<string, { table: string; filters: Record<string, string>; where: string }> = {
  "/provider_services": { table: "provider_services", filters: { active: "eq.true" }, where: "and active = true" },
  "/availability_rules": { table: "availability_rules", filters: {}, where: "" },
  "/public_profiles": { table: "public_profiles", filters: { published_at: "not.is.null" }, where: "and published_at is not null" },
};

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
        const out = url.pathname.startsWith("/auth/v1/") ? await auth(request, url, opts.allowedOrigins)
          : url.pathname.startsWith("/__teste/") ? await testControl(request, url)
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

// POST/GET /functions/v1/network/<operação> — perfil público, indicações e convites (P09).
// Lógica pura com dependências injetadas: testada em Vitest, servida por index.ts no Deno.
//
// Regras do módulo (docs/04 "Cliente público e convites"):
// * Comandos só por POST com Idempotency-Key; GET nunca aceita convite nem publica nada.
// * Token do convite vai no corpo, nunca na query string; o link carrega o token no fragmento
//   (#t=…), que o navegador não envia ao servidor nem no Referer.
// * Perfil público sai de uma projeção fixa do banco; o handler só monta os campos permitidos.
// * Log técnico sem token, tenant, nome ou corpo.
// * Reserva pelo link (P43): public.book só segura o horário e manda o código; public.confirm é quem confirma. Nenhuma
//   das duas exige login; com login, o banco usa o vínculo do cliente (P01) para a reserva aparecer em "Minhas reservas".
import type { z } from "zod";
import {
  AvailabilityListOutput,
  ERROR_STATUS,
  type ErrorCode,
  IDEMPOTENCY_HEADER,
  IdempotencyKey,
  ProfilePublishInput,
  PublicProfile,
  PublicProfileField,
  PublicProfileQuery,
  ReferralCreateInput,
  ReferralLink,
  TENANT_HEADER,
} from "../_shared/contracts/index.ts";
import { type DbErrorLike, mapDbError } from "../_shared/http/errors.ts";
import { type Clock, corsHeaders, fail, isUuid, ok, requestIdFrom, systemClock } from "../_shared/http/respond.ts";
import {
  OwnerProfile,
  OwnerProfileOutput,
  ProfileUnpublishOutput,
  PublicBookInput,
  PublicBookOutput,
  PublicConfirmInput,
  PublicConfirmOutput,
  PublicContactInput,
  PublicContactOutput,
  PublicServicesOutput,
  PublicSlotsInput,
  ReferralClaimOutput,
  ReferralInspectOutput,
  ReferralListOutput,
  ReferralTokenInput,
  Slug,
} from "./schemas.ts";

type PublicProfileField = z.infer<typeof PublicProfileField>;
type RpcResult = { data: unknown; error: DbErrorLike | null };

export interface NetworkDeps {
  /** Chama uma RPC com o JWT do usuário, ou como anon quando `accessToken` é null. Nunca service role. */
  rpc(accessToken: string | null, fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** Origem pública do app (ex.: https://app.tinindo…), usada para montar links compartilháveis. */
  publicAppUrl: string;
  /**
   * Horários livres do link público. Depende do motor de agenda (P03). Ausente = agenda ainda
   * não conectada: a rota responde 503 em vez de inventar horários.
   */
  listPublicSlots?(input: z.infer<typeof PublicSlotsInput>): Promise<z.infer<typeof AvailabilityListOutput>>;
  allowedOrigins: readonly string[];
  clock?: Clock;
  log?: (entry: Record<string, unknown>) => void;
}

/** sha256 hex do JSON canônico (chaves ordenadas) da entrada já validada. */
export async function requestHash(value: unknown): Promise<string> {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
        : v;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const profileUrl = (base: string, slug: string) => `${base.replace(/\/$/, "")}/p/${slug}`;
export const inviteUrl = (base: string, token: string) => `${base.replace(/\/$/, "")}/convite#t=${token}`;

interface ProfileRow {
  slug: string;
  category: z.infer<typeof PublicProfile>["category"];
  area: string;
  public_fields: PublicProfileField[];
  values: Partial<Record<PublicProfileField, string>>;
  published_at: string | null;
  reputation: { identity_verified: boolean; reviews_count: number };
  version?: number;
}

/** Monta `fields` só com campos escolhidos pelo profissional; o link de reserva é derivado do slug. */
function profileFields(row: ProfileRow, publicAppUrl: string) {
  const fields: Partial<Record<PublicProfileField, string>> = {};
  for (const f of row.public_fields) {
    const value =
      f === "category" ? row.category
      : f === "area" ? row.area
      : f === "booking_link" ? profileUrl(publicAppUrl, row.slug)
      : row.values?.[f];
    if (value) fields[f] = value;
  }
  return fields;
}

const OPERATIONS = {
  "profile.publish": { method: "POST", auth: true, tenant: true, idempotent: true },
  "profile.unpublish": { method: "POST", auth: true, tenant: true, idempotent: true },
  "profile.get": { method: "GET", auth: true, tenant: true, idempotent: false },
  "public.profile": { method: "GET", auth: false, tenant: false, idempotent: false },
  "public.slots": { method: "POST", auth: false, tenant: false, idempotent: false },
  "public.services": { method: "POST", auth: false, tenant: false, idempotent: false },
  "public.book": { method: "POST", auth: false, tenant: false, idempotent: true },
  "public.confirm": { method: "POST", auth: false, tenant: false, idempotent: true },
  "public.contact": { method: "POST", auth: true, tenant: true, idempotent: false },
  "referral.create": { method: "POST", auth: true, tenant: false, idempotent: true },
  "referral.inspect": { method: "POST", auth: false, tenant: false, idempotent: false },
  "referral.claim": { method: "POST", auth: true, tenant: false, idempotent: true },
  "referral.list": { method: "GET", auth: true, tenant: false, idempotent: false },
} as const;
type Operation = keyof typeof OPERATIONS;

const isOperation = (v: string): v is Operation => Object.hasOwn(OPERATIONS, v);

export function createNetworkHandler(deps: NetworkDeps) {
  const clock = deps.clock ?? systemClock;

  return async (req: Request): Promise<Response> => {
    const started = clock.now().getTime();
    const requestId = requestIdFrom(req);
    const cors = corsHeaders(req, deps.allowedOrigins);
    const op = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
    const res = await handle(req, op, requestId, cors);
    deps.log?.({
      fn: "network",
      op: isOperation(op) ? op : "unknown",
      request_id: requestId,
      status: res.status,
      ms: clock.now().getTime() - started,
    });
    return res;
  };

  async function handle(req: Request, op: string, requestId: string, cors: Record<string, string>) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const failWith = (code: Parameters<typeof fail>[0], opts: { field?: string; message?: string } = {}) =>
      fail(code, requestId, { ...opts, extra: cors });

    if (!isOperation(op)) return failWith("NOT_FOUND");
    const spec = OPERATIONS[op];
    if (req.method !== spec.method) {
      // GET em comando nunca executa: scanners de e-mail abrem links (docs/04).
      return failWith("VALIDATION_ERROR", { message: `Use ${spec.method}.` });
    }

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
    if (spec.auth && !token) return failWith("AUTH_REQUIRED");

    const tenantHeader = req.headers.get(TENANT_HEADER);
    if (spec.tenant && !isUuid(tenantHeader)) {
      return failWith("VALIDATION_ERROR", { field: "tenant_id", message: "Selecione um negócio." });
    }

    let idemKey: string | null = null;
    if (spec.idempotent) {
      const parsedKey = IdempotencyKey.safeParse(req.headers.get(IDEMPOTENCY_HEADER));
      if (!parsedKey.success) return failWith("VALIDATION_ERROR", { field: "idempotency_key" });
      idemKey = parsedKey.data;
    }

    let body: unknown = undefined;
    if (spec.method === "POST") {
      try {
        body = await req.json();
      } catch {
        return failWith("VALIDATION_ERROR", { message: "Corpo JSON inválido." });
      }
    }

    const call = async (fn: string, args: Record<string, unknown>, asUser: boolean): Promise<RpcResult | Response> => {
      try {
        const result = await deps.rpc(asUser ? token : null, fn, args);
        if (result.error) {
          const mapped = mapDbError(result.error);
          return failWith(mapped.code, { field: mapped.field });
        }
        return result;
      } catch {
        return failWith("PROVIDER_UNAVAILABLE");
      }
    };

    /** Envelope {status_code, body} ou {status_code 4xx, error, field} das RPCs que gravam antes de recusar. */
    const respondEnvelope = <T extends z.ZodType>(schema: T, data: unknown) => {
      const env = data as { status_code?: unknown; body?: unknown; error?: unknown; field?: unknown } | null;
      const status = typeof env?.status_code === "number" ? env.status_code : 0;
      if (status >= 400 && status <= 499 && typeof env?.error === "string" && env.error in ERROR_STATUS) {
        return failWith(env.error as ErrorCode, { field: typeof env.field === "string" ? env.field : undefined });
      }
      if (status !== 200 && status !== 201) return failWith("INTERNAL_ERROR");
      return respond(schema, env?.body, status);
    };

    /** Valida a saída antes de responder: linha fora do contrato vira 500 sem vazar conteúdo. */
    const respond = <T extends z.ZodType>(schema: T, data: unknown, status = 200) => {
      const parsed = schema.safeParse(data);
      if (!parsed.success) return failWith("INTERNAL_ERROR");
      return ok(parsed.data, requestId, clock, status, cors);
    };

    switch (op) {
      case "profile.publish": {
        const input = ProfilePublishInput.safeParse(body);
        if (!input.success) return failWith("VALIDATION_ERROR", { field: fieldOf(input.error) });
        const r = await call("network_profile_publish", {
          p_tenant_id: tenantHeader,
          p_slug: input.data.slug,
          p_category: input.data.category,
          p_area: input.data.area,
          p_public_fields: input.data.public_fields,
          p_idem_key: idemKey,
          p_request_hash: await requestHash(input.data),
        }, true);
        if (r instanceof Response) return r;
        const row = (r.data as { body?: ProfileRow } | null)?.body;
        if (!row) return failWith("INTERNAL_ERROR");
        return respond(PublicProfile, {
          slug: row.slug,
          category: row.category,
          area: row.area,
          fields: profileFields(row, deps.publicAppUrl),
          published_at: row.published_at,
          reputation: row.reputation,
        });
      }

      case "profile.unpublish": {
        const r = await call("network_profile_unpublish", {
          p_tenant_id: tenantHeader,
          p_idem_key: idemKey,
          p_request_hash: await requestHash({}),
        }, true);
        if (r instanceof Response) return r;
        return respond(ProfileUnpublishOutput, (r.data as { body?: unknown } | null)?.body);
      }

      case "profile.get": {
        const r = await call("network_profile_get", { p_tenant_id: tenantHeader }, true);
        if (r instanceof Response) return r;
        const row = r.data as ProfileRow | null;
        if (!row) return respond(OwnerProfileOutput, { profile: null });
        const profile: z.input<typeof OwnerProfile> = {
          slug: row.slug,
          category: row.category,
          area: row.area,
          public_fields: row.public_fields,
          fields: profileFields(row, deps.publicAppUrl),
          published_at: row.published_at,
          reputation: row.reputation,
          version: row.version ?? 1,
        };
        return respond(OwnerProfileOutput, { profile });
      }

      case "public.profile": {
        const slug = Slug.safeParse(new URL(req.url).searchParams.get("slug"));
        if (!slug.success) return failWith("NOT_FOUND");
        const r = await call("network_public_profile", { p_slug: slug.data }, false);
        if (r instanceof Response) return r;
        const row = r.data as ProfileRow | null;
        if (!row) return failWith("NOT_FOUND");
        return respond(PublicProfile, {
          slug: row.slug,
          category: row.category,
          area: row.area,
          fields: profileFields(row, deps.publicAppUrl),
          published_at: row.published_at,
          reputation: row.reputation,
        });
      }

      case "public.slots": {
        const input = PublicSlotsInput.safeParse(body);
        if (!input.success) return failWith("VALIDATION_ERROR", { field: fieldOf(input.error) });
        if (!deps.listPublicSlots) {
          return failWith("PROVIDER_UNAVAILABLE", { message: "Horários on-line ainda não disponíveis." });
        }
        try {
          return respond(AvailabilityListOutput, await deps.listPublicSlots(input.data));
        } catch {
          return failWith("PROVIDER_UNAVAILABLE");
        }
      }

      case "public.services": {
        // POST como public.slots: consulta anônima pelo slug, sem nada na query string.
        const input = PublicProfileQuery.safeParse(body);
        if (!input.success) return failWith("NOT_FOUND");
        const r = await call("public_booking_services", { p_slug: input.data.slug }, false);
        if (r instanceof Response) return r;
        return respond(PublicServicesOutput, r.data);
      }

      case "public.book": {
        const input = PublicBookInput.safeParse(body);
        if (!input.success) return failWith("VALIDATION_ERROR", { field: fieldOf(input.error) });
        // Com login, o JWT vai junto: o banco usa o vínculo do cliente. Sem login, anon.
        const r = await call("public_booking_request", {
          p_slug: input.data.slug,
          p_service_id: input.data.service_id,
          p_starts_at: input.data.starts_at,
          p_contact_name: input.data.contact.name,
          p_contact_phone: input.data.contact.phone_e164,
          p_idem_key: idemKey,
          p_request_hash: await requestHash(input.data),
          p_request_id: requestId,
        }, true);
        if (r instanceof Response) return r;
        return respondEnvelope(PublicBookOutput, r.data);
      }

      case "public.confirm": {
        const input = PublicConfirmInput.safeParse(body);
        if (!input.success) return failWith("VALIDATION_ERROR", { field: fieldOf(input.error) });
        // A confirmação é idempotente pelo estado: repetir com o código certo devolve a mesma reserva.
        const r = await call("public_booking_confirm", {
          p_request: input.data.request_id,
          p_code: input.data.code,
          p_request_id: requestId,
        }, false);
        if (r instanceof Response) return r;
        return respondEnvelope(PublicConfirmOutput, r.data);
      }

      case "public.contact": {
        const input = PublicContactInput.safeParse(body);
        if (!input.success) return failWith("VALIDATION_ERROR", { field: fieldOf(input.error) });
        const r = await call("public_booking_contact", { p_tenant_id: tenantHeader, p_booking_id: input.data.booking_id }, true);
        if (r instanceof Response) return r;
        return respond(PublicContactOutput, r.data);
      }

      case "referral.create": {
        const input = ReferralCreateInput.safeParse(body);
        if (!input.success) return failWith("VALIDATION_ERROR", { field: fieldOf(input.error) });
        const peer = input.data.kind === "professional_invites_peer";
        if (peer && !isUuid(tenantHeader)) {
          return failWith("VALIDATION_ERROR", { field: "tenant_id", message: "Selecione um negócio." });
        }
        const tenantId = peer ? tenantHeader : null;
        const r = await call("network_referral_create", {
          p_kind: input.data.kind,
          p_tenant_id: tenantId,
          p_invitee_name: input.data.invitee_name,
          p_invitee_category: input.data.invitee_category ?? null,
          p_origin: input.data.origin,
          p_idem_key: idemKey,
          // O tenant entra no hash: a mesma chave em outro negócio é outro pedido.
          p_request_hash: await requestHash({ ...input.data, tenant_id: tenantId }),
        }, true);
        if (r instanceof Response) return r;
        const row = r.data as { referral_id?: string; token?: string; expires_at?: string } | null;
        if (!row?.token) return failWith("INTERNAL_ERROR");
        return respond(ReferralLink, {
          referral_id: row.referral_id,
          share_url: inviteUrl(deps.publicAppUrl, row.token),
          expires_at: row.expires_at,
        }, 201);
      }

      case "referral.inspect": {
        const input = ReferralTokenInput.safeParse(body);
        // Token malformado e inexistente dão a mesma resposta.
        if (!input.success) return failWith("NOT_FOUND");
        const r = await call("network_referral_inspect", { p_token: input.data.token }, false);
        if (r instanceof Response) return r;
        return respond(ReferralInspectOutput, r.data);
      }

      case "referral.claim": {
        const input = ReferralTokenInput.safeParse(body);
        if (!input.success) return failWith("NOT_FOUND");
        const r = await call("network_referral_claim", { p_token: input.data.token }, true);
        if (r instanceof Response) return r;
        return respond(ReferralClaimOutput, r.data);
      }

      case "referral.list": {
        const r = await call("network_referral_list", {}, true);
        if (r instanceof Response) return r;
        return respond(ReferralListOutput, { referrals: r.data ?? [] });
      }
    }
  }
}

function fieldOf(error: { issues: readonly { path: readonly PropertyKey[] }[] }): string | undefined {
  const path = error.issues[0]?.path;
  return path && path.length > 0 ? path.map(String).join(".") : undefined;
}

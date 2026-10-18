// Contexto do servidor e identidade (docs/02 e docs/04).
// O tenant enviado pelo cliente é SELEÇÃO; quem autoriza é o banco (resolve_context).
import { z } from "zod";
import { Uuid } from "./common.ts";

/** Header com o tenant selecionado pela interface. Não concede acesso. */
export const TENANT_HEADER = "X-Tinindo-Tenant";
export const REQUEST_ID_HEADER = "X-Request-Id";

/** Papéis dentro de um negócio. Staff é fase 2; existe no contrato para não quebrar depois. */
export const MemberRole = z.enum(["owner", "staff"]);
export type MemberRole = z.infer<typeof MemberRole>;

/** Papel efetivo da requisição. `customer` vem de customer_links (P01), não de membership. */
export const ActorRole = z.enum(["owner", "staff", "customer", "public", "worker"]);
export type ActorRole = z.infer<typeof ActorRole>;

export const Channel = z.enum(["web", "public_link", "agent", "worker", "whatsapp"]);
export type Channel = z.infer<typeof Channel>;

/** Contexto resolvido no servidor para cada comando. Nunca construído pelo LLM. */
export const ServerContext = z.object({
  actor_user_id: Uuid.nullable(),
  tenant_id: Uuid,
  role: ActorRole,
  request_id: Uuid,
  channel: Channel,
});
export type ServerContext = z.infer<typeof ServerContext>;

/** Resposta de `GET /functions/v1/context`: caminho request → autorização → banco. */
export const ContextResponse = z.object({
  actor_user_id: Uuid,
  tenant_id: Uuid,
  role: MemberRole,
  tenant_name: z.string(),
  timezone: z.string(),
  currency: z.literal("BRL"),
});
export type ContextResponse = z.infer<typeof ContextResponse>;

export const Profession = z.enum(["barber", "hairdresser", "personal_trainer", "other"]);
export type Profession = z.infer<typeof Profession>;

export const TenantStatus = z.enum(["active", "suspended", "closed"]);

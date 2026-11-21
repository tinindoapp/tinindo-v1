// Avisos no celular (P34, item 3), lado do navegador: assinatura do aparelho (PushManager) e as rotas da função `push`.
// A tela recebe uma `PushPort`; a demonstração usa uma porta sem servidor (nada é enviado).
import type { z } from "zod";
import {
  PUSH_ROUTES, PushConfigOutput, PushDeviceOutput, type PushPrefs, PushTestOutput, PushUnsubscribeOutput,
} from "../../../supabase/functions/push/schemas.ts";

export type { PushPrefs };
export type PushDevice = NonNullable<z.infer<typeof PushDeviceOutput>>;

export const DEFAULT_PREFS: PushPrefs = { booking_new: true, booking_cancelled: true, reminder_30: true, daily_summary: false };

export interface PushPort {
  demo: boolean;
  config(): Promise<{ available: boolean; public_key: string | null }>;
  subscribe(input: { endpoint: string; keys: { p256dh: string; auth: string }; device_label: string | null; prefs: Partial<PushPrefs> }): Promise<PushDevice | null>;
  prefs(endpoint: string, prefs: Partial<PushPrefs>): Promise<PushDevice | null>;
  unsubscribe(endpoint: string): Promise<{ removed: boolean }>;
  device(endpoint: string): Promise<PushDevice | null>;
  test(endpoint: string): Promise<{ queued: boolean }>;
}

type Call = <T extends z.ZodType>(path: string, schema: T, opts: { method: "POST"; tenantId: string; body: unknown }) => Promise<{ data: z.infer<T> }>;

export function createServerPushPort(call: Call, tenantId: string): PushPort {
  const post = <T extends z.ZodType>(op: string, schema: T, body: unknown) => call(`/push/${op}`, schema, { method: "POST", tenantId, body }).then((r) => r.data);
  return {
    demo: false,
    config: () => post(PUSH_ROUTES.config, PushConfigOutput, {}),
    subscribe: (input) => post(PUSH_ROUTES.subscribe, PushDeviceOutput, input),
    prefs: (endpoint, prefs) => post(PUSH_ROUTES.prefs, PushDeviceOutput, { endpoint, prefs }),
    unsubscribe: (endpoint) => post(PUSH_ROUTES.unsubscribe, PushUnsubscribeOutput, { endpoint }),
    device: (endpoint) => post(PUSH_ROUTES.device, PushDeviceOutput, { endpoint }),
    test: (endpoint) => post(PUSH_ROUTES.test, PushTestOutput, { endpoint }),
  };
}

/** Demonstração: o servidor de avisos não existe; a tela explica e não pede permissão ao navegador. */
export function createDemoPushPort(): PushPort {
  return {
    demo: true,
    config: async () => ({ available: false, public_key: null }),
    subscribe: async () => null,
    prefs: async () => null,
    unsubscribe: async () => ({ removed: false }),
    device: async () => null,
    test: async () => ({ queued: false }),
  };
}

export type Support = "ok" | "no-sw" | "no-push" | "ios-needs-install";

/** O que este navegador permite. No iPhone, só o app instalado na tela de início recebe avisos (iOS 16.4+). */
export function pushSupport(env: { hasSw: boolean; hasPush: boolean; hasNotification: boolean; ios: boolean; standalone: boolean }): Support {
  if (env.ios && !env.standalone) return "ios-needs-install";
  if (!env.hasSw) return "no-sw";
  if (!env.hasPush || !env.hasNotification) return "no-push";
  return "ok";
}

export function keyBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Nome do aparelho em palavras (para a pessoa reconhecer na lista), sem nada que identifique além do modelo. */
export function deviceLabel(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Celular Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Computador Windows";
  return "Este aparelho";
}

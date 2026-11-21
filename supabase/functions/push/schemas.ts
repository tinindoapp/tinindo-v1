// Contratos da função `push` (P34, avisos no celular). Ficam aqui, fora do registro de contratos (como o
// setup.describe do P50): o registro em OPERATIONS vai por recado. A tela importa estes schemas.
import { z } from "zod";

/**
 * Serviços de push aceitos. O endereço vem do navegador, e o servidor faz um POST nele: sem esta lista, a função poderia
 * ser usada para chamar qualquer endereço.
 */
export const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^(web|api)\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function pushEndpointAllowed(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

export const PushKind = z.enum(["booking_new", "booking_cancelled", "reminder_30", "daily_summary"]);
export type PushKind = z.infer<typeof PushKind>;

export const PushPrefs = z.object({
  booking_new: z.boolean(),
  booking_cancelled: z.boolean(),
  reminder_30: z.boolean(),
  daily_summary: z.boolean(),
}).strict();
export type PushPrefs = z.infer<typeof PushPrefs>;

const Endpoint = z.string().max(1000).refine(pushEndpointAllowed, "endereço de push não aceito");

export const PushSubscribeInput = z.object({
  endpoint: Endpoint,
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/) }),
  device_label: z.string().trim().min(1).max(60).nullable().default(null),
  prefs: PushPrefs.partial().default({}),
}).strict();
export const PushEndpointInput = z.object({ endpoint: Endpoint }).strict();
export const PushPrefsInput = z.object({ endpoint: Endpoint, prefs: PushPrefs.partial() }).strict();

export const PushDevice = z.object({
  id: z.uuid(),
  device_label: z.string().nullable(),
  created_at: z.string(),
  last_sent_at: z.string().nullable(),
  prefs: PushPrefs,
});
export type PushDevice = z.infer<typeof PushDevice>;

/** `available: false` = o ambiente não tem chaves VAPID: a tela explica e não pede permissão ao navegador. */
export const PushConfigOutput = z.object({ available: z.boolean(), public_key: z.string().nullable() });
export const PushDeviceOutput = PushDevice.nullable();
export const PushUnsubscribeOutput = z.object({ removed: z.boolean() });
export const PushTestOutput = z.object({ queued: z.boolean() });

export const PUSH_ROUTES = {
  config: "push.config",
  subscribe: "push.subscribe",
  prefs: "push.prefs",
  unsubscribe: "push.unsubscribe",
  device: "push.device",
  test: "push.test",
  dispatch: "push.dispatch",
} as const;

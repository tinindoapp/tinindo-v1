// Escolha do provedor real SÓ por segredo do Supabase, como a camada de linguagem (release/LLM.md). Trocar de provedor
// = mudar o segredo e reiniciar a função; nenhum deploy de código.
//
//   MESSAGING_PROVIDER = simulado (padrão) | meta     → WhatsApp oficial pela Cloud API da Meta (release/WHATSAPP.md)
//   PSP_PROVIDER       = simulado (padrão) | asaas    → Pix por cobrança no Asaas (release/PIX.md)
//
// Ausente ou vazio = simulado. Valor desconhecido = simulado, com o motivo no log da partida. Provedor real escolhido
// sem os segredos dele NÃO cai para o simulado: fica escolhido e "não configurado", e conectar número ou criar cobrança
// responde 503 antes do banco. Cair sozinho no simulado mandaria o cliente real para um telefone ou Pix de mentira.
//
// O provedor ativo vale para o que nasce depois (conexão de número, cobrança). O que já existe segue no provedor em que
// nasceu: webhook, consulta e estorno usam o provedor gravado na linha.

export type EnvGetter = (name: string) => string | undefined;

/** Nome interno de cada provedor (o que o banco grava). */
export type MessagingProviderName = "simulated" | "whatsapp_cloud";
export type PaymentProviderName = "simulated" | "asaas";

export interface ProviderChoice<N extends string> {
  /** Provedor para o que nasce agora. */
  active: N;
  /** true = o provedor ativo é real (não o simulado). */
  real: boolean;
  /** Segredos obrigatórios do provedor ativo que faltam (só os NOMES; nunca valores). */
  missing: string[];
  /** Motivos para o log da partida (sem valor de segredo). */
  problems: string[];
}

/** Valor do segredo → nome interno. "simulated" também vale, para quem copiar o nome interno. */
export const MESSAGING_VALUES: Record<string, MessagingProviderName> = { simulado: "simulated", simulated: "simulated", meta: "whatsapp_cloud" };
export const PAYMENT_VALUES: Record<string, PaymentProviderName> = { simulado: "simulated", simulated: "simulated", asaas: "asaas" };

/** Segredos sem os quais o provedor real não liga. */
export const REQUIRED_SECRETS: Record<MessagingProviderName | PaymentProviderName, readonly string[]> = {
  simulated: [],
  whatsapp_cloud: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"],
  asaas: ["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"],
};

function choose<N extends string>(secret: string, values: Record<string, N>, env: EnvGetter): ProviderChoice<N> {
  const problems: string[] = [];
  const raw = (env(secret) ?? "").trim().toLowerCase();
  let active = values.simulado as N;
  if (raw !== "") {
    const mapped = values[raw];
    if (mapped) active = mapped;
    else problems.push(`${secret} desconhecido; usando simulado`);
  }
  const missing = (REQUIRED_SECRETS[active as MessagingProviderName | PaymentProviderName] ?? []).filter((n) => !(env(n) ?? "").trim());
  if (missing.length > 0) problems.push(`${secret}=${raw} sem ${missing.join(", ")}: provedor não configurado (conectar/cobrar responde 503)`);
  return { active, real: active !== "simulated", missing, problems };
}

export const messagingChoice = (env: EnvGetter) => choose<MessagingProviderName>("MESSAGING_PROVIDER", MESSAGING_VALUES, env);
export const paymentChoice = (env: EnvGetter) => choose<PaymentProviderName>("PSP_PROVIDER", PAYMENT_VALUES, env);

/** O que a tela recebe sobre o provedor ativo: nenhum segredo, só o estado. */
export interface ActiveProviderInfo<N extends string> {
  active: N;
  real: boolean;
  configured: boolean;
}
export const activeInfo = <N extends string>(c: ProviderChoice<N>): ActiveProviderInfo<N> => ({ active: c.active, real: c.real, configured: c.missing.length === 0 });

/**
 * Troca (ou põe) o campo `provider` do corpo JSON pelo provedor ativo. A tela não escolhe provedor: o servidor decide
 * pelo segredo. Corpo que não é objeto JSON segue como veio (o schema da rota recusa).
 */
export async function withProvider(req: Request, provider: string): Promise<Request> {
  const body = await req.clone().json().catch(() => undefined) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) return req;
  return new Request(req, { body: JSON.stringify({ ...(body as Record<string, unknown>), provider }) });
}

/** Acrescenta `provider` (estado do provedor ativo) ao `data` de uma resposta JSON de sucesso. */
export async function withProviderInfo(res: Response, info: ActiveProviderInfo<string>, cors: Record<string, string>): Promise<Response> {
  if (!res.ok) return res;
  const json = await res.clone().json().catch(() => null) as { data?: unknown } | null;
  if (!json || !json.data || typeof json.data !== "object") return res;
  const headers = { ...Object.fromEntries(res.headers), ...cors };
  delete (headers as Record<string, string>)["content-length"];
  return new Response(JSON.stringify({ ...json, data: { ...(json.data as Record<string, unknown>), provider: info } }), { status: res.status, headers });
}

// Servidor falso que imita a Graph da Meta (Cloud API do WhatsApp) para os testes sem rede. Escuta em 127.0.0.1,
// grava cada pedido e responde conforme o cenário: envio aceito, erro 4xx com código, 429, código de limite, 5xx e
// tempo esgotado; leitura do número. Também monta entregas de webhook assinadas como a Meta assina
// (X-Hub-Signature-256 = HMAC-SHA256 do app secret sobre o corpo bruto).
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type GraphScenario =
  | { kind: "success" }
  | { kind: "error"; status: number; code: number; message?: string }
  | { kind: "rate_limited"; retryAfter?: number }
  | { kind: "server_error" }
  | { kind: "timeout"; ms: number };

export interface GraphRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown> | null;
}

export interface FakeGraph {
  /** Base como a do adaptador: http://127.0.0.1:<porta>/v21.0 */
  graphUrl: string;
  requests: GraphRequest[];
  /** Cenário do próximo envio (fila); vazia = sucesso. */
  queue: GraphScenario[];
  /** phone_number_id → display_phone_number que a leitura devolve. Outros ids: 400 código 100. */
  numbers: Map<string, string>;
  close(): Promise<void>;
}

export async function startFakeGraph(): Promise<FakeGraph> {
  const requests: GraphRequest[] = [];
  const queue: GraphScenario[] = [];
  const numbers = new Map<string, string>();
  const timers = new Set<NodeJS.Timeout>();
  let seq = 0;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      let body: Record<string, unknown> | null = null;
      try {
        body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
      } catch { /* corpo vazio ou inválido */ }
      const url = new URL(req.url ?? "/", "http://graph.local");
      requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, headers: req.headers, body });
      const send = (status: number, json: unknown, headers: Record<string, string> = {}) => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(json));
      };
      if (req.headers.authorization !== "Bearer token-falso") {
        send(401, { error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } });
        return;
      }
      const msg = /^\/v21\.0\/([0-9]+)\/messages$/.exec(url.pathname);
      const num = /^\/v21\.0\/([0-9]+)$/.exec(url.pathname);
      if (req.method === "GET" && num) {
        const display = numbers.get(num[1]!);
        if (!display) send(400, { error: { message: "Unsupported get request.", type: "GraphMethodException", code: 100 } });
        else send(200, { display_phone_number: display, verified_name: "Negócio de teste", quality_rating: "GREEN", id: num[1] });
        return;
      }
      if (req.method !== "POST" || !msg) {
        send(404, { error: { message: "not found", code: 803 } });
        return;
      }
      const s = queue.shift() ?? { kind: "success" };
      if (s.kind === "timeout") {
        const t = setTimeout(() => send(200, { messages: [{ id: `wamid.tarde.${++seq}` }] }), s.ms);
        timers.add(t);
        res.on("close", () => clearTimeout(t));
        return;
      }
      if (s.kind === "server_error") send(500, { error: { message: "An unknown error occurred", code: 1 } });
      else if (s.kind === "rate_limited") send(429, { error: { message: "rate", code: 130429 } }, s.retryAfter ? { "retry-after": String(s.retryAfter) } : {});
      else if (s.kind === "error") send(s.status, { error: { message: s.message ?? "erro", type: "OAuthException", code: s.code, fbtrace_id: "fake" } });
      else send(200, { messaging_product: "whatsapp", contacts: [{ input: (body?.to as string) ?? "", wa_id: (body?.to as string) ?? "" }], messages: [{ id: `wamid.falso.${++seq}` }] });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    graphUrl: `http://127.0.0.1:${port}/v21.0`,
    requests,
    queue,
    numbers,
    close: () => new Promise<void>((resolve) => {
      for (const t of timers) clearTimeout(t);
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** Entrega de webhook como a Meta faria: corpo bruto e a assinatura do app secret sobre ele. */
export function metaDelivery(body: unknown, appSecret: string): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: `sha256=${createHmac("sha256", appSecret).update(raw, "utf8").digest("hex")}` };
}

/** Corpo do webhook da Cloud API (entry[].changes[].value) para um número do negócio. */
export function webhookBody(phoneNumberId: string, value: Record<string, unknown>): Record<string, unknown> {
  return { object: "whatsapp_business_account", entry: [{ id: "WABA-FALSA", changes: [{ field: "messages",
    value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5511999990001", phone_number_id: phoneNumberId }, ...value } }] }] };
}

// Servidor falso que imita a resposta de cada provedor (P46). Sem rede: escuta em 127.0.0.1 e grava o corpo de cada
// pedido para os testes conferirem o que sairia para o provedor (modelo, schema, ausência de PII e de temperature).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Scenario = "success" | "invalid_json" | "refusal" | "rate_limited" | "timeout";
export type Provider = "anthropic" | "openai" | "gemini";

export interface Captured {
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
  raw: string;
}

export interface FakeProvider {
  baseURL: string;
  requests: Captured[];
  scenario: Scenario;
  /** JSON que o "modelo" devolve no cenário de sucesso. */
  payload: unknown;
  close(): Promise<void>;
}

const USAGE = { input: 120, output: 30 };

function anthropic(s: Scenario, text: string): [number, unknown] {
  if (s === "rate_limited") return [429, { type: "error", error: { type: "rate_limit_error", message: "limite" } }];
  const refusal = s === "refusal";
  return [200, {
    id: "msg_fake", type: "message", role: "assistant", model: "claude-haiku-5-5",
    content: refusal ? [] : [{ type: "text", text }],
    stop_reason: refusal ? "refusal" : "end_turn",
    stop_details: refusal ? { type: "refusal", category: null, explanation: null } : null,
    stop_sequence: null,
    usage: { input_tokens: USAGE.input, output_tokens: USAGE.output },
  }];
}

function openai(s: Scenario, text: string): [number, unknown] {
  if (s === "rate_limited") return [429, { error: { message: "limite", type: "rate_limit_exceeded", code: "rate_limit_exceeded" } }];
  const content = s === "refusal" ? [{ type: "refusal", refusal: "não posso ajudar" }] : [{ type: "output_text", text, annotations: [] }];
  return [200, {
    id: "resp_fake", object: "response", created_at: 0, status: "completed", model: "modelo-teste",
    output: [{ type: "message", id: "msg_fake", role: "assistant", status: "completed", content }],
    usage: { input_tokens: USAGE.input, output_tokens: USAGE.output, total_tokens: USAGE.input + USAGE.output },
  }];
}

function gemini(s: Scenario, text: string): [number, unknown] {
  if (s === "rate_limited") return [429, { error: { code: 429, message: "limite", status: "RESOURCE_EXHAUSTED" } }];
  const usageMetadata = { promptTokenCount: USAGE.input, candidatesTokenCount: USAGE.output, totalTokenCount: USAGE.input + USAGE.output };
  if (s === "refusal") return [200, { promptFeedback: { blockReason: "SAFETY" }, usageMetadata }];
  return [200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }], usageMetadata }];
}

export async function startFakeProvider(provider: Provider): Promise<FakeProvider> {
  const state: { scenario: Scenario; payload: unknown } = { scenario: "success", payload: {} };
  const requests: Captured[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch { /* corpo vazio */ }
      requests.push({ path: req.url ?? "", headers: req.headers, body, raw });
      const text = state.scenario === "invalid_json" ? "{isto não é json" : JSON.stringify(state.payload);
      const [status, json] = provider === "anthropic" ? anthropic(state.scenario, text)
        : provider === "openai" ? openai(state.scenario, text) : gemini(state.scenario, text);
      const send = () => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, { "content-type": "application/json", ...(status === 429 ? { "retry-after": "1" } : {}) });
        res.end(JSON.stringify(json));
      };
      if (state.scenario === "timeout") {
        const t = setTimeout(send, 3000);
        timers.add(t);
        res.on("close", () => clearTimeout(t));
      } else {
        send();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const root = `http://127.0.0.1:${port}`;
  const fake: FakeProvider = {
    baseURL: provider === "openai" ? `${root}/v1` : root,
    requests,
    get scenario() {
      return state.scenario;
    },
    set scenario(v: Scenario) {
      state.scenario = v;
    },
    get payload() {
      return state.payload;
    },
    set payload(v: unknown) {
      state.payload = v;
    },
    close: () => new Promise<void>((resolve) => {
      for (const t of timers) clearTimeout(t);
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
  return fake;
}

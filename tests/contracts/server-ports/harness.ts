// Rede de proteção das portas de servidor (D32 b, R0 do doc 15 da revisão de 10/11/2026).
//
// Cada `serverPort.ts` reescreve à mão a rota, o corpo e o schema de saída de cada operação. Este arreio chama
// todos os métodos da porta com um `call` falso e confere cada chamada com o registro de contratos (OPERATIONS):
//   - a rota existe no registro e está no módulo certo;
//   - o corpo enviado é aceito pelo schema de entrada da operação;
//   - o schema de saída que a porta passa ao cliente é o do registro (o mesmo objeto, não uma cópia);
//   - comando leva Idempotency-Key (a que a tela passou, sem trocar); consulta não leva;
//   - o negócio escolhido vai no header quando a porta é de um negócio.
// A resposta devolvida é um exemplo gerado do schema de saída e validado por ele: o que a porta lê da resposta
// existe no contrato. E a porta inteira tem de ser exercitada: método novo sem caso no teste falha.
//
// Não cobre: o handler de verdade, o banco e a rede (isso é a jornada com servidor, D32 a, P59).
import { expect } from "vitest";
import { z } from "zod";
import { ContextResponse, type ModuleId, OPERATIONS, type OperationName } from "@contracts";
import { FX } from "@contracts/fixtures.ts";

export const TENANT = FX.tenants.A;
const META = { request_id: "7a1f8a52-2b0c-4b4e-9f1e-3c0f6b5d2a10", as_of: "2026-10-20T12:00:00Z", schema_version: 1 };

/** Rotas em estilo REST (GET com query) que apontam para uma operação do registro com outro nome. */
const ROUTE_ALIAS: Record<string, OperationName> = {
  "crm/customers": "customer.list",
  "crm/services": "service.list",
};

export interface RecordedCall {
  path: string;
  /** Nome no registro, ou "context" para GET /context. */
  operation: OperationName | "context";
  method: "GET" | "POST";
  tenantId: string | undefined;
  body: unknown;
  idempotencyKey: string | undefined;
}

type CallOptions = { method?: "GET" | "POST"; tenantId?: string; body?: unknown; idempotencyKey?: string };
type Sample = unknown | ((body: unknown) => unknown);

export interface HarnessOptions {
  /** Módulos de outras áreas que esta porta lê (ex.: Materiais lê serviços do `crm`). O próprio módulo já vale. */
  alsoReads?: ModuleId[];
  /** Resposta por operação quando o exemplo gerado não serve (a porta depende de um valor específico). */
  responses?: Partial<Record<OperationName | "context", Sample>>;
  /** Porta de link público ou de operador: não manda o negócio no header. Padrão: manda. */
  tenant?: "required" | "none";
  /** Operações que fogem do modo da porta (ex.: a fila do operador, sem negócio, numa porta que manda negócio). */
  tenantExceptions?: (OperationName | "context")[];
}

// ---------------------------------------------------------------------------------------------------------------
// Exemplo a partir do schema de saída. O JSON Schema do zod descreve a forma; o próprio schema confere o resultado.

type Json = Record<string, unknown>;
const UUID = "00000000-0000-4000-8000-000000000001";

function fromJsonSchema(node: Json, root: Json, depth = 0): unknown {
  if (depth > 40) return null;
  if (typeof node.$ref === "string") {
    const target = node.$ref.replace(/^#\//, "").split("/").reduce<unknown>((at, k) => (at as Json)?.[k], root);
    return fromJsonSchema((target as Json) ?? {}, root, depth + 1);
  }
  if ("const" in node) return node.const;
  if (Array.isArray(node.enum)) return node.enum[0];
  for (const union of ["anyOf", "oneOf"] as const) {
    const options = node[union] as Json[] | undefined;
    if (options?.length) {
      const concrete = options.find((o) => o.type !== "null") ?? options[0]!;
      return fromJsonSchema(concrete, root, depth + 1);
    }
  }
  if (Array.isArray(node.allOf)) {
    return Object.assign({}, ...(node.allOf as Json[]).map((part) => fromJsonSchema(part, root, depth + 1) as Json));
  }
  const type = Array.isArray(node.type) ? (node.type as string[]).find((t) => t !== "null") : (node.type as string | undefined);
  switch (type) {
    case "object": {
      const out: Json = {};
      const props = (node.properties ?? {}) as Record<string, Json>;
      for (const key of (node.required as string[] | undefined) ?? []) out[key] = fromJsonSchema(props[key] ?? {}, root, depth + 1);
      return out;
    }
    case "array": {
      const min = (node.minItems as number | undefined) ?? 0;
      const prefix = (node.prefixItems as Json[] | undefined) ?? [];
      if (prefix.length) return prefix.map((p) => fromJsonSchema(p, root, depth + 1));
      // Um item mesmo quando a lista pode ser vazia: a porta costuma mapear a lista, e o item exercita o schema.
      return Array.from({ length: Math.max(min, 1) }, () => fromJsonSchema((node.items as Json) ?? {}, root, depth + 1));
    }
    case "string": {
      switch (node.format) {
        case "uuid": return UUID;
        case "date-time": return "2026-10-20T12:00:00Z";
        case "date": return "2026-10-20";
        case "time": return "09:00:00";
        case "email": return "pessoa@exemplo.com";
        case "uri": return "https://exemplo.com/";
      }
      const min = (node.minLength as number | undefined) ?? 1;
      const max = (node.maxLength as number | undefined) ?? Infinity;
      return "x".repeat(Math.min(Math.max(min, 1), max));
    }
    case "integer":
    case "number": {
      const min = (node.minimum as number | undefined) ?? (typeof node.exclusiveMinimum === "number" ? node.exclusiveMinimum + 1 : undefined);
      const max = node.maximum as number | undefined;
      if (min !== undefined) return min;
      return max !== undefined && max < 1 ? max : 1;
    }
    case "boolean": return false;
    case "null": return null;
    default: return null;
  }
}

const sampleCache = new Map<z.ZodType, unknown>();

/** Valores que os refinamentos do contrato costumam pedir e o JSON Schema não descreve (fuso, telefone, hora…). */
const CANDIDATES: unknown[] = [
  "America/Sao_Paulo", "+5511987654321", "09:00", "18:00", "2026-10-20", "2026-10", "2026-10-20T12:00:00-03:00", "BRL", "exemplo",
  "a".repeat(64), "A".repeat(43), "01310", "01310100", "11222333000181", "3550308", "123456", "1", "pt-BR", "Exemplo",
  0, 1, 100, 60, 30, null, [], true, "/app/exemplo", "2026-10-01",
];

function getAt(root: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((at, k) => (at as Record<PropertyKey, unknown> | undefined)?.[k], root);
}
function setAt(root: unknown, path: PropertyKey[], value: unknown): void {
  const parent = getAt(root, path.slice(0, -1)) as Record<PropertyKey, unknown> | undefined;
  if (parent && path.length) parent[path[path.length - 1]!] = value;
}
const failsAt = (schema: z.ZodType, value: unknown, path: PropertyKey[]) => {
  const r = schema.safeParse(value);
  return !r.success && r.error.issues.some((i) => JSON.stringify(i.path) === JSON.stringify(path));
};

/** Conserta, folha por folha, o que o refinamento recusou, tentando os valores conhecidos. */
function repair(schema: z.ZodType, candidate: unknown): unknown {
  for (let round = 0; round < 60; round += 1) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return candidate;
    const issue = parsed.error.issues.find((i) => i.path.length > 0);
    if (!issue) return candidate;
    const original = getAt(candidate, issue.path);
    const fix = CANDIDATES.find((value) => {
      setAt(candidate, issue.path, value);
      return !failsAt(schema, candidate, issue.path);
    });
    if (fix === undefined) {
      setAt(candidate, issue.path, original);
      return candidate;
    }
  }
  return candidate;
}

/** Exemplo válido do schema. Se o gerador não acerta (regra entre campos), o teste passa a resposta à mão. */
export function sampleOf(schema: z.ZodType, label: string): unknown {
  if (sampleCache.has(schema)) return structuredClone(sampleCache.get(schema));
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Json;
  const candidate = repair(schema, fromJsonSchema(json, json));
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `Não consegui gerar um exemplo válido da saída de "${label}". Passe a resposta em \`responses\`.\n` +
        `${z.prettifyError(parsed.error)}\nexemplo tentado: ${JSON.stringify(candidate)}`,
    );
  }
  sampleCache.set(schema, candidate);
  return structuredClone(candidate);
}

// ---------------------------------------------------------------------------------------------------------------

function resolveOperation(path: string): { operation: OperationName | "context"; routeModule: string | null; query: URLSearchParams } {
  const [pathname = "", search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  if (pathname === "/context") return { operation: "context", routeModule: null, query };
  const m = /^\/([a-z-]+)\/([a-z_.]+)$/.exec(pathname);
  if (!m) throw new Error(`Rota fora do padrão /<módulo>/<operação>: ${path}`);
  const [, routeModule = "", route = ""] = m;
  const operation = ROUTE_ALIAS[`${routeModule}/${route}`] ?? (route as OperationName);
  if (!Object.hasOwn(OPERATIONS, operation)) throw new Error(`Operação "${route}" (rota ${path}) não está no registro de contratos.`);
  return { operation, routeModule, query };
}

/**
 * `call` falso para montar a porta. Confere cada chamada com o registro na hora, guarda o que foi chamado e
 * devolve um exemplo válido da saída.
 */
export function contractCall(module: ModuleId, options: HarnessOptions = {}) {
  const calls: RecordedCall[] = [];
  const allowedModules = new Set<string>([module, ...(options.alsoReads ?? [])]);
  const tenantMode = options.tenant ?? "required";

  async function call(path: string, schema: z.ZodType, opts: CallOptions = {}) {
    const method = opts.method ?? "GET";
    const { operation, routeModule, query } = resolveOperation(path);
    const where = `${method} ${path}`;

    const flip = options.tenantExceptions?.includes(operation) ?? false;
    if ((tenantMode === "required") !== flip) expect(opts.tenantId, `${where}: negócio escolhido no header`).toBe(TENANT);
    else expect(opts.tenantId, `${where}: porta sem negócio não manda o header de negócio`).toBeUndefined();

    let output: z.ZodType;
    if (operation === "context") {
      expect(method, `${where}: /context é GET`).toBe("GET");
      expect(opts.idempotencyKey, `${where}: consulta não leva Idempotency-Key`).toBeUndefined();
      output = ContextResponse;
    } else {
      const spec = OPERATIONS[operation];
      expect(routeModule, `${where}: "${operation}" é do módulo ${spec.module}`).toBe(spec.module);
      expect(allowedModules.has(spec.module), `${where}: a porta de ${module} não declara que lê ${spec.module} (alsoReads)`).toBe(true);
      if (spec.module !== module) expect(spec.kind, `${where}: porta de ${module} só consulta outro módulo, não comanda`).toBe("query");
      output = spec.output;

      if (method === "POST") {
        const parsed = spec.input.safeParse(opts.body);
        expect(parsed.success, `${where}: corpo recusado pelo contrato de entrada\n${parsed.success ? "" : z.prettifyError(parsed.error)}\ncorpo: ${JSON.stringify(opts.body)}`).toBe(true);
      } else {
        // GET com query: os nomes dos parâmetros têm de existir na entrada do contrato (os valores chegam como texto).
        expect(spec.kind, `${where}: só consulta usa GET`).toBe("query");
        expect(opts.body, `${where}: GET não leva corpo`).toBeUndefined();
        const shape = (spec.input as unknown as { shape?: Record<string, unknown> }).shape ?? {};
        for (const name of query.keys()) expect(Object.keys(shape), `${where}: parâmetro "${name}" não existe na entrada de ${operation}`).toContain(name);
      }

      if (spec.idempotent) {
        expect(opts.idempotencyKey, `${where}: comando sem Idempotency-Key`).toEqual(expect.any(String));
        expect(JSON.stringify(opts.body ?? {}), `${where}: a chave vai no header, não no corpo`).not.toContain(opts.idempotencyKey as string);
      } else {
        expect(opts.idempotencyKey, `${where}: consulta não leva Idempotency-Key`).toBeUndefined();
      }
    }
    expect(schema === output, `${where}: o schema de saída passado ao cliente não é o do registro de "${operation}"`).toBe(true);

    calls.push({ path, operation, method, tenantId: opts.tenantId, body: opts.body, idempotencyKey: opts.idempotencyKey });

    const given = options.responses?.[operation];
    const candidate = given === undefined ? sampleOf(output, operation) : typeof given === "function" ? (given as (b: unknown) => unknown)(opts.body) : given;
    const data = output.safeParse(candidate);
    if (!data.success) throw new Error(`Resposta de exemplo de "${operation}" fora do contrato:\n${z.prettifyError(data.error)}`);
    return { data: data.data, meta: META };
  }

  return { call: call as never, calls };
}

/** Chave que cada caso passa à porta: única por caso, para conferir que a porta não troca nem inventa chave. */
export function testKey(n: number): string {
  return `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
}

type AnyPort = Record<string, unknown>;
export type PortCases<P> = {
  [K in keyof P as P[K] extends (...args: never[]) => unknown ? K : never]: (port: P, key: string) => unknown;
};

/**
 * Exercita a porta inteira. `cases` tem uma entrada por método da porta (o tipo cobra todas): cada caso chama o
 * método com dados de exemplo e a chave recebida. O arreio confere, além do que `contractCall` já confere:
 *   - todo método da porta tem caso (método novo sem caso falha);
 *   - quando o caso manda comando, a chave que chega ao servidor é a que o caso passou.
 * Devolve as chamadas por método, para o teste do módulo conferir o que for específico.
 */
export async function exercisePort<P extends object>(
  module: ModuleId,
  build: (call: never) => P,
  cases: PortCases<P>,
  options: HarnessOptions = {},
): Promise<Record<string, RecordedCall[]>> {
  const { call, calls } = contractCall(module, options);
  const port = build(call);
  const methods = Object.keys(port).filter((k) => typeof (port as AnyPort)[k] === "function").sort();
  expect(Object.keys(cases).sort(), "um caso por método da porta").toEqual(methods);

  const byMethod: Record<string, RecordedCall[]> = {};
  let n = 0;
  for (const name of methods) {
    const key = testKey((n += 1));
    const before = calls.length;
    await (cases as Record<string, (port: P, key: string) => unknown>)[name]!(port, key);
    const made = calls.slice(before);
    byMethod[name] = made;
    for (const c of made) {
      if (c.idempotencyKey !== undefined) expect(c.idempotencyKey, `${name} → ${c.path}: a porta mandou outra chave`).toBe(key);
    }
  }
  return byMethod;
}

/** Operações do registro, por módulo, que nenhuma chamada usou: para o teste listar o que a tela ainda não alcança. */
export function unusedOperations(module: ModuleId, byMethod: Record<string, RecordedCall[]>): OperationName[] {
  const used = new Set(Object.values(byMethod).flat().map((c) => c.operation));
  return (Object.keys(OPERATIONS) as OperationName[]).filter((name) => OPERATIONS[name].module === module && !used.has(name)).sort();
}

// Valida a suíte de avaliação do assistente contra os contratos v1 e o mundo de fixtures.
// Uso: node tests/agent-evals/validate.ts   (Node 22 remove os tipos sozinho; sem dependência nova)
// Não avalia o agente: garante que os casos são coerentes para o P08 executar.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { AgentTool, AgentUiState } from "../../supabase/functions/_shared/contracts/agent.ts";

const here = new URL(".", import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, here), "utf8"));

const CATEGORIES = [
  "consulta",
  "ambiguidade",
  "sem_dados",
  "prompt_injection",
  "troca_tenant",
  "cota",
  "aprovacao_duplicada",
] as const;
// docs/03_CONTRATOS.md: códigos de erro do envelope.
const ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SLOT_CONFLICT",
  "STALE_VERSION",
  "IDEMPOTENCY_MISMATCH",
  "POLICY_REJECTED",
  "QUOTA_EXCEEDED",
  "PROVIDER_UNAVAILABLE",
] as const;
const OPS = ["agent.ask", "action.approve", "action.execute", "fixture.insert_booking", "parallel"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const Regexes = z.array(z.string()).optional();
const Expectation = z
  .object({
    http_status: z.int().optional(),
    error_code: z.enum(ERROR_CODES).optional(),
    state: AgentUiState.optional(),
    proposal: z
      .object({ tool: AgentTool, approval_state: z.literal("pending"), summary_must_match: Regexes })
      .loose()
      .nullable()
      .optional(),
    tools_allowed: z.array(AgentTool).optional(),
    tools_forbidden: z.array(AgentTool).optional(),
    tool_args: z.record(AgentTool, z.unknown()).optional(),
    text_must_match: Regexes,
    text_must_not_match: Regexes,
    must_not_leak: z.enum(["tenant_B_from_A", "secrets"]).optional(),
    alternatives: z.array(z.object({ error_code: z.enum(ERROR_CODES).optional(), state: AgentUiState.optional() }).loose()).optional(),
  })
  .loose();

const Step: z.ZodType = z.lazy(() =>
  z
    .object({
      op: z.enum(OPS),
      tenant: z.enum(["A", "B"]).optional(),
      input: z.record(z.string(), z.unknown()).optional(),
      branches: z.array(z.array(Step)).optional(),
      expect: Expectation.optional(),
    })
    .loose(),
);

const Case = z.object({
  id: z.string().regex(/^AE-\d{2}$/),
  category: z.enum(CATEGORIES),
  title: z.string().min(5),
  refs: z.array(z.string()).min(1),
  severity: z.enum(["blocker", "major"]),
  setup: z.object({ actor: z.string(), tenant: z.enum(["A", "B"]) }).loose(),
  steps: z.array(Step).min(1),
  expected: Expectation.extend({ side_effects: z.record(z.string(), z.int().min(0)) }),
  notes: z.string(),
});
const Suite = z.object({ schema_version: z.literal(1), cases: z.array(Case) });

const PATTERN_KEYS = new Set(["text_must_match", "text_must_not_match", "summary_must_match"]);
function collectPatterns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectPatterns);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => (PATTERN_KEYS.has(k) && Array.isArray(v) ? (v as string[]) : collectPatterns(v)));
}

const fixtures = read("fixtures.json") as { actors: Record<string, unknown>; leak_markers: Record<string, string[]> };
const suite = Suite.parse(read("cases.json"));
const problems: string[] = [];
const fail = (id: string, msg: string) => problems.push(`${id}: ${msg}`);

if (suite.cases.length !== 40) problems.push(`esperados 40 casos, há ${suite.cases.length}`);
const ids = new Set<string>();
for (const c of suite.cases) {
  if (ids.has(c.id)) fail(c.id, "id repetido");
  ids.add(c.id);
  if (!(c.setup.actor in fixtures.actors)) fail(c.id, `ator desconhecido ${c.setup.actor}`);
  if (c.expected.must_not_leak && !(c.expected.must_not_leak in fixtures.leak_markers)) fail(c.id, "marcador de vazamento desconhecido");

  // Toda string que parece UUID precisa ser UUID válido (evita IDs que o contrato rejeitaria).
  const raw = JSON.stringify(c);
  for (const m of raw.matchAll(/"([0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12})"/g)) {
    if (!UUID.test(m[1]!)) fail(c.id, `UUID inválido ${m[1]}`);
  }
  // Regex compila (avaliador usa flags "iu").
  for (const p of collectPatterns(c)) {
    try {
      new RegExp(p, "iu");
    } catch {
      fail(c.id, `regex inválida ${p}`);
    }
  }
  // Leitura nunca tem efeito colateral de escrita/mensagem.
  if (c.expected.state === "consulted" && (c.expected.side_effects.writes ?? 0) > 0) fail(c.id, "consulta com escrita");
  if ((c.expected.side_effects.messages_sent ?? 0) !== 0) fail(c.id, "nenhum caso pode enviar mensagem no piloto");
}
for (const cat of CATEGORIES) {
  const n = suite.cases.filter((c) => c.category === cat).length;
  if (n < 4) problems.push(`categoria ${cat} com ${n} casos (mínimo 4)`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${suite.cases.length} casos, ${CATEGORIES.length} categorias`);

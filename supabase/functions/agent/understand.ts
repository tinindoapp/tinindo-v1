// P46 · entendimento de pedidos livres no assistente do dono (ADR-0012 §1).
//
// 1. O motor determinístico roda primeiro sobre o texto original. Recusas (segredo, SQL, nota, dinheiro, envio, outro
//    negócio) e tudo que ele entende saem dele, sem modelo.
// 2. Só quando ele responde "não entendi" (`unknown`) e há provedor ligado, o modelo lê o pedido: nomes de clientes
//    conhecidos viram "cliente N" e telefone, e-mail e documento saem antes (dentro de `llm.extract`).
// 3. O modelo devolve só intenção e argumentos (schema fechado, sem ações proibidas). Isso vira uma frase canônica e o
//    MESMO motor roda sobre ela: mesmas ferramentas, mesma desambiguação, mesmas propostas e aprovações.
// 4. Se o motor não cair na família esperada da intenção, ou se o modelo falhar, vale a resposta determinística.
import { runAgent } from "../_shared/domain/agent/engine.ts";
import { localParts } from "../_shared/domain/agent/time.ts";
import type { AgentContext, AgentData, Directory, EngineResult } from "../_shared/domain/agent/types.ts";
import type { Llm } from "../_shared/llm/index.ts";
import { labelNames } from "../_shared/llm/redact.ts";
import { ANY_FAMILY, INTENT_FAMILIES, INTENT_SYSTEM, intentInput, LlmIntent, renderIntent } from "../_shared/llm/tasks/intent.ts";

export interface Understood {
  result: EngineResult;
  /** "none" = só o motor; "used" = a leitura do modelo virou a resposta; "discarded" = o modelo foi chamado e não serviu. */
  llm: "none" | "used" | "discarded";
}

export async function understand(text: string, ctx: AgentContext, data: AgentData, llm: Llm): Promise<Understood> {
  const first = await runAgent(text, ctx, data);
  if (!llm.enabled || first.intent !== "unknown") return { result: first, llm: "none" };

  // Diretório lido uma vez por pergunta (rótulos dos nomes + motor).
  let dir: Promise<Directory> | null = null;
  const cached: AgentData = { ...data, directory: () => (dir ??= data.directory()) };
  let names: string[];
  try {
    names = (await cached.directory()).customers.map((c) => c.name);
  } catch {
    return { result: first, llm: "none" };
  }
  const labeled = labelNames(text, names);
  const read = await llm.extract({
    task: "intent",
    system: INTENT_SYSTEM,
    input: intentInput(labeled.text, localParts(ctx.now, ctx.tenant.timezone).date),
    schema: LlmIntent,
    maxOutputTokens: 400,
  });
  if (!read || read.intent === "other") return { result: first, llm: "discarded" };
  const phrase = renderIntent(read, labeled.labels);
  if (!phrase) return { result: first, llm: "discarded" };
  const second = await runAgent(phrase, ctx, cached);
  const family: readonly string[] = [...INTENT_FAMILIES[read.intent], ...ANY_FAMILY];
  if (!family.includes(second.intent)) return { result: first, llm: "discarded" };
  return { result: second, llm: "used" };
}

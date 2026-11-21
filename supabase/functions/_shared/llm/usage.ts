// Uso por negócio (T11). O registro técnico `fn: "llm"` não leva tenant de propósito (P46); quem sabe o negócio é a
// função que chama o modelo. `withUsage` devolve o mesmo `Llm` com um medidor: cada tentativa (inclusive a de reserva)
// entrega ao `sink` a tarefa, os tokens e o custo estimado, e a função grava com `agent_llm_record` no negócio da
// requisição. Só números; nunca texto do pedido, da resposta ou do sistema.
import type { ExtractRequest, Llm, LlmUsage } from "./types.ts";

/** O mesmo `Llm`, com cada tentativa entregue ao `sink`. Com `none` devolve o próprio `llm` (nada a medir). */
export function withUsage(llm: Llm, sink: (u: LlmUsage) => void): Llm {
  if (!llm.enabled) return llm;
  return {
    enabled: true,
    extract<T>(req: ExtractRequest<T>): Promise<T | null> {
      return llm.extract({
        ...req,
        onUsage: (u) => {
          sink(u);
          req.onUsage?.(u);
        },
      });
    },
  };
}

// Padrão (`LLM_PROVIDER=none` ou ausente): nenhuma rede, `extract` devolve null e o fluxo determinístico segue igual.
import type { Llm } from "../types.ts";

export const noneLlm: Llm = {
  enabled: false,
  extract: () => Promise.resolve(null),
};

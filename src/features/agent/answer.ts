// Resposta do assistente em camadas (item 57 da auditoria): o valor em destaque na primeira linha, a frase principal,
// as linhas da lista (agenda) e as ressalvas recolhidas em "Detalhes". Só reorganiza o texto do servidor: nada é
// cortado, tudo continua na tela (as ressalvas a um toque).

const MONEY = /R\$\s?[\d.]+,\d{2}/;
const PERCENT = /\b\d{1,3}(?:,\d+)?\s?%/;
// Fim de frase: ponto (ou ! ?) seguido de espaço e letra maiúscula, aspas ou parêntese. "R$ 1.740,00" não quebra.
const SENTENCE = /(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ"“(])/u;

export interface AnswerParts {
  /** Valor em destaque (o primeiro R$ ou % da frase principal), ou null. */
  value: string | null;
  /** Primeira frase: o que a pessoa perguntou, respondido. */
  lead: string;
  /** Linhas de lista ("• 09:00 Corte — Ana"), sem o marcador. */
  items: string[];
  /** Ressalvas e contexto: cobertura dos dados, horário da atualização, o que não está incluído. */
  details: string[];
}

export function splitAnswer(text: string): AnswerParts {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const [first = "", ...rest] = lines;
  const [lead = "", ...more] = first.split(SENTENCE);
  const items: string[] = [];
  const details: string[] = [...more];
  for (const l of rest) {
    if (l.startsWith("•")) items.push(l.replace(/^•\s*/, ""));
    else details.push(...l.split(SENTENCE));
  }
  const value = MONEY.exec(lead)?.[0] ?? PERCENT.exec(lead)?.[0] ?? null;
  return { value: value?.replace(/\s/g, " ") ?? null, lead, items, details };
}

const VERB: Record<string, string> = {
  "booking.create": "agendar", "booking.reschedule": "remarcar", "booking.cancel": "cancelar", "pricing.propose_rule": "criar a regra",
};

/** Texto do botão de um passo: o verbo e o valor da proposta ("Aprovar e agendar · R$ 60,00"). */
export function approveLabel(tool: string, summary: string): string {
  const money = MONEY.exec(summary)?.[0]?.replace(/\s/g, " ");
  return `Aprovar e ${VERB[tool] ?? "fazer"}${money ? ` · ${money}` : ""}`;
}

// Textos do módulo Campanhas. Resultado por braço com intervalo; o veredito nunca afirma causa fora do desenho.
import type { Campaign, CampaignOffer, CampaignSegment } from "@contracts";

import { errorExplainer } from "../../lib/errors.ts";
import { formatDayMonth } from "../../lib/time.ts";

export { formatCents } from "../../lib/money.ts";
/** "20/10". Fuso padrão embutido mantido até a parte 2 (origem do fuso do negócio). */
export const formatDate = (v: string, timeZone = "America/Sao_Paulo") => formatDayMonth(v, timeZone);
export const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
export const ci = (c: [number, number]) => `${Math.round(c[0] * 100)}% a ${Math.round(c[1] * 100)}%`;
export const segmentLabel = (s: CampaignSegment) =>
  s.kind === "inactive_days" ? `sem atendimento há ${s.days} dias` : s.kind === "credit_remaining" ? "com sessões sobrando no pacote" : "todas com consentimento de marketing";
export const offerLabel = (o: CampaignOffer) =>
  o.kind === "none" ? "sem oferta" : o.kind === "discount_pct" ? `${o.pct}% de desconto` : "regra de preço vigente";
export const STATUS: Record<Campaign["status"], string> = { running: "Em curso", closed: "Encerrada", cancelled: "Cancelada" };
export const DESIGN: Record<Campaign["result"]["design"], string> = { randomized_control: "com grupo de controle sorteado", observational: "sem grupo de controle (observação)" };
export const VERDICT: Record<Campaign["result"]["verdict"], string> = {
  difference_detected: "Diferença detectada entre os grupos (o intervalo não inclui zero).",
  no_difference_detected: "Nenhuma diferença detectada (o intervalo inclui zero): não dá para afirmar efeito.",
  inconclusive: "Inconclusivo: grupos pequenos demais para comparar.",
  observation_only: "Só observação: sem grupo de controle, o resultado não mede efeito da campanha.",
};
export const explain = errorExplainer({
  "STALE_VERSION.audience_hash": "O público mudou desde a prévia. Atualizamos: confira e aprove de novo.",
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  "POLICY_REJECTED.audience": "Nenhuma cliente elegível neste segmento agora.",
  "POLICY_REJECTED.spend_cap": "O teto de gasto não cobre nem uma oferta. Aumente o teto ou reduza a oferta.",
  "POLICY_REJECTED.status": "Esta campanha já não está em curso.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  VALIDATION_ERROR: "Confira os campos: janela 7–60 dias, controle 0–50%, envios 1–500, desconto 5–50%.",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio acessa as campanhas.",
});

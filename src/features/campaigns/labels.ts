// Textos do módulo Campanhas. Resultado por braço com intervalo; o veredito nunca afirma causa fora do desenho.
import type { Campaign, CampaignOffer, CampaignSegment } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatDate = (v: string, timeZone = "America/Sao_Paulo") =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(new Date(v));
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
export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "STALE_VERSION":
      return e.field === "audience_hash" ? "O público mudou desde a prévia. Atualizamos: confira e aprove de novo." : "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "POLICY_REJECTED":
      if (e.field === "audience") return "Nenhuma cliente elegível neste segmento agora.";
      if (e.field === "spend_cap") return "O teto de gasto não cobre nem uma oferta. Aumente o teto ou reduza a oferta.";
      if (e.field === "status") return "Esta campanha já não está em curso.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      return "Confira os campos: janela 7–60 dias, controle 0–50%, envios 1–500, desconto 5–50%.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa as campanhas.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}

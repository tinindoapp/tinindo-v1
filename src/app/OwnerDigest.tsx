// P45: resumo semanal por modelo fixo na caixa de Mensagens do dono. O app liga os dois módulos (Metas e sugestões
// fornece o cartão; Mensagens reserva o lugar), porque um módulo não importa outro.
import { WeeklyDigestCard } from "../features/growth-advice/Insights.tsx";
import { useGrowthAdvicePort } from "../features/growth-advice/module.tsx";

export function OwnerDigest() {
  const port = useGrowthAdvicePort();
  return port ? <WeeklyDigestCard port={port} compact /> : null;
}

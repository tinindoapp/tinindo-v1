// P45: resumo semanal por modelo fixo na caixa de Mensagens do dono. O app liga os dois módulos (Metas e sugestões
// fornece o cartão; Mensagens reserva o lugar), porque um módulo não importa outro. Com "Metas e sugestões" desligado
// (nasce assim no piloto, P51), não monta: o servidor recusaria com 403 (trava de módulo).
import { WeeklyDigestCard } from "../features/growth-advice/Insights.tsx";
import { useGrowthAdvicePort } from "../features/growth-advice/module.tsx";
import { useScope } from "./scope.tsx";

export function OwnerDigest() {
  const scope = useScope();
  return scope.isVisible("growth-advice") ? <DigestCard /> : null;
}

function DigestCard() {
  const port = useGrowthAdvicePort();
  return port ? <WeeklyDigestCard port={port} compact /> : null;
}

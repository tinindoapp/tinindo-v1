import { Card, StatusBanner } from "../../components/ui/index.tsx";

/** Tela provisória de um módulo ainda não implementado. Não simula funcionalidade. */
export function ModulePlaceholder({ title, owner, summary }: { title: string; owner: string; summary: string }) {
  return (
    <Card aria-labelledby="module-title">
      <p className="tn-caps">Pacote {owner}</p>
      <h1 id="module-title">{title}</h1>
      <p>{summary}</p>
      <StatusBanner tone="info">
        <strong>Em construção.</strong> Esta área ainda não guarda nem altera dados.
      </StatusBanner>
    </Card>
  );
}

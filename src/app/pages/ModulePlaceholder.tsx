import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";

/** Tela provisória de um módulo ainda não implementado. Não simula funcionalidade. */
export function ModulePlaceholder({ title, owner, summary }: { title: string; owner: string; summary: string }) {
  return (
    <div className="tn-stack">
      <PageHeader title={title} id="module-title" eyebrow={`Pacote ${owner}`} subtitle={summary} />
      <StatusBanner tone="info">
        <strong>Em construção.</strong> Esta área ainda não guarda nem altera dados.
      </StatusBanner>
    </div>
  );
}

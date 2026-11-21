// P32 bloco 1 · o negócio liga ou desliga a medição de uso do app. Desligar apaga o que já foi medido.
import { useEffect, useState } from "react";
import { Button, Card, ConfirmAction, StatusBanner, toast } from "../../components/ui/index.tsx";
import { errorExplainer } from "../../lib/errors.ts";
import { newIdempotencyKey } from "../../lib/idempotency.ts";
import type { UsagePort, UsageSettings } from "./usagePort.ts";

const explain = errorExplainer({
  FORBIDDEN: "Só quem é do negócio vê esta configuração.",
  STALE_VERSION: "A configuração mudou em outra aba. Recarregamos: confira e tente de novo.",
  default: "Não foi possível agora. Tentar de novo é seguro.",
});

export function UsageSettingsCard({ port }: { port: UsagePort }) {
  const [settings, setSettings] = useState<UsageSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    port.settings().then((s) => alive && setSettings(s), (e: unknown) => alive && setError(explain(e)));
    return () => {
      alive = false;
    };
  }, [port]);

  async function set(enabled: boolean) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const next = await port.set(enabled, settings.version, newIdempotencyKey());
      setSettings(next);
      toast(enabled ? "Medição de uso ligada." : "Medição de uso desligada. O que já tinha sido medido foi apagado.");
    } catch (e) {
      setError(explain(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card aria-labelledby="an-usage-title">
      <h2 id="an-usage-title">Medição de uso do app</h2>
      <p className="tn-muted">
        Para melhorar a Tinindo no piloto, o app anota quais telas você abre e se cada ação deu certo ou foi recusada.
        Nunca anota nome, telefone, valor nem o que você digita. Fica guardado por {settings?.retention_days ?? 30} dias.
      </p>
      {port.kind === "demo" ? <p className="tn-muted">Na demonstração nada é medido nem enviado.</p> : null}
      {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
      {!settings ? (
        error ? null : <p role="status">Carregando…</p>
      ) : settings.enabled ? (
        <>
          <p><strong>Ligada.</strong></p>
          <ConfirmAction
            trigger="Desligar a medição"
            triggerVariant="secondary"
            title="Desligar a medição de uso?"
            consequence="O app para de anotar o uso deste negócio e apaga o que já foi anotado. Dá para ligar de novo depois."
            confirmLabel="Sim, desligar"
            onConfirm={() => set(false)}
            disabled={saving}
          />
        </>
      ) : (
        <>
          <p><strong>Desligada.</strong> Nada do uso deste negócio é anotado.</p>
          <Button variant="secondary" loading={saving} onClick={() => void set(true)}>Ligar a medição</Button>
        </>
      )}
    </Card>
  );
}

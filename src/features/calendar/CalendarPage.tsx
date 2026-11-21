// "Calendário e avisos" (P34/P35): o que chega no celular do profissional e, no item 4, a agenda no calendário dele.
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import type { PushPort } from "../../app/pwa/push-client.ts";
import { type PushEnv, PushSettings } from "../../app/pwa/PushSettings.tsx";

export function CalendarPage({ push, pushEnv }: { push: PushPort | null; pushEnv: PushEnv }) {
  return (
    <div className="tn-stack" data-gap="lg">
      <div className="tn-page-intro">
        <PageHeader id="cal-title" title="Calendário e avisos" subtitle="O que chega no seu celular e a sua agenda no calendário que você já usa." />
      </div>
      {push ? <PushSettings port={push} env={pushEnv} /> : <StatusBanner tone="info">Selecione um negócio para ligar os avisos.</StatusBanner>}
    </div>
  );
}

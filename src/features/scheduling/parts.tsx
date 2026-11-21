// Peças visuais do módulo de agenda. Estado nunca só por cor: ícone + texto.
import { createContext, type ReactNode, useContext } from "react";
import type { Booking, TimeRange } from "@contracts";
import { Button, StatusBadge as KitStatusBadge, StatusBanner } from "../../components/ui/index.tsx";
import { DEMO_CANCELLATION_POLICY } from "./demoData.ts";
import { listStatus, STATUS_LABEL, STATUS_TONE } from "./agenda.ts";
import { explainError, type ErrorExplanation } from "./errors.ts";
import { deviceZoneDiffers, formatUtcOffset, friendlyZone } from "./time.ts";

/** Selo de estado do atendimento: o selo do kit com o mapa da D15 (concluído verde, confirmado neutro), o mesmo da Hoje. */
export function StatusBadge({ status }: { status: Booking["status"] }) {
  // `tn-sched-badge` fica como invólucro sem caixa (display: contents): é o seletor dos e2e da Agenda e da homologação.
  return (
    <span className="tn-sched-badge">
      <KitStatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</KitStatusBadge>
    </span>
  );
}

/** Selo nas listas (Hoje e Agenda): só as exceções; "Confirmado" é o normal e não leva selo (item 30). */
export function ListStatusBadge({ status }: { status: Booking["status"] }) {
  return listStatus(status) ? <StatusBadge status={status} /> : null;
}

/**
 * P54 (parte 2): o fuso vira a linha de apoio da abertura da tela, só quando o aparelho está noutro fuso
 * ("Horários de Brasília (UTC−03:00)"). null quando o aparelho já está no fuso do negócio.
 */
export function zoneLine(timezone: string, at: string | Date): string | null {
  if (!deviceZoneDiffers(at, timezone)) return null;
  return `Horários ${friendlyZone(at, timezone)} (${formatUtcOffset(at, timezone)})`;
}

export function PolicyNote({ demo }: { demo: boolean }) {
  return (
    <div className="tn-sched-policy">
      <h3>Política de cancelamento{demo ? " (exemplo)" : ""}</h3>
      <p>{DEMO_CANCELLATION_POLICY.text}</p>
    </div>
  );
}

const ACTION_LABEL: Record<ErrorExplanation["action"], string | null> = {
  choose_another_slot: null,
  reload: "Recarregar dados",
  retry: "Tentar de novo",
  new_quote: "Pedir novo valor",
  none: null,
};

export function ErrorPanel({
  error,
  operation,
  onRetry,
}: {
  error: unknown;
  operation: Parameters<typeof explainError>[1];
  onRetry?: () => void;
}) {
  const e = explainError(error, operation);
  const label = ACTION_LABEL[e.action];
  return (
    <div className="tn-sched-error">
      <StatusBanner tone="danger">
        <strong className="tn-sched-error__title">{e.title}</strong>
        <span className="tn-sched-error__body">{e.body}</span>
      </StatusBanner>
      {label && onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Ganchos para oferta de horário (P05) e lista de espera (P07). Os módulos não se importam:
 * o integrador pode envolver a agenda com este provider para mostrar ações em horários livres.
 */
export interface SchedulingExtensions {
  freeSlotActions?: (slot: TimeRange) => ReactNode;
}

const ExtensionsContext = createContext<SchedulingExtensions>({});
export const SchedulingExtensionsProvider = ExtensionsContext.Provider;
export const useSchedulingExtensions = () => useContext(ExtensionsContext);

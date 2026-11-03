// Peças visuais do módulo de agenda. Estado nunca só por cor: ícone + texto.
import { createContext, type ReactNode, useContext } from "react";
import type { Booking, TimeRange } from "@contracts";
import { Button, Help, StatusBanner } from "../../components/ui/index.tsx";
import { DEMO_CANCELLATION_POLICY } from "./demoData.ts";
import { listStatus, STATUS_LABEL, STATUS_TONE } from "./agenda.ts";
import { explainError, type ErrorExplanation } from "./errors.ts";
import { deviceZoneDiffers, formatUtcOffset, friendlyZone } from "./time.ts";

const ICON_PATH: Record<string, string> = {
  success: "M4.5 8.2l2.2 2.2 4.8-4.9",
  warning: "M8 4.5v4M8 11v.5",
  info: "M8 7.5v4M8 5v.5",
  danger: "M5.5 5.5l5 5M10.5 5.5l-5 5",
  neutral: "M5 8h6",
};

export function StatusBadge({ status }: { status: Booking["status"] }) {
  const tone = STATUS_TONE[status];
  return (
    <span className="tn-sched-badge" data-tone={tone}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d={ICON_PATH[tone]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Selo nas listas (Hoje e Agenda): só as exceções; "Confirmado" é o normal e não leva selo (item 30). */
export function ListStatusBadge({ status }: { status: Booking["status"] }) {
  return listStatus(status) ? <StatusBadge status={status} /> : null;
}

/**
 * Avisos da tela numa linha só (auditoria de UX, itens 19 e 34): "Dados de exemplo" na demonstração e o fuso, só quando o
 * aparelho está noutro fuso ("Horários de Brasília"). A explicação longa fica recolhida em "Como funciona".
 * A faixa global "Demonstração" do shell continua; esta linha diz o que vale nesta tela.
 */
export function ScreenNotes({ demo, timezone, at }: { demo: boolean; timezone: string; at: string | Date }) {
  const otherZone = deviceZoneDiffers(at, timezone);
  if (!demo && !otherZone) return null;
  const zone = friendlyZone(at, timezone);
  return (
    <div className="tn-sched-notes">
      <p className="tn-sched-notes__line">
        {demo ? (
          <>
            <strong>Dados de exemplo.</strong> As mudanças valem só nesta aba.
          </>
        ) : null}
        {demo && otherZone ? " · " : null}
        {otherZone ? (
          <span className="tn-num">
            Horários {zone} ({formatUtcOffset(at, timezone)})
          </span>
        ) : null}
      </p>
      <Help>
        {demo ? (
          <p>
            Esta é uma demonstração sem servidor: a tela ainda não guarda nem altera dados no servidor. O que você muda vale
            só nesta aba e volta ao exemplo inicial quando a página é recarregada.
          </p>
        ) : null}
        {otherZone ? (
          <p>
            Os horários seguem o fuso do negócio ({zone.replace(/^d[aeo]s? (fuso de )?/, "")}), não o do seu aparelho, que
            está em outro fuso.
          </p>
        ) : null}
      </Help>
    </div>
  );
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

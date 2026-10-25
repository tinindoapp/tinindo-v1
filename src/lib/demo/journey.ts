// Ponte da DEMONSTRAÇÃO offline entre módulos (dono: integrador). Cada módulo emula o próprio backend na aba; aqui passa
// só o que no servidor é um fato compartilhado: o atendimento concluído na Agenda (que o Caixa cobra e o cliente avalia),
// o endereço do perfil publicado e o resumo das avaliações. Concluir NÃO gera cobrança nem recebimento: o Caixa só passa a
// listar o atendimento como "sem cobrança". Nada persiste além da aba e nada daqui é usado com servidor.

/** Atendimento concluído na agenda da demonstração (mesmos campos que o Caixa precisa para cobrar). */
export interface DemoCompletedVisit {
  booking_id: string;
  customer_id: string | null;
  service_id: string;
  starts_at: string;
  ends_at: string;
  agreed_price_cents: number;
  /** Evento de conclusão: o consumo de pacote é único por evento, como no banco. */
  completed_event_id: string;
}

interface ReviewSummary {
  reviews_count: number;
  identity_verified: boolean;
}

const visits = new Map<string, DemoCompletedVisit>();
let publishedSlug: string | null = null;
let reviewSummary: (() => ReviewSummary) | null = null;

/** Registra a conclusão uma vez por atendimento (repetir não duplica nem altera o registro). */
export function publishCompletedVisit(visit: DemoCompletedVisit): void {
  if (!visits.has(visit.booking_id)) visits.set(visit.booking_id, { ...visit });
}

export function completedVisits(): DemoCompletedVisit[] {
  return [...visits.values()].map((v) => ({ ...v }));
}

/** Evento de conclusão determinístico a partir do atendimento (prefixo próprio, sem colidir com os exemplos do Caixa). */
export function completionEventId(bookingId: string): string {
  return `65100000-0000-4000-8000-${bookingId.slice(-12)}`;
}

export function setPublishedSlug(slug: string | null): void {
  publishedSlug = slug;
}

export function getPublishedSlug(): string | null {
  return publishedSlug;
}

/** O módulo de Avaliações informa como calcular o resumo público; o perfil o exibe. */
export function provideReviewSummary(fn: () => ReviewSummary): void {
  reviewSummary = fn;
}

export function currentReviewSummary(): ReviewSummary | null {
  return reviewSummary ? reviewSummary() : null;
}

/** Só para testes. */
export function resetDemoJourney(): void {
  visits.clear();
  publishedSlug = null;
}

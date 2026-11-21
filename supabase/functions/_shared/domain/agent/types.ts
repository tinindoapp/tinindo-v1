// Assistente do dono (P08): formas dos dados que as ferramentas devolvem e do resultado do motor.
// O motor é determinístico: entende o pedido por regras pt-BR, consulta só pelas ferramentas e compõe o texto
// a partir dos números devolvidos. Nada aqui decide autorização: o banco decide em cada RPC.
import type { Window } from "./time.ts";

/** Ferramentas de leitura e de proposta. Mesma lista fechada do contrato `AgentTool`. */
export type ReadTool = "agenda.read" | "finance.summary" | "setup.read" | "insights.read" | "waitlist.read" | "lifecycle.read";
export type ProposalTool = "booking.create" | "booking.reschedule" | "booking.cancel" | "pricing.propose_rule";

export interface Service {
  id: string;
  name: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  base_price_cents: number;
  min_price_cents: number;
  estimated_cost_cents: number | null;
  fee_bps: number | null;
}

export interface Customer {
  id: string;
  name: string;
  declared_source: string | null;
}

export interface PriceWindow {
  weekday: number;
  local_start: string;
  local_end: string;
}

export interface PriceRule {
  service_id: string;
  rule_version: number;
  windows: PriceWindow[];
  discount_bps: number;
  max_discount_bps: number;
  target_margin_bps: number;
  valid: Window;
}

export interface Directory {
  services: Service[];
  customers: Customer[];
  customers_total: number;
  pricing_rules: PriceRule[];
  cancellation: { notice_hours: number; late_fee_bps: number | null } | null;
  /** null = sem permissão (equipe). */
  waitlist: { active: number; offered: number } | null;
  as_of: string;
}

export type BookingStatus = "held" | "confirmed" | "completed" | "no_show";

export interface AgendaBooking {
  id: string;
  service_id: string;
  customer_id: string | null;
  starts_at: string;
  ends_at: string;
  /** Faixa ocupada (com buffers). */
  occupied: Window;
  status: BookingStatus;
  agreed_price_cents: number | null;
  version: number;
}

export interface AgendaDay {
  date: string;
  open: Window[];
  blocks: { range: Window }[];
}

export interface Agenda {
  resource_id: string;
  timezone: string;
  days: AgendaDay[];
  bookings: AgendaBooking[];
  as_of: string;
}

export interface Finance {
  period: Window;
  received_cents: number;
  payments_count: number;
  spent_cents: number;
  expenses_count: number;
  supplies_cents: number;
  supplies_count: number;
  receivable_open_cents: number;
  receivable_open_count: number;
  receivable_next_due_at: string | null;
  records_count: number;
  first_record_at: string | null;
  packages: { id: string; customer_id: string; service_id: string; purchased_credits: number; remaining_credits: number }[];
  as_of: string;
}

/** Passos da configuração guiada (P44), como `setup.progress` devolve (só o que o motor usa). */
export interface SetupRead {
  progress: {
    steps: { step: string; title: string; required: boolean; done: boolean; dismissed?: boolean; link: string | null; why?: string | null }[];
    done_count: number;
    ready?: boolean;
  };
  as_of: string;
}

/** Sugestões abertas (P45) com a evidência calculada e o estado de cada regra na última rodada. */
export interface InsightsRead {
  insights: { id: string; rule_code: string; title: string; body: string; evidence: Record<string, unknown>; version: number; route: string | null }[];
  rules: { code: string; title: string; status: string | null; reason: string | null }[];
  as_of: string;
}

/** Lista de espera (P06) sem nomes nem recados. */
export interface WaitlistRead {
  by_service: { service_id: string; active: number; offered: number }[];
  open_offers: { service_id: string; starts_at: string; expires_at: string; status: string }[];
  as_of: string;
}

/** Régua de lembretes (P13) como está hoje. */
export interface LifecycleRead {
  settings: { enabled: boolean; confirmation: boolean; reminder_hours: number[]; quote_followup_days: number; receivable_reminder: boolean; reactivation_days: number; daily_budget: number };
  as_of: string;
}

/**
 * Leituras disponíveis ao motor. Cada chamada conta como uma chamada de ferramenta.
 * As quatro últimas (revisão 06/11, T8) são opcionais: sem elas (demonstração antiga, mundos de avaliação) o motor
 * responde com o que tem e diz onde ver o resto.
 */
export interface AgentData {
  directory(): Promise<Directory>;
  agenda(window: Window): Promise<Agenda>;
  finance(window: Window): Promise<Finance>;
  setup?(): Promise<SetupRead>;
  insights?(): Promise<InsightsRead>;
  waitlist?(): Promise<WaitlistRead>;
  lifecycle?(): Promise<LifecycleRead>;
}

export interface AgentContext {
  tenant: { id: string; name: string; timezone: string };
  role: "owner" | "staff";
  now: Date;
  /**
   * `ui_context` do pedido (T10): ids do que está na tela (`insight_id`, `customer_id`, `booking_id`, `service_id`).
   * Só ajuda a resolver "essa sugestão", "esse cliente"; nunca muda negócio nem papel, e todo id é conferido contra o
   * que as ferramentas do próprio negócio devolvem.
   */
  ui?: Readonly<Record<string, string>>;
}

export type AgentState = "consulted" | "recommendation" | "pending_approval" | "executed" | "failed";

export interface Source {
  kind: string;
  id: string | null;
  as_of: string;
}

export interface ProposalDraft {
  tool: ProposalTool;
  payload: Record<string, unknown>;
  summary: string;
}

export interface ToolCall {
  tool: ReadTool | ProposalTool;
  args: Record<string, unknown>;
}

export interface EngineResult {
  intent: string;
  state: AgentState;
  text: string;
  sources: Source[];
  draft: ProposalDraft | null;
  clarification: boolean;
  tool_calls: ToolCall[];
}

/** Erro de ferramenta já traduzido (ex.: FORBIDDEN para a equipe no financeiro). */
export class ToolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ToolError";
  }
}

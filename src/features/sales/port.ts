// Porta dos Orçamentos (P11). Demonstração: emulação na aba; servidor: Edge Function `sales` (+ `crm` e `context`).
import type { MaterialQuoteCostOutput, SalesQuote, SalesQuoteDecideOutput, SalesQuoteDetailOutput, SalesQuotePublicView } from "@contracts";
import type { z } from "zod";

export interface SalesBase {
  timezone: string;
  customers: { id: string; name: string }[];
  services: { id: string; name: string; duration_min: number; base_price_cents: number }[];
}

/** Conteúdo de uma versão como o dono escreve. O total é sempre recalculado no servidor. */
export interface QuoteDraft {
  customer_id: string;
  title: string;
  items: { service_id: string | null; description: string; quantity: number; unit_price_cents: number }[];
  valid_until: string;
  slot: { service_id: string; starts_at: string } | null;
  notes: string | null;
}

export type QuoteDetail = z.infer<typeof SalesQuoteDetailOutput>;
export type QuoteView = z.infer<typeof SalesQuotePublicView>;
export type QuoteDecision = z.infer<typeof SalesQuoteDecideOutput>;
/** Custo estimado de materiais da versão atual (P30): ficha do serviço × custo médio do estoque. Só leitura. */
export type QuoteMaterialCost = z.infer<typeof MaterialQuoteCostOutput>;

export interface SalesPort {
  readonly kind: "demo" | "server";
  now(): Date;
  base(): Promise<SalesBase>;
  list(): Promise<SalesQuote[]>;
  get(quoteId: string): Promise<QuoteDetail>;
  create(draft: QuoteDraft, key: string): Promise<SalesQuote>;
  /** Nova versão a partir da versão atual que o dono viu (expected_version). */
  revise(quote: SalesQuote, draft: QuoteDraft, key: string): Promise<SalesQuote>;
  /** Gera o link. O token vem só nesta resposta; gerar de novo invalida o anterior. */
  send(quote: SalesQuote, key: string): Promise<{ quote: SalesQuote; token: string | null }>;
  cancel(quoteId: string, key: string): Promise<SalesQuote>;
  /** Custo de materiais e margem estimada da versão atual (P30). Não muda o orçamento. */
  materialCost(quoteId: string): Promise<QuoteMaterialCost>;
}

/** Link do cliente (anônimo): ver não muda nada; aceitar e recusar citam a versão e o hash vistos. */
export interface QuoteLinkPort {
  readonly kind: "demo" | "server";
  view(token: string): Promise<QuoteView>;
  accept(token: string, view: QuoteView, key: string): Promise<QuoteDecision>;
  decline(token: string, view: QuoteView, key: string): Promise<QuoteDecision>;
}

export const newKey = () => crypto.randomUUID();

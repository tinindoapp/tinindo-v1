// Edge Function `pricing` (P05): cotação, proposta, aprovação, publicação e leitura de regras de preço.
// Cada operação é uma RPC transacional do dono (ver _shared/http/rpc-handler.ts). Cálculo no banco, em inteiros.
import {
  ActionApproval,
  PricingApproveRuleInput,
  PricingDeactivateRuleInput,
  PricingListRulesInput,
  PricingListRulesOutput,
  PricingProposeRuleInput,
  PricingPublishRuleInput,
  PricingQuoteInput,
  PricingRuleOutput,
  PricingRuleProposal,
  Quote,
} from "../_shared/contracts/index.ts";
import { createRpcHandler, type Route, route, type RpcHandlerDeps } from "../_shared/http/rpc-handler.ts";

export type PricingDeps = RpcHandlerDeps;

export const PRICING_ROUTES: Record<string, Route> = {
  "pricing.quote": route({
    rpc: "pricing_quote", input: PricingQuoteInput, output: Quote, command: false,
    args: (i) => ({ p_service_id: i.service_id, p_resource_id: i.resource_id, p_starts_at: i.slot.starts_at, p_ends_at: i.slot.ends_at }),
  }),
  "pricing.propose_rule": route({
    rpc: "pricing_propose_rule", input: PricingProposeRuleInput, output: PricingRuleProposal, command: true,
    args: (i) => ({
      p_service_id: i.service_id, p_windows: i.windows, p_discount_bps: i.discount_bps, p_max_discount_bps: i.max_discount_bps,
      p_target_margin_bps: i.target_margin_bps, p_valid_from: i.valid.starts_at, p_valid_to: i.valid.ends_at,
    }),
  }),
  "pricing.approve_rule": route({
    rpc: "pricing_approve_rule", input: PricingApproveRuleInput, output: ActionApproval, command: true,
    args: (i) => ({ p_proposal_id: i.proposal_id, p_payload_hash: i.payload_hash, p_expected_version: i.expected_version }),
  }),
  "pricing.publish_rule": route({
    rpc: "pricing_publish_rule", input: PricingPublishRuleInput, output: PricingRuleOutput, command: true,
    args: (i) => ({ p_proposal_id: i.proposal_id, p_approval_id: i.approval_id, p_expected_version: i.expected_version }),
  }),
  "pricing.deactivate_rule": route({
    rpc: "pricing_deactivate_rule", input: PricingDeactivateRuleInput, output: PricingRuleOutput, command: true,
    args: (i) => ({ p_rule_id: i.rule_id, p_expected_version: i.expected_version }),
  }),
  "pricing.list_rules": route({
    rpc: "pricing_list_rules", input: PricingListRulesInput, output: PricingListRulesOutput, command: false,
    args: () => ({}),
  }),
};

export const createPricingHandler = (deps: PricingDeps) => createRpcHandler("pricing", PRICING_ROUTES, deps);

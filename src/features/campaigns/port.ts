// Portas do módulo Campanhas (P19). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `campaigns`.
import type { Campaign, CampaignApproveInput, CampaignGetOutput, CampaignOffer, CampaignPreviewOutput, CampaignSegment } from "@contracts";
import type { z } from "zod";

export type ApproveInput = z.input<typeof CampaignApproveInput>;
export type Preview = z.infer<typeof CampaignPreviewOutput>;
export type CampaignDetail = z.infer<typeof CampaignGetOutput>;
export type { Campaign, CampaignOffer, CampaignSegment };

export interface CampaignsPort {
  readonly kind: "demo" | "server";
  services(): Promise<{ id: string; name: string }[]>;
  preview(segment: CampaignSegment): Promise<Preview>;
  approve(input: ApproveInput, key: string): Promise<Campaign>;
  list(): Promise<Campaign[]>;
  get(campaignId: string): Promise<CampaignDetail>;
  cancel(campaign: Campaign, key: string): Promise<Campaign>;
  /** Só na demonstração: parte das tratadas agenda (medido) e a janela fecha pelo worker. */
  simulate?(campaignId: string): Promise<Campaign>;
}

export const newKey = () => crypto.randomUUID();

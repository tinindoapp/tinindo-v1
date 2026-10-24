// Portas do módulo Notas fiscais (P16). Demonstração: emulação na aba, sempre rotulada (homologação simulada);
// servidor: Edge Function `fiscal`.
import type { FiscalCancelInput, FiscalDocument, FiscalEmitInput, FiscalFolder, FiscalOverview, FiscalProfileSaveInput } from "@contracts";
import type { z } from "zod";

export type ProfileDraft = z.input<typeof FiscalProfileSaveInput>;
export type EmitDraft = z.input<typeof FiscalEmitInput>;
export type CancelDraft = z.input<typeof FiscalCancelInput>;
export type { FiscalDocument, FiscalFolder, FiscalOverview };

export interface FiscalPort {
  readonly kind: "demo" | "server";
  overview(): Promise<FiscalOverview>;
  saveProfile(draft: ProfileDraft, key: string): Promise<FiscalOverview>;
  grant(termsHash: string, key: string): Promise<FiscalOverview>;
  revoke(key: string): Promise<FiscalOverview>;
  checkCredential(): Promise<FiscalOverview>;
  emit(draft: EmitDraft, key: string): Promise<FiscalDocument>;
  cancel(draft: CancelDraft, key: string): Promise<FiscalDocument>;
  folder(month: string): Promise<FiscalFolder>;
}

export const newKey = () => crypto.randomUUID();

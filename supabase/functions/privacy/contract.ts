// Contrato da Edge Function `privacy` (P57, D26). Fica aqui até o integrador registrá-lo em `_shared/contracts`
// (operations.ts e doc03); o recado está no handoff do P57. Formas validadas na saída do handler e na porta do front.
import { z } from "zod";
import { IsoDateTime, Uuid } from "../_shared/contracts/common.ts";

const Scope = z.enum(["business", "customer"]);

export const PrivacyExport = z.object({
  id: Uuid,
  scope: Scope,
  customer_id: Uuid.nullable(),
  status: z.enum(["generating", "ready", "failed", "expired"]),
  bytes: z.int().min(1).nullable(),
  created_at: IsoDateTime,
  ready_at: IsoDateTime.nullable(),
  /** Até quando o arquivo existe (24 h depois de pronto). */
  expires_at: IsoDateTime.nullable(),
});
export type PrivacyExport = z.infer<typeof PrivacyExport>;

/** Link assinado do Storage: vale 15 minutos; gera-se outro enquanto o arquivo existir. */
export const PrivacyDownload = z.object({ url: z.url(), expires_at: IsoDateTime });

export const PrivacyExportInput = z.object({ scope: Scope, customer_id: Uuid.nullable().default(null) })
  .refine((v) => (v.scope === "customer") === (v.customer_id !== null), { message: "cliente só no escopo customer", path: ["customer_id"] });
export const PrivacyExportOutput = z.object({ export: PrivacyExport, download: PrivacyDownload });
export type PrivacyExportOutput = z.infer<typeof PrivacyExportOutput>;

export const PrivacyExportLinkInput = z.object({ export_id: Uuid });
export const PrivacyExportsListInput = z.object({});
export const PrivacyExportsListOutput = z.object({ items: z.array(PrivacyExport).max(20) });

export const PrivacyErasure = z.object({
  id: Uuid,
  scope: Scope,
  customer_id: Uuid.nullable(),
  status: z.enum(["scheduled", "cancelled", "done"]),
  requested_at: IsoDateTime,
  /** Fim da carência (negócio: 7 dias). Cliente final: o próprio pedido. */
  execute_after: IsoDateTime,
  cancelled_at: IsoDateTime.nullable(),
  done_at: IsoDateTime.nullable(),
  /** Quantas linhas cada passo tocou. Sem conteúdo. */
  summary: z.record(z.string(), z.int().min(0)).nullable(),
});
export type PrivacyErasure = z.infer<typeof PrivacyErasure>;

export const PrivacyEraseInput = z.object({
  scope: Scope,
  customer_id: Uuid.nullable().default(null),
  /** O dono digita a palavra, como num "tem certeza?" que não se aceita por engano. */
  confirm: z.literal("ELIMINAR"),
}).refine((v) => (v.scope === "customer") === (v.customer_id !== null), { message: "cliente só no escopo customer", path: ["customer_id"] });
export const PrivacyEraseOutput = z.object({ erasure: PrivacyErasure });
export const PrivacyEraseCancelInput = z.object({ erasure_id: Uuid });
export const PrivacyErasuresListInput = z.object({});
export const PrivacyErasuresListOutput = z.object({ items: z.array(PrivacyErasure).max(20) });

export const PRIVACY_OPERATIONS = [
  "privacy.exports", "privacy.export", "privacy.export_link", "privacy.erasures", "privacy.erase", "privacy.erase_cancel",
] as const;
export type PrivacyOperation = (typeof PRIVACY_OPERATIONS)[number];

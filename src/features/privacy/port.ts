// Porta do módulo Privacidade (P57, D26). Servidor: Edge Function `privacy`. Demonstração: emulação na aba.
import type { z } from "zod";
import type {
  PrivacyErasure,
  PrivacyEraseInput,
  PrivacyExport,
  PrivacyExportInput,
  PrivacyExportOutput,
} from "../../../supabase/functions/privacy/contract.ts";

export type { PrivacyErasure, PrivacyExport, PrivacyExportOutput };
export type ExportRequest = z.input<typeof PrivacyExportInput>;
export type EraseRequest = z.input<typeof PrivacyEraseInput>;
export interface CustomerOption { id: string; name: string }

export interface PrivacyPort {
  readonly kind: "demo" | "server";
  exports(): Promise<PrivacyExport[]>;
  /** Gera o arquivo e devolve o link com prazo. A mesma chave em retry não gera outro arquivo. */
  exportData(input: ExportRequest, key: string): Promise<PrivacyExportOutput>;
  /** Novo link para uma exportação pronta e no prazo. */
  exportLink(exportId: string): Promise<PrivacyExportOutput>;
  erasures(): Promise<PrivacyErasure[]>;
  erase(input: EraseRequest, key: string): Promise<PrivacyErasure>;
  cancelErasure(erasureId: string, key: string): Promise<PrivacyErasure>;
  /** Busca de clientes do negócio para escolher o titular (leitura do CRM pelo contrato). */
  customers(q: string): Promise<CustomerOption[]>;
}

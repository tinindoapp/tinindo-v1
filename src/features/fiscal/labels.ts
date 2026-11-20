// Rótulos da tela Notas fiscais (P16).
import type { FiscalDocument, FiscalFolder } from "./port.ts";
import { errorExplainer } from "../../lib/errors.ts";
import { today } from "../../lib/time.ts";

export const STATUS_LABEL: Record<FiscalDocument["status"], string> = {
  submitting: "Enviando ao provedor",
  processing: "Em processamento",
  authorized: "Autorizada",
  rejected: "Rejeitada",
  unknown: "Aguardando confirmação do provedor",
  cancel_requested: "Cancelamento pedido",
  cancelled: "Cancelada",
};
export const REASON_LABEL = {
  profile_missing: "Preencha os dados fiscais do negócio.",
  regime_not_eligible: "No piloto, a emissão atende só MEI.",
  cnpj_invalid: "Confira o CNPJ.",
  representation_missing: "Autorize a Tinindo a emitir em seu nome.",
  credential_invalid: "Cadastre ou renove sua credencial no provedor fiscal e confira aqui.",
} as const;
export const SERVICE_LABEL = { "06.01": "Barbearia, cabeleireiros e afins (06.01)", "06.04": "Atividades físicas, personal trainer (06.04)" } as const;
export const REGIME_LABEL = { mei: "MEI", simples_nacional: "Simples Nacional", other: "Outro" } as const;
export const ENV_LABEL = { homologacao: "Homologação (teste, sem valor fiscal)", producao: "Produção" } as const;
export { formatCents } from "../../lib/money.ts";
export const formatCnpj = (v: string) => v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
export const formatDate = (iso: string, tz = "America/Sao_Paulo") => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz }).format(new Date(iso));
/** Hoje (YYYY-MM-DD). O fuso padrão fica aqui até a parte 2 trazer o fuso do negócio. */
export const todayLocal = (tz = "America/Sao_Paulo") => today(tz);

/** CSV da pasta do mês para o contador (separador ";", valores em reais com vírgula). */
export function folderCsv(f: FiscalFolder): string {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [["numero", "competencia", "situacao", "ambiente", "tomador", "documento_tomador", "descricao", "valor", "protocolo", "codigo_verificacao"]];
  for (const d of f.documents) {
    rows.push([d.number ?? "", d.competence_date, STATUS_LABEL[d.status], d.environment, d.taker_name, d.taker_document_masked ?? "", d.description,
      (d.amount_cents / 100).toFixed(2).replace(".", ","), d.protocol ?? "", d.verification_code ?? ""]);
  }
  return rows.map((r) => r.map(esc).join(";")).join("\n");
}

export const explain = errorExplainer({
  "POLICY_REJECTED.eligibility": "Ainda falta algo para emitir. Veja a lista “Antes de emitir”.",
  "POLICY_REJECTED.receivable_has_document": "Este atendimento já tem nota. Cancele a anterior para emitir outra.",
  "POLICY_REJECTED.amount_cents": "O valor da nota não pode passar o valor cobrado.",
  "POLICY_REJECTED.status": "Esta nota não pode ser cancelada no estado atual.",
  "POLICY_REJECTED.profile": "Preencha os dados fiscais primeiro.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  "VALIDATION_ERROR.cnpj": "CNPJ inválido. Confira os números.",
  "VALIDATION_ERROR.taker_document": "CPF ou CNPJ do cliente inválido.",
  "VALIDATION_ERROR.competence_date": "A data do serviço precisa ser de hoje ou dos últimos 60 dias.",
  "VALIDATION_ERROR.reason": "Explique o motivo do cancelamento (pelo menos 15 letras).",
  VALIDATION_ERROR: "Confira os campos e tente de novo.",
  "STALE_VERSION.terms_hash": "Os termos mudaram. Leia de novo e autorize.",
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  PROVIDER_UNAVAILABLE: "O provedor fiscal não respondeu. Nada foi alterado; tente de novo em instantes.",
  FORBIDDEN: "Só o dono do negócio emite notas.",
  default: "Não deu certo agora. Nada foi alterado; tente de novo.",
});

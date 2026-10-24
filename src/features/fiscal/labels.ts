// Rótulos da tela Notas fiscais (P16).
import type { FiscalDocument, FiscalFolder } from "./port.ts";

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
export const formatCents = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100);
export const formatCnpj = (v: string) => v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
export const formatDate = (iso: string, tz = "America/Sao_Paulo") => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz }).format(new Date(iso));
export const todayLocal = (tz = "America/Sao_Paulo") => new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date());

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

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "eligibility") return "Ainda falta algo para emitir. Veja a lista “Antes de emitir”.";
      if (e.field === "receivable_has_document") return "Este atendimento já tem nota. Cancele a anterior para emitir outra.";
      if (e.field === "amount_cents") return "O valor da nota não pode passar o valor cobrado.";
      if (e.field === "status") return "Esta nota não pode ser cancelada no estado atual.";
      if (e.field === "profile") return "Preencha os dados fiscais primeiro.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "VALIDATION_ERROR":
      if (e.field === "cnpj") return "CNPJ inválido. Confira os números.";
      if (e.field === "taker_document") return "CPF ou CNPJ do cliente inválido.";
      if (e.field === "competence_date") return "A data do serviço precisa ser de hoje ou dos últimos 60 dias.";
      if (e.field === "reason") return "Explique o motivo do cancelamento (pelo menos 15 letras).";
      return "Confira os campos e tente de novo.";
    case "STALE_VERSION":
      return e.field === "terms_hash" ? "Os termos mudaram. Leia de novo e autorize." : "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "PROVIDER_UNAVAILABLE":
      return "O provedor fiscal não respondeu. Nada foi alterado; tente de novo em instantes.";
    case "FORBIDDEN":
      return "Só o dono do negócio emite notas.";
    default:
      return "Não deu certo agora. Nada foi alterado; tente de novo.";
  }
}

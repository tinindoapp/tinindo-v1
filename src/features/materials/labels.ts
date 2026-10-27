// Textos do módulo Materiais. Dinheiro em centavos; quantidades com a unidade; datas no fuso do negócio.
import type { MaterialItem } from "@contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatCents = (c: number) => BRL.format(c / 100);
export const formatQty = (q: number, unit: MaterialItem["unit"]) => `${q.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;
export const formatDate = (v: string, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(new Date(v));
export const formatPercent = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const parseNumber = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/\./g, "").replace(",", ".")));
export const parseBRL = (v: string) => Math.round(parseNumber(v) * 100);
export const UNIT_LABEL: Record<MaterialItem["unit"], string> = { un: "unidade", ml: "mililitro", g: "grama" };
export const KIND_LABEL: Record<MaterialItem["kind"], string> = { consumable: "Consumível", product: "Produto" };

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      if (e.field === "stock") return "Estoque insuficiente para um dos itens. Nada foi lançado: registre a compra ou ajuste a contagem antes.";
      if (e.field === "consumed") return "Este atendimento já tem o uso de materiais registrado. Para corrigir, estorne o uso e registre de novo.";
      if (e.field === "reversed") return "Este uso já foi estornado.";
      if (e.field === "usage") return "O serviço não tem ficha de uso. Cadastre a ficha em “Fichas de uso”.";
      if (e.field === "status") return "Esta compra já foi estornada.";
      if (e.field === "name") return "Já existe um item ativo com esse nome.";
      if (e.field === "unit") return "A unidade não muda depois do primeiro movimento.";
      if (e.field === "counted") return "A contagem é igual ao saldo: nada a ajustar.";
      return "As regras não permitem esta ação agora. Nada foi alterado.";
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "VALIDATION_ERROR":
      if (e.field === "lines") return "Confira as linhas: item uma vez só, quantidade maior que zero (até 3 casas) e valor.";
      if (e.field === "reason") return "Informe o motivo do ajuste.";
      return "Confira os campos e tente de novo.";
    case "NOT_FOUND":
      return "Não encontrado. A tela pode estar desatualizada.";
    case "FORBIDDEN":
      return "Só o dono do negócio acessa materiais e custos.";
    default:
      return "Não foi possível concluir agora. Tentar de novo é seguro.";
  }
}

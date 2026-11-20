// Textos do módulo Materiais. Dinheiro em centavos; quantidades com a unidade; datas no fuso do negócio.
import type { MaterialItem } from "@contracts";

import { errorExplainer } from "../../lib/errors.ts";

export const formatQty = (q: number, unit: MaterialItem["unit"]) => `${q.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;
export const formatPercent = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
/** Quantidade digitada ("2", "0,5", "1.250,5", "10.50") → número; vazio ou inválido → NaN.
 *  Mesma regra do dinheiro (src/lib/money.ts): com vírgula, o ponto separa milhar; sem vírgula, o ponto é a
 *  casa decimal. Antes, "10.50" virava 1050. */
export function parseNumber(v: string): number {
  const text = v.replace(/\s/g, "");
  if (!text) return NaN;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}
export const UNIT_LABEL: Record<MaterialItem["unit"], string> = { un: "unidade", ml: "mililitro", g: "grama" };
export const KIND_LABEL: Record<MaterialItem["kind"], string> = { consumable: "Consumível", product: "Produto" };

export const explain = errorExplainer({
  "POLICY_REJECTED.stock": "Estoque insuficiente para um dos itens. Nada foi lançado: registre a compra ou ajuste a contagem antes.",
  "POLICY_REJECTED.consumed": "Este atendimento já tem o uso de materiais registrado. Para corrigir, estorne o uso e registre de novo.",
  "POLICY_REJECTED.reversed": "Este uso já foi estornado.",
  "POLICY_REJECTED.usage": "O serviço não tem ficha de uso. Cadastre a ficha em “Fichas de uso”.",
  "POLICY_REJECTED.status": "Esta compra já foi estornada.",
  "POLICY_REJECTED.name": "Já existe um item ativo com esse nome.",
  "POLICY_REJECTED.unit": "A unidade não muda depois do primeiro movimento.",
  "POLICY_REJECTED.counted": "A contagem é igual ao saldo: nada a ajustar.",
  POLICY_REJECTED: "As regras não permitem esta ação agora. Nada foi alterado.",
  STALE_VERSION: "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.",
  "VALIDATION_ERROR.lines": "Confira as linhas: item uma vez só, quantidade maior que zero (até 3 casas) e valor.",
  "VALIDATION_ERROR.reason": "Informe o motivo do ajuste.",
  VALIDATION_ERROR: "Confira os campos e tente de novo.",
  NOT_FOUND: "Não encontrado. A tela pode estar desatualizada.",
  FORBIDDEN: "Só o dono do negócio acessa materiais e custos.",
});

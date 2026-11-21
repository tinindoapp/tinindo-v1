// Termos de uso e política de privacidade (issue #87). Estrutura pronta: cada documento tem a versão que o aceite
// registra e a situação do texto. Enquanto a situação for "rascunho", a folha mostra o texto de docs/legal com a faixa
// "Rascunho em revisão jurídica" e o aviso de que não é a versão final. Quando o advogado aprovar:
//   1. trocar o texto em docs/legal (sem o bloco "NÃO PUBLICAR");
//   2. mudar `status` para "aprovado" e a `version` para a nova (o aceite seguinte grava a nova versão);
//   3. registrar a data em `publishedAt`.
// O aceite fica no servidor em public.policy_acceptances (só acrescenta), gravado ao criar o negócio (business.create).
import { POLICY_VERSIONS } from "./presets.ts";

export type LegalDoc = "terms" | "privacy";
export type LegalStatus = "rascunho" | "aprovado";

export interface LegalDocument {
  title: string;
  /** O que o aceite grava em policy_acceptances.policy_version. */
  version: string;
  status: LegalStatus;
  /** Data de publicação (só quando aprovado). */
  publishedAt: string | null;
  /** Carregado sob demanda: o texto não pesa no pacote inicial. */
  load(): Promise<string>;
}

export const LEGAL: Record<LegalDoc, LegalDocument> = {
  terms: {
    title: "Termos de uso",
    version: POLICY_VERSIONS.terms,
    status: "rascunho",
    publishedAt: null,
    load: () => import("../../../docs/legal/termos-de-uso.md?raw").then((m) => m.default),
  },
  privacy: {
    title: "Política de privacidade",
    version: POLICY_VERSIONS.privacy,
    status: "rascunho",
    publishedAt: null,
    load: () => import("../../../docs/legal/politica-de-privacidade.md?raw").then((m) => m.default),
  },
};

/** As versões que o aceite grava, na ordem do contrato (business.create). */
export const ACCEPTED_VERSIONS = [LEGAL.terms.version, LEGAL.privacy.version];

export type Block = { kind: "h"; level: 1 | 2 | 3; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/**
 * Markdown mínimo dos textos de docs/legal: títulos (#, ##, ###), parágrafos e listas com "- ". O bloco de citação do
 * topo ("> RASCUNHO… NÃO PUBLICAR") sai: a faixa da folha diz isso de forma legível. Nada vira HTML cru.
 */
export function parseLegal(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
    if (list) blocks.push({ kind: "ul", items: list });
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith(">")) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) {
        blocks.push({ kind: "p", text: para.join(" ") });
        para = [];
      }
      (list ??= []).push(li[1]!);
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/** Trechos de uma linha: **negrito** e `código` (os campos a definir, entre colchetes). */
export function inlineParts(text: string): { text: string; strong?: boolean; pending?: boolean }[] {
  const out: { text: string; strong?: boolean; pending?: boolean }[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], strong: true });
    else out.push({ text: m[2]!, pending: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

// Leitor mínimo do Markdown de docs/legal (E8): títulos, avisos (>), listas, tabelas e parágrafos, com **negrito** e
// `marcas` (os campos ainda por definir). Gera elementos React, nunca HTML cru: o texto não vira código na página.
import type { ReactNode } from "react";
import { StatusBanner } from "../../components/ui/index.tsx";

export type LegalBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; level: 3 | 4; text: string }
  | { kind: "notice"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "paragraph"; text: string };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** Quebra o documento em blocos. Linhas seguidas do mesmo tipo formam um bloco só. */
export function parseLegal(md: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(level === 1 ? { kind: "title", text: heading[2]! } : { kind: "heading", level: level === 2 ? 3 : 4, text: heading[2]! });
      i++;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) parts.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      blocks.push({ kind: "notice", text: parts.join(" ") });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.trim())) items.push(lines[i++]!.trim().replace(/^[-*]\s+/, ""));
      blocks.push({ kind: "list", items });
      continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const row = cells(lines[i++]!);
        if (!row.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(row);
      }
      const [head = [], ...body] = rows;
      blocks.push({ kind: "table", head, rows: body });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|>|[-*]\s|\|)/.test(lines[i]!.trim())) parts.push(lines[i++]!.trim());
    blocks.push({ kind: "paragraph", text: parts.join(" ") });
  }
  return blocks;
}

/** **negrito** e `marca`; o resto é texto. */
export function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

export function LegalBlocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "title":
            return null;
          case "heading":
            return b.level === 3 ? <h3 key={i}>{inline(b.text)}</h3> : <h4 key={i}>{inline(b.text)}</h4>;
          case "notice":
            return (
              <StatusBanner key={i} tone="warning">
                {inline(b.text)}
              </StatusBanner>
            );
          case "list":
            return (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "table":
            return (
              // Tabela larga rola dentro da própria caixa; a página não rola para o lado.
              <div key={i} className="tn-id-legal__table" tabIndex={0} role="region" aria-label="Tabela">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} scope="col">
                          {inline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((c, k) => (
                          <td key={k}>{inline(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "paragraph":
            return <p key={i}>{inline(b.text)}</p>;
        }
      })}
    </>
  );
}

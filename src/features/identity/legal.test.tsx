// Issue #87: folha dos termos e da política com a versão registrada no aceite e o texto marcado como rascunho.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ACCEPTED_VERSIONS, inlineParts, LEGAL, parseLegal } from "./legal.ts";
import { LegalSheet } from "./LegalSheet.tsx";
import { POLICY_VERSIONS } from "./presets.ts";

describe("textos jurídicos", () => {
  it("os dois documentos estão em rascunho, com a versão que o aceite grava", () => {
    expect(LEGAL.terms.status).toBe("rascunho");
    expect(LEGAL.privacy.status).toBe("rascunho");
    expect(ACCEPTED_VERSIONS).toEqual([POLICY_VERSIONS.terms, POLICY_VERSIONS.privacy]);
  });

  it("o leitor tira o aviso NÃO PUBLICAR do topo e entende títulos, parágrafos e listas", () => {
    const blocks = parseLegal("> **RASCUNHO — NÃO PUBLICAR.**\n> Versão 0.1\n\n# Título\n\nUm parágrafo\nem duas linhas.\n\n## Seção\n\n- item um\n- item `[a definir]`\n");
    expect(JSON.stringify(blocks)).not.toContain("NÃO PUBLICAR");
    expect(blocks).toEqual([
      { kind: "h", level: 1, text: "Título" },
      { kind: "p", text: "Um parágrafo em duas linhas." },
      { kind: "h", level: 2, text: "Seção" },
      { kind: "ul", items: ["item um", "item `[a definir]`"] },
    ]);
    expect(inlineParts("**Cliente:** nome `[CNPJ]`.")).toEqual([
      { text: "Cliente:", strong: true },
      { text: " nome " },
      { text: "[CNPJ]", pending: true },
      { text: "." },
    ]);
  });

  it("os rascunhos de docs/legal são lidos de verdade (o arquivo existe e tem seções)", async () => {
    for (const doc of [LEGAL.terms, LEGAL.privacy]) {
      const blocks = parseLegal(await doc.load());
      expect(blocks.filter((b) => b.kind === "h" && b.level === 2).length).toBeGreaterThan(3);
    }
  });

  it("a folha mostra a faixa de rascunho, a versão registrada e o texto carregado", async () => {
    render(<LegalSheet doc="terms" onClose={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "Termos de uso" });
    expect(within(dialog).getByText("Rascunho em revisão jurídica.")).toBeInTheDocument();
    expect(within(dialog).getByText(POLICY_VERSIONS.terms)).toBeInTheDocument();
    expect(await within(dialog).findByRole("heading", { name: /Quem somos/ })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("NÃO PUBLICAR");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
  });
});

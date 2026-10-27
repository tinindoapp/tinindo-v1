import { describe, expect, it } from "vitest";
import { formatDay, pixMessage, splitDescription, unknownNote, whatsappUrl } from "./labels.ts";
import { missingText } from "./PayLinkPage.tsx";

describe("textos de Pagamentos", () => {
  it("dia civil em dd/mm/aaaa, sem deslocar pelo fuso", () => {
    expect(formatDay("2026-10-20")).toBe("20/10/2026");
    expect(formatDay("2026-01-01")).toBe("01/01/2026");
    expect(formatDay("2026-12-31")).toBe("31/12/2026");
    expect(formatDay("texto")).toBe("texto");
  });

  it("mensagem pronta do Pix com nome, serviço, valor e link", () => {
    expect(splitDescription("Corte · Ana Beatriz (exemplo)")).toEqual({ service: "Corte", name: "Ana Beatriz" });
    expect(splitDescription("Produto")).toEqual({ service: "Produto", name: null });
    const msg = pixMessage("Corte · Ana Beatriz (exemplo)", 6000, "https://x.test/pagar#t=abc");
    expect(msg.replace(/\s/g, " ")).toBe("Oi, Ana! Segue o Pix de Corte de R$ 60,00: https://x.test/pagar#t=abc");
    expect(pixMessage("Produto", 3098, "L").replace(/\s/g, " ")).toBe("Oi! Segue o Pix de Produto de R$ 30,98: L");
    const url = whatsappUrl(msg);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(msg);
  });

  it("cobranças sem confirmação só aparecem quando há alguma", () => {
    expect(unknownNote(0)).toBeNull();
    expect(unknownNote(1)).toBe("1 cobrança sem confirmação do banco");
    expect(unknownNote(3)).toBe("3 cobranças sem confirmação do banco");
  });

  it("link não encontrado não culpa a cliente", () => {
    expect(missingText("Barbearia X")).toBe("Não encontramos esta cobrança. Ela pode ter sido paga, cancelada ou ter vencido. Peça um novo link a Barbearia X.");
    expect(missingText()).toMatch(/Peça um novo link a quem te cobrou\.$/);
  });
});

import { describe, expect, it } from "vitest";
import { whatsappHref } from "../../components/ui/index.tsx";
import { deadlineText, formatDay, missingText, pixMessage, splitDescription, unknownNote } from "./labels.ts";

describe("textos de Pagamentos", () => {
  it("dia civil em dd/mm/aaaa, sem deslocar pelo fuso", () => {
    expect(formatDay("2026-10-20")).toBe("20/10/2026");
    expect(formatDay("2026-01-01")).toBe("01/01/2026");
    expect(formatDay("2026-12-31")).toBe("31/12/2026");
    expect(formatDay("texto")).toBe("texto");
    expect(formatDay("2026-02-31")).toBe("data inválida (2026-02-31)");
    expect(formatDay("2026-13-01")).toBe("data inválida (2026-13-01)");
    expect(formatDay("2028-02-29")).toBe("29/02/2028");
  });

  it("mensagem pronta do Pix com nome, serviço, valor e link", () => {
    expect(splitDescription("Corte · Ana Beatriz (exemplo)")).toEqual({ service: "Corte", name: "Ana Beatriz" });
    expect(splitDescription("Produto")).toEqual({ service: "Produto", name: null });
    const msg = pixMessage("Corte · Ana Beatriz (exemplo)", 6000, "https://x.test/pagar#t=abc");
    expect(msg.replace(/\s/g, " ")).toBe("Oi, Ana! Segue o Pix de Corte de R$ 60,00: https://x.test/pagar#t=abc");
    expect(pixMessage("Produto", 3098, "L").replace(/\s/g, " ")).toBe("Oi! Segue o Pix de Produto de R$ 30,98: L");
    const url = whatsappHref(null, msg);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(msg);
  });

  it("cobranças sem confirmação só aparecem quando há alguma", () => {
    expect(unknownNote(0)).toBeNull();
    expect(unknownNote(1)).toBe("1 cobrança sem confirmação do banco");
    expect(unknownNote(3)).toBe("3 cobranças sem confirmação do banco");
  });

  it("link não encontrado não culpa a cliente", () => {
    // 05 #11: não sugere que já foi pago nem manda pagar por outro caminho.
    expect(missingText("Barbearia X")).toBe("Ele venceu ou foi cancelado. Não pague por outro caminho sem falar com Barbearia X: peça um novo link.");
    expect(missingText()).toMatch(/sem falar com quem te cobrou: peça um novo link\.$/);
    expect(missingText("Barbearia X")).not.toMatch(/paga/);
  });

  it("a mensagem pronta diz quem manda quando o nome do negócio é conhecido", () => {
    expect(pixMessage("Corte · Ana Beatriz (exemplo)", 6000, "L", "Barbearia X").replace(/\s/g, " ")).toBe("Oi, Ana! Aqui é Barbearia X. Segue o Pix de Corte de R$ 60,00: L");
    expect(pixMessage("Produto", 3098, "L", null).replace(/\s/g, " ")).toBe("Oi! Segue o Pix de Produto de R$ 30,98: L");
  });

  it("prazo: “de hoje” no mesmo dia; com a data em outro dia", () => {
    const tz = "America/Sao_Paulo";
    expect(deadlineText("2026-10-20T17:35:00Z", new Date("2026-10-20T16:40:00Z"), tz)).toBe("Pague até 14:35 de hoje");
    expect(deadlineText("2026-10-21T03:10:00Z", new Date("2026-10-21T02:50:00Z"), tz)).toBe("Pague até 00:10 de 21/10");
    expect(deadlineText("2026-10-22T12:00:00Z", new Date("2026-10-20T16:40:00Z"), tz)).toBe("Pague até 09:00 de 22/10");
  });
});

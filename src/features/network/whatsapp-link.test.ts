// P53, defeito 1: o link do WhatsApp do perfil é o mesmo do kit, inclusive com E.164 curto (o contrato aceita 8 dígitos).
import { describe, expect, it } from "vitest";
import { whatsappHref } from "../../components/ui/index.tsx";
import { WHATSAPP_GREETING, whatsappLink } from "./PublicProfileView.tsx";

describe("whatsappLink do perfil público", () => {
  it.each(["+5511987654321", "+551133334444", "+12345678", "+5511"])("igual ao whatsappHref do kit para %s", (e164) => {
    expect(whatsappLink(e164)).toBe(whatsappHref(e164, WHATSAPP_GREETING));
  });
  it("número completo abre a conversa; E.164 curto abre o WhatsApp só com o texto", () => {
    expect(whatsappLink("+5511987654321")).toBe(`https://wa.me/5511987654321?text=${encodeURIComponent(WHATSAPP_GREETING)}`);
    expect(whatsappLink("+12345678")).toBe(`https://wa.me/?text=${encodeURIComponent(WHATSAPP_GREETING)}`);
  });
});

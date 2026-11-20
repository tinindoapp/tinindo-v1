// P55 · Jornada do link na demonstração (mesmas regras do banco): corrigir o número libera o pedido anterior, pedir de
// novo zera as tentativas, a 5ª errada libera o horário, reenvio limitado, bairro em domicílio, preço/local/política
// antes de confirmar e o link da reserva com avaliação.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { ApiError } from "../../lib/api/client.ts";
import { createDemoNetworkApi, type NetworkApi, resetDemoNetwork } from "./api.ts";
import { withBusinessSlug } from "./public-kit.tsx";

const SLUG = "barbearia-jornada";
const DAY = "2026-10-20";
let api: NetworkApi;

async function slot(i = 0) {
  const free = await api.publicSlots(SLUG, FX.services.corteA, { starts_at: `${DAY}T03:00:00Z`, ends_at: `${DAY}T23:59:00Z` });
  return free.slots[i]!.starts_at;
}
const book = (starts_at: string, phone: string, extra: Record<string, unknown> = {}) =>
  api.book({ slug: SLUG, service_id: FX.services.corteA, starts_at, contact: { name: "Bia", phone_e164: phone }, ...extra }, crypto.randomUUID());
const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("deveria falhar");
};

beforeEach(async () => {
  resetDemoNetwork();
  api = createDemoNetworkApi("http://localhost");
  await api.publishProfile({ slug: SLUG, category: "barber", area: "Centro", public_fields: ["display_name", "area", "booking_link"] }, crypto.randomUUID());
  await api.setProfileDetails({ address: "Rua das Flores, 10", home_service: false, opening_hours: null, cancellation_policy: "Cancele com 2 horas." }, crypto.randomUUID());
});
afterEach(() => resetDemoNetwork());

describe("P55 · jornada do link (demonstração)", () => {
  it("antes de confirmar: preço base, local e política; tentativas e reenvios", async () => {
    const r = await book(await slot(), "+5511966660001");
    expect(r).toMatchObject({ price_cents: 6000, place: { kind: "address", text: "Rua das Flores, 10" }, policy: "Cancele com 2 horas.", attempts_left: 5, resends_left: 2 });
    expect((await api.getPublicProfile(SLUG)).details?.cancellation_policy).toBe("Cancele com 2 horas.");
  });

  it("corrigir o número libera o pedido anterior e o mesmo horário é aceito", async () => {
    const at = await slot();
    const wrong = await book(at, "+5511966660002");
    const right = await book(at, "+5511966660003", { supersedes_request_id: wrong.request_id });
    expect(right.slot.starts_at).toBe(at);
    expect((await api.requestState(wrong.request_id)).status).toBe("expired");
  });

  it("a 5ª errada libera o horário; pedir de novo zera as tentativas", async () => {
    const at = await slot(1);
    const r = await book(at, "+5511966660004");
    for (let left = 4; left >= 1; left--) {
      const e = await rejection(api.confirmBooking({ request_id: r.request_id, code: "000000" }, crypto.randomUUID()));
      expect([e.field, e.details?.attempts_left]).toEqual(["code", left]);
    }
    expect((await rejection(api.confirmBooking({ request_id: r.request_id, code: "000000" }, crypto.randomUUID()))).field).toBe("attempts");
    // Esgotado: nem o código certo confirma, e o horário voltou a ficar livre.
    expect((await rejection(api.confirmBooking({ request_id: r.request_id, code: r.demoCode! }, crypto.randomUUID()))).field).toBe("attempts");
    expect(await slot(1)).toBe(at);
    const again = await book(at, "+5511966660004");
    expect(again.attempts_left).toBe(5);
  });

  it("reenvio: espera 30 s e no máximo 2", async () => {
    const r = await book(await slot(2), "+5511966660005");
    expect((await rejection(api.resendCode(r.request_id, crypto.randomUUID()))).field).toBe("resend_wait");
  });

  it("em domicílio, o bairro é obrigatório", async () => {
    await api.setProfileDetails({ address: null, home_service: true, opening_hours: null, cancellation_policy: null }, crypto.randomUUID());
    expect((await rejection(book(await slot(3), "+5511966660006"))).field).toBe("neighborhood");
    const r = await book(await slot(3), "+5511966660006", { neighborhood: "Moema" });
    expect(r.place).toEqual({ kind: "home" });
  });

  it("confirmar devolve o link da reserva; ver pelo link não traz contato; avaliar só depois do atendimento", async () => {
    const r = await book(await slot(4), "+5511966660007");
    const ok = await api.confirmBooking({ request_id: r.request_id, code: r.demoCode! }, crypto.randomUUID());
    expect(ok.booking_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const view = await api.bookingByLink(ok.booking_token!);
    expect(view).toMatchObject({ status: "confirmed", business: { slug: SLUG }, review: { can_review: false } });
    expect(JSON.stringify(view)).not.toMatch(/66660007|Bia/);
    expect((await rejection(api.reviewByLink(ok.booking_token!, 5, null, crypto.randomUUID()))).field).toBe("booking_status");
    expect((await rejection(api.bookingByLink("A".repeat(43)))).code).toBe("NOT_FOUND");
  });

  it("links com token ganham o endereço do negócio no caminho; o token fica no fragmento", () => {
    expect(withBusinessSlug("https://x.test/pagar#t=abc", SLUG)).toBe(`https://x.test/pagar/${SLUG}#t=abc`);
    expect(withBusinessSlug("https://x.test/orcamento#t=abc", null)).toBe("https://x.test/orcamento#t=abc");
    expect(withBusinessSlug("https://x.test/pagar#t=abc", "Nao Valido")).toBe("https://x.test/pagar#t=abc");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createDemoPort, demoCancelBooking, resetDemoState } from "./demoPort.ts";
import { arrivalMessage, cep5Of, parsePrefixes } from "./labels.ts";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code: string; field?: string }) => `${e.code}/${e.field ?? "-"}`);
const DAY = "2026-10-20";

describe("demonstração do Domicílio (mesmas regras do banco)", () => {
  beforeEach(() => resetDemoState());
  const setup = async () => {
    const port = createDemoPort();
    const config = await port.config();
    const zone = (n: string) => config.zones.find((z) => z.name === n)!;
    const route = await port.route(DAY);
    const booking = (n: string) => route.bookings.find((b) => b.customer_name === n)!;
    return { port, zone, route, booking };
  };

  it("roteiro em ordem: base → Centro (20) → Pinheiros (25 pelo tempo cadastrado), com janela de chegada", async () => {
    const { route } = await setup();
    expect(route.stops.map((s) => [s.zone_name, s.travel_min, s.depart_at])).toEqual([
      ["Centro", 20, "2026-10-20T11:40:00Z"],
      ["Pinheiros", 25, "2026-10-20T13:05:00Z"],
    ]);
    expect(route.stops[0]).toMatchObject({ arrival_from: "2026-10-20T11:30:00Z", arrival_to: "2026-10-20T12:00:00Z" });
    expect(route.needs_rebuild).toBe(false);
    expect(route.bookings.filter((b) => !b.is_visit)).toHaveLength(2);
  });

  it("fora da área, CEP de outra zona e sem tempo de chegar: recusado e nada muda", async () => {
    const { port, zone, booking } = await setup();
    const bia = booking("Bia Rocha");
    expect(await code(port.attach(bia.booking_id, zone("Alphaville").id, null, "a1"))).toBe("POLICY_REJECTED/area");
    expect(await code(port.attach(bia.booking_id, zone("Centro").id, "05401", "a2"))).toBe("VALIDATION_ERROR/cep");
    // Bia às 14h no Centro, depois de Carlos em Pinheiros: 25 min pelo tempo cadastrado.
    const stop = await port.attach(bia.booking_id, zone("Centro").id, "01010", "a3");
    expect(stop.travel_min).toBe(25);
    expect((await port.attach(bia.booking_id, zone("Centro").id, "01010", "a3")).visit_id).toBe(stop.visit_id);
    // Com 200 min de padrão, Duda às 16h na Vila Mariana bateria com Bia às 14h.
    await port.saveSettings({ expected_version: 2, default_travel_min: 200, same_zone_travel_min: 10, arrival_window_min: 30, max_km: 15 }, "s1");
    const before = await port.route(DAY);
    expect(await code(port.attach(booking("Duda Alves").booking_id, zone("Vila Mariana").id, null, "a4"))).toBe("SLOT_CONFLICT/travel");
    expect(await port.route(DAY)).toEqual(before);
  });

  it("um CEP numa zona só; cancelar pede recálculo; tirar e desfazer", async () => {
    const { port, route } = await setup();
    expect(await code(port.saveZone({ name: "Sé", cep_prefixes: ["01001"], distance_km: 1, travel_from_base_min: 15 }, "z1"))).toBe("POLICY_REJECTED/cep_prefixes");
    expect(await code(port.saveZone({ name: "centro", distance_km: 1, travel_from_base_min: 15 }, "z2"))).toBe("POLICY_REJECTED/name");
    expect((await port.zoneFor("05401-000")).zone?.name).toBe("Pinheiros");
    demoCancelBooking(route.stops[0]!.booking_id);
    const after = await port.route(DAY);
    expect(after.needs_rebuild).toBe(true);
    expect(await port.rebuild(DAY, "r1")).toBe(1);
    const rebuilt = await port.route(DAY);
    expect(rebuilt.stops.map((s) => s.travel_min)).toEqual([35]);
    await port.detach(rebuilt.stops[0]!.booking_id, "d1");
    expect((await port.route(DAY)).stops).toHaveLength(0);
  });

  it("textos: CEP de 5 dígitos, prefixos e mensagem da janela", () => {
    expect(cep5Of("01310-100")).toBe("01310");
    expect(cep5Of("0131")).toBeNull();
    expect(parsePrefixes("01310, 01311-000 01310")).toEqual(["01310", "01311"]);
    expect(parsePrefixes("0131")).toBeNull();
    expect(arrivalMessage({ customer_name: "Ana Souza", service_name: "Corte", arrival_from: "2026-10-20T11:30:00Z", arrival_to: "2026-10-20T12:00:00Z" }, DAY, "America/Sao_Paulo"))
      .toBe("Olá, Ana! Chego entre 08:30 e 09:00 para o corte de terça-feira, 20/10. Se eu atrasar, aviso por aqui.");
  });
});

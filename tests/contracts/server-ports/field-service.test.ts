// Porta de servidor do Domicílio contra o registro de contratos (ver harness.ts).
import { describe, expect, it } from "vitest";
import { createServerPort } from "../../../src/features/field-service/serverPort.ts";
import { exercisePort, TENANT, unusedOperations } from "./harness.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const DAY = "2026-10-20";

describe("field-service · porta do servidor", () => {
  it("toda chamada bate com o registro de contratos", async () => {
    const calls = await exercisePort("field-service", (call) => createServerPort(call, TENANT), {
      // Sem servidor: o dia de hoje sai do relógio do aparelho, no fuso do negócio.
      today: (p) => expect(p.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/),
      config: (p) => p.config(),
      saveSettings: (p, key) => p.saveSettings({ expected_version: null, enabled: true, default_travel_min: 30, same_zone_travel_min: 10, arrival_window_min: 15, max_km: null }, key),
      saveZone: (p, key) => p.saveZone({ zone_id: null, expected_version: null, name: "Centro", cep_prefixes: ["01310"], distance_km: 4.5, travel_from_base_min: 20, active: true }, key),
      saveTravel: (p, key) => p.saveTravel(ID, OTHER, null, key),
      zoneFor: (p) => p.zoneFor("01310-100"),
      route: (p) => p.route(DAY),
      attach: (p, key) => p.attach(ID, OTHER, null, key),
      detach: (p, key) => p.detach(ID, key),
      rebuild: (p, key) => p.rebuild(DAY, key),
    });

    expect(calls.today).toEqual([]);
    // null tira o tempo cadastrado: tem de chegar como null, não sumir do corpo.
    expect(calls.saveTravel![0]!.body).toEqual({ zone_a: ID, zone_b: OTHER, minutes: null });
    expect(calls.attach![0]!.body).toEqual({ booking_id: ID, zone_id: OTHER, cep5: null });
    // Roteiro e recálculo usam a mesma entrada (o dia), em operações diferentes.
    expect(calls.route![0]).toMatchObject({ operation: "field.route", body: { day: DAY }, idempotencyKey: undefined });
    expect(calls.rebuild![0]).toMatchObject({ operation: "field.route_rebuild", body: { day: DAY } });
    // A tela do Domicílio alcança todo o módulo.
    expect(unusedOperations("field-service", calls)).toEqual([]);
  });
});

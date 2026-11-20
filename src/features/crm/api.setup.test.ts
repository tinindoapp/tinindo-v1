// Ponte da demonstração (recado #115): serviços confirmados na Configuração entram no catálogo de exemplo.
// Arquivo próprio: o catálogo da ponte fica no módulo e mudaria as outras telas do mesmo arquivo.
import { describe, expect, it } from "vitest";
import { ProviderService } from "@contracts";
import { FX } from "@contracts/fixtures.ts";
import { demoSetupReach, publishDemoSetup } from "../../lib/demo/setup.ts";
import { createDemoCrmApi } from "./api.ts";

const created = { id: "40000000-0000-4000-8000-0000000000c1", template_code: "barber_sobrancelha", name: "Sobrancelha", duration_min: 15, base_price_cents: 2500 };

describe("catálogo de exemplo lê os serviços da Configuração", () => {
  it("leitor ligado ao carregar o módulo", () => {
    expect(demoSetupReach("services")).toBe(true);
  });

  it("serviço confirmado aparece no catálogo, válido no contrato, sem tirar os de exemplo nem duplicar", async () => {
    const api = createDemoCrmApi();
    const before = (await api.listServices({})).items;
    publishDemoSetup("services", [created]);
    publishDemoSetup("services", [created]);

    const items = (await api.listServices({})).items;
    expect(items.map((s) => s.id)).toEqual([...before.map((s) => s.id), created.id]);
    const added = items.at(-1)!;
    expect(() => ProviderService.parse(added)).not.toThrow();
    expect(added).toMatchObject({ name: "Sobrancelha", duration_min: 15, base_price_cents: 2500, min_price_cents: 2500, active: true });
    expect(items.some((s) => s.id === FX.services.corteA)).toBe(true);
  });
});

// Ponte da demonstração (recado #115): a profissão confirmada na Configuração vale para o perfil de exemplo.
import { afterEach, describe, expect, it } from "vitest";
import { tenantA } from "@contracts/fixtures.ts";
import { demoSetupReach, publishDemoSetup } from "../../lib/demo/setup.ts";
import { createDemoNetworkApi, resetDemoNetwork } from "./api.ts";

afterEach(() => resetDemoNetwork());

describe("perfil de exemplo lê a profissão da Configuração", () => {
  it("leitor ligado ao carregar o módulo", () => {
    expect(demoSetupReach("profession")).toBe(true);
  });

  it("profissão confirmada vira a do negócio; reset volta à de exemplo", async () => {
    const api = createDemoNetworkApi("http://localhost");
    expect((await api.getBusiness())?.profession).toBe(tenantA.profession);
    publishDemoSetup("profession", "personal_trainer");
    expect((await api.getBusiness())?.profession).toBe("personal_trainer");
    resetDemoNetwork();
    expect((await api.getBusiness())?.profession).toBe(tenantA.profession);
  });
});

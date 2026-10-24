// A emulação segue as regras do banco (pgTAP 22, integração 39).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDirectoryPort, createDemoPort, resetDemoState, setDemoProfilePublished, slug } from "./demoPort.ts";

const k = () => crypto.randomUUID();
beforeEach(() => resetDemoState());

describe("demonstração do Diretório", () => {
  it("opt-in exige perfil publicado; entra e aparece na busca em ordem alfabética", async () => {
    const p = createDemoPort();
    const d = createDemoDirectoryPort();
    setDemoProfilePublished(false);
    await expect(p.save({ expected_version: 0, uf: "SP", city_name: "São Paulo", listed: true }, k())).rejects.toMatchObject({ field: "profile" });
    setDemoProfilePublished(true);
    const o = await p.save({ expected_version: 0, uf: "sp", city_name: "São Paulo", show_hours: true, listed: true }, k());
    expect(o.listing).toMatchObject({ uf: "SP", city_slug: "sao-paulo" });
    const r = await d.search({ uf: "SP", city_slug: "sao-paulo", category: "barber" });
    expect(r.items.map((x) => x.display_name ?? x.area)).toEqual(["Barbearia Exemplo A", "Moema"]);
    expect((await d.search({ uf: "SP", city_slug: "sao-paulo", weekday: 6 })).items.map((x) => x.slug)).not.toContain("barbearia-exemplo-a");
    expect(slug(" São José ")).toBe("sao-jose");
  });
});

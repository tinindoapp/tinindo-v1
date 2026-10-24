// A emulação segue as mesmas regras do banco (pgTAP 20 e integração 37): prévia só pública, publicar o hash visto,
// versão não muda sozinha, reversível, domínio só com o TXT certo, Google só com acesso concedido.
import { beforeEach, describe, expect, it } from "vitest";
import { FX } from "@contracts/fixtures.ts";
import { createDemoPort, createDemoPublicPort, resetDemoState, setDemoPrice, setDemoProfilePublished } from "./demoPort.ts";

const k = () => crypto.randomUUID();
beforeEach(() => resetDemoState());

describe("demonstração de Site e Google", () => {
  it("sem perfil publicado não há prévia nem publicação", async () => {
    setDemoProfilePublished(false);
    const p = createDemoPort();
    const o = await p.overview();
    expect(o.preview).toBeNull();
    await expect(p.publish("a".repeat(64), k())).rejects.toMatchObject({ code: "POLICY_REJECTED", field: "profile" });
  });

  it("publica o hash visto; preço novo muda a prévia mas não o publicado; tirar do ar e voltar versão", async () => {
    const p = createDemoPort();
    const pub = createDemoPublicPort();
    let o = await p.saveSite({ expected_version: 0, headline: "Corte na hora", sections: ["services", "prices", "booking"], service_ids: [FX.services.corteA] }, k());
    expect(o.preview?.services).toEqual([{ name: "Corte", duration_min: 30, price_cents: 6000 }]);
    expect(JSON.stringify(o.preview)).not.toMatch(/4500|1500|min_price/);
    await expect(p.publish("f".repeat(64), k())).rejects.toMatchObject({ code: "STALE_VERSION", field: "preview" });
    o = await p.publish(o.preview_hash!, k());
    expect(o.published?.version_no).toBe(1);
    expect((await pub.site("barbearia-exemplo-a")).site.headline).toBe("Corte na hora");
    setDemoPrice(FX.services.corteA, 6500);
    const changed = await p.overview();
    expect(changed.preview_hash).not.toBe(changed.published?.snapshot_hash);
    expect((await pub.site("barbearia-exemplo-a")).site.services[0]?.price_cents).toBe(6000);
    o = await p.unpublish(changed.site.version, k());
    await expect(pub.site("barbearia-exemplo-a")).rejects.toMatchObject({ code: "NOT_FOUND" });
    o = await p.restore(1, o.site.version, k());
    expect((await pub.site("barbearia-exemplo-a")).version_no).toBe(1);
    expect(o.deliveries.map((d) => d.kind)).toEqual(["site_restored", "site_unpublished", "site_published"]);
  });

  it("domínio: nome da Tinindo recusado; sem TXT não verifica; com o TXT simulado verifica", async () => {
    const p = createDemoPort();
    await expect(p.addDomain("site.tinindo.app", k())).rejects.toMatchObject({ code: "POLICY_REJECTED", field: "hostname" });
    const o = await p.addDomain("MinhaBarbearia.com.br", k());
    const d = o.domain!;
    expect(d.hostname).toBe("minhabarbearia.com.br");
    expect((await p.checkDomain(d.id)).result).toBe("not_found");
    p.simulateDns!(d.txt_name, d.txt_value);
    expect(await p.checkDomain(d.id)).toMatchObject({ result: "found", domain: { status: "verified" } });
  });

  it("Google: conceder exige link do Maps válido; revogar só depois de conceder", async () => {
    const p = createDemoPort();
    await expect(p.setGoogle({ action: "revoke", expected_version: 1 }, k())).rejects.toMatchObject({ code: "POLICY_REJECTED" });
    await expect(p.setGoogle({ action: "grant", profile_name: "Barbearia", profile_url: "https://exemplo.com/maps", expected_version: 0 }, k())).rejects.toMatchObject({ field: "profile_url" });
    let o = await p.setGoogle({ action: "grant", profile_name: "Barbearia", profile_url: "https://maps.app.goo.gl/x", expected_version: 0 }, k());
    expect(o.google).toMatchObject({ status: "granted", access_level: "manager" });
    o = await p.setGoogle({ action: "revoke", expected_version: o.google.version }, k());
    expect(o.google.status).toBe("revoked");
  });
});

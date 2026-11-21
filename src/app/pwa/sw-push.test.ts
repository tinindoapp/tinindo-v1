import { describe, expect, it } from "vitest";
import { notificationFrom, safeAppUrl } from "./sw-push.ts";
import { deviceLabel, keyBytes, pushSupport } from "./push-client.ts";

describe("aviso no celular (service worker)", () => {
  it("título, texto e destino do conteúdo; ícone da marca; etiqueta para não empilhar repetido", () => {
    const n = notificationFrom({ title: "Reserva nova pelo link", body: "Corte · Ana · qui 06/03, 14:00", url: "/app/agenda?dia=2031-03-06", kind: "booking_new" });
    expect(n.title).toBe("Reserva nova pelo link");
    expect(n.options).toMatchObject({ body: "Corte · Ana · qui 06/03, 14:00", icon: "/icons/app-icon-192.png", data: { url: "/app/agenda?dia=2031-03-06" }, tag: "booking_new:Corte · Ana · qui 06/03, 14:00" });
  });

  it("conteúdo estranho vira aviso neutro; destino fora do /app vira /app", () => {
    expect(notificationFrom(null)).toMatchObject({ title: "Tinindo", options: { body: "Você tem uma novidade na agenda.", data: { url: "/app" } } });
    for (const bad of ["https://golpe.example", "//golpe.example", "/app/../../x", "javascript:alert(1)", 42]) expect(safeAppUrl(bad), String(bad)).toBe("/app");
    expect(safeAppUrl("/app/agenda")).toBe("/app/agenda");
  });
});

describe("assinatura no navegador", () => {
  it("iPhone fora do app instalado não recebe; navegador sem push, também", () => {
    const base = { hasSw: true, hasPush: true, hasNotification: true, ios: false, standalone: false };
    expect(pushSupport(base)).toBe("ok");
    expect(pushSupport({ ...base, ios: true })).toBe("ios-needs-install");
    expect(pushSupport({ ...base, ios: true, standalone: true })).toBe("ok");
    expect(pushSupport({ ...base, hasPush: false })).toBe("no-push");
    expect(pushSupport({ ...base, hasSw: false })).toBe("no-sw");
  });

  it("chave pública em bytes e nome do aparelho sem dado pessoal", () => {
    expect([...keyBytes("AQID")]).toEqual([1, 2, 3]);
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 7)")).toBe("Celular Android");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
  });
});

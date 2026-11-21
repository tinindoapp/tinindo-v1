import { describe, expect, it } from "vitest";
import { dismissInstall, installDismissed, installSteps, platformOf } from "./install.ts";

const env = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints, standalone: false });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("Adicionar à tela de início (P34)", () => {
  it("reconhece iPhone (Safari e outros navegadores), iPad que se diz Mac, Android e computador", () => {
    expect(platformOf(env(IPHONE))).toBe("ios");
    expect(platformOf(env(IPHONE.replace("Version/18.0", "CriOS/130.0")))).toBe("ios-other-browser");
    expect(platformOf(env("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 5))).toBe("ios");
    expect(platformOf(env("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 0))).toBe("desktop");
    expect(platformOf(env("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130.0 Mobile Safari/537.36"))).toBe("android");
  });

  it("os passos dizem onde tocar em cada aparelho", () => {
    expect(installSteps("ios").steps.join(" ")).toMatch(/Compartilhar.*Adicionar à Tela de Início/);
    expect(installSteps("ios-other-browser").steps[0]).toMatch(/Safari/);
    expect(installSteps("android").steps.join(" ")).toMatch(/três pontos.*Instalar app/);
  });

  it("'Agora não' vale 30 dias; sem armazenamento, não quebra", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const t0 = Date.UTC(2026, 10, 21);
    expect(installDismissed(t0, storage)).toBe(false);
    dismissInstall(t0, storage);
    expect(installDismissed(t0 + 29 * 86_400_000, storage)).toBe(true);
    expect(installDismissed(t0 + 31 * 86_400_000, storage)).toBe(false);
    const broken = { getItem: () => { throw new Error("privado"); }, setItem: () => { throw new Error("privado"); } };
    expect(installDismissed(t0, broken)).toBe(false);
    expect(() => dismissInstall(t0, broken)).not.toThrow();
    expect(installDismissed(t0, null)).toBe(false);
  });
});

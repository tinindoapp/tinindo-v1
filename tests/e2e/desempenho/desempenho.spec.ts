import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { devices, expect, test } from "@playwright/test";

// Revisão de qualidade, bloco 2 · desempenho. Tetos medidos em 21/11/2026 (docs/qa/revisao-qualidade/), com folga:
// tamanho é determinístico (folga pequena); tempo depende da máquina do CI (folga grande, ~1,6× o medido aqui).
// Celular médio em 4G: o perfil "Slow 4G" do Lighthouse (150 ms de ida e volta, 1,6 Mbps) e a CPU 4× mais lenta.
// Passou de um teto? Ver o que cresceu em docs/qa/revisao-qualidade/02-desempenho.md e decidir: carregar sob demanda,
// tirar dependência, ou subir o teto neste arquivo com a medida nova e o motivo no PR.
const TETOS = {
  // Pacotes do build (dist/assets), sem compactar.
  maiorPedacoJsKb: 240, // hoje 210 (supabase); react-dom e react-router + zod logo abaixo
  totalJsKb: 1950, // hoje 1.818 em 110 arquivos
  totalCssKb: 150, // hoje 136
  // O que a Hoje baixa no primeiro carregamento.
  hojeJsTransferidoKb: 345, // hoje 330 (compactado)
  hojeJsKb: 1040, // hoje 993 (sem compactar)
  hojeCssKb: 132, // hoje 124
  hojePedidosJs: 65, // hoje 57
  // Tempo na rede e CPU de celular médio, do início da navegação.
  hojeVisivelMs: 6500, // hoje ~4.000
  hojeInterativaMs: 7000, // hoje ~4.200 (o primeiro toque, Menu, responde)
};

const kb = (n: number) => Math.round(n / 1024);

test.describe("desempenho", () => {
  // Uma vez só, no Chromium (a limitação de rede e CPU usa o protocolo do Chromium); o perfil de celular é montado aqui.
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "medido uma vez, no Chromium");

  test("pacotes do build dentro dos tetos", () => {
    const dir = join(process.cwd(), "dist", "assets");
    const files = readdirSync(dir).map((f) => ({ f, size: statSync(join(dir, f)).size }));
    const js = files.filter((x) => x.f.endsWith(".js"));
    const css = files.filter((x) => x.f.endsWith(".css"));
    const biggest = js.reduce((a, b) => (b.size > a.size ? b : a));
    expect.soft(kb(biggest.size), `maior pedaço de JS: ${biggest.f}`).toBeLessThanOrEqual(TETOS.maiorPedacoJsKb);
    expect.soft(kb(js.reduce((s, x) => s + x.size, 0)), "JS total do build").toBeLessThanOrEqual(TETOS.totalJsKb);
    expect.soft(kb(css.reduce((s, x) => s + x.size, 0)), "CSS total do build").toBeLessThanOrEqual(TETOS.totalCssKb);
  });

  test("Hoje em 4G e celular médio: tamanho, visível e interativa dentro dos tetos", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1638.4 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    await page.goto("/app", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible({ timeout: 20_000 });
    const visible = await page.evaluate(() => performance.now());
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const interactive = await page.evaluate(() => performance.now());

    const res = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((e) => {
        const r = e as PerformanceResourceTiming;
        return { name: r.name, transfer: r.transferSize, decoded: r.decodedBodySize };
      }),
    );
    const js = res.filter((r) => r.name.endsWith(".js"));
    const css = res.filter((r) => r.name.endsWith(".css"));
    const report = {
      visivelMs: Math.round(visible),
      interativaMs: Math.round(interactive),
      jsTransferidoKb: kb(js.reduce((s, r) => s + r.transfer, 0)),
      jsKb: kb(js.reduce((s, r) => s + r.decoded, 0)),
      cssKb: kb(css.reduce((s, r) => s + r.decoded, 0)),
      pedidosJs: js.length,
    };
    test.info().annotations.push({ type: "medida", description: JSON.stringify(report) });
    console.log("Hoje · 4G + CPU 4×:", JSON.stringify(report));

    expect.soft(report.jsTransferidoKb, "JS transferido na Hoje").toBeLessThanOrEqual(TETOS.hojeJsTransferidoKb);
    expect.soft(report.jsKb, "JS da Hoje sem compactar").toBeLessThanOrEqual(TETOS.hojeJsKb);
    expect.soft(report.cssKb, "CSS da Hoje").toBeLessThanOrEqual(TETOS.hojeCssKb);
    expect.soft(report.pedidosJs, "pedidos de JS da Hoje").toBeLessThanOrEqual(TETOS.hojePedidosJs);
    expect.soft(report.visivelMs, "Hoje visível").toBeLessThanOrEqual(TETOS.hojeVisivelMs);
    expect.soft(report.interativaMs, "Hoje interativa").toBeLessThanOrEqual(TETOS.hojeInterativaMs);
    // O perfil público, a sugestão e as ações do atendimento não entram antes de serem usados.
    expect.soft(js.map((r) => r.name).filter((n) => /PublicProfileView/.test(n)), "perfil público na Hoje").toEqual([]);
    await ctx.close();
  });
});

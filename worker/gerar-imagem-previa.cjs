// Gera public/og/previa.png (1200×630), a imagem padrão da prévia do link quando o negócio não tem foto (D24).
// Só os ativos originais da marca (brand/assets/logo, BRAND.md): wordmark em cor sobre papel, sem redesenho.
// Uso: node worker/gerar-imagem-previa.cjs   (precisa do Playwright e do Chromium instalados)
const { chromium } = require("playwright");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const wordmark = readFileSync(join(root, "brand/assets/logo/tinindo-wordmark-color.svg"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body { background: #F7F7F5; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #111111; }
  .box { display: grid; justify-items: center; gap: 40px; }
  .mark svg { width: 520px; height: auto; display: block; }
  p { margin: 0; font-size: 44px; font-weight: 600; letter-spacing: -0.5px; }
</style></head><body><div class="box"><div class="mark">${wordmark}</div><p>Agenda e reserva pelo link</p></div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: join(root, "public/og/previa.png"), type: "png" });
  await browser.close();
})();

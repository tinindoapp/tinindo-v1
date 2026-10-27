import { defineConfig, devices } from "@playwright/test";

// P42 · e2e contra a homologação hospedada (não roda no CI de PR: precisa do ambiente no ar).
// Uso: STAGING_URL=https://… npx playwright test -c tests/e2e-staging/playwright.config.ts
// Variáveis em tests/e2e-staging/README.md. Sem STAGING_URL a suíte nem começa (erro claro em vez de testar a demo local).
const baseURL = process.env.STAGING_URL;
if (!baseURL) throw new Error("Defina STAGING_URL com o endereço da homologação (ex.: https://homolog.tinindo…).");

export default defineConfig({
  testDir: ".",
  forbidOnly: !!process.env.CI,
  retries: 1,
  // Uma pessoa publica por vez e a conta técnica é uma só: nada em paralelo contra o mesmo ambiente.
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../playwright-report/staging" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Safari do iPhone (WebKit). Não substitui o teste no aparelho real (docs/qa/IPHONE-SAFARI.md).
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
});

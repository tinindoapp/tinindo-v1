import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { distDir, gatewayUrl, previewPort, previewUrl } from "./portas.ts";

// Jornada do ciclo na tela com gravação real (P59): navegador → porta de servidor → handler de produção → Postgres.
// Rode por `bash tests/e2e/servidor/run.sh`: ele cria o banco, faz o build com servidor numa pasta temporária e chama
// este config. A demonstração offline continua no playwright.config.ts da raiz, que ignora esta pasta.
if (!distDir) throw new Error("E2E_SERVIDOR_DIST não definido: rode a jornada por `bash tests/e2e/servidor/run.sh`.");
const root = fileURLToPath(new URL("../../..", import.meta.url));
export default defineConfig({
  testDir: ".",
  outputDir: "../../../test-results/servidor",
  forbidOnly: !!process.env.CI,
  // Um banco só para os dois projetos: nada de paralelismo nem de segunda tentativa sobre dados já gravados.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../../../playwright-report/servidor" }]] : "list",
  use: { baseURL: previewUrl, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Nunca reaproveita servidor: um gateway antigo estaria ligado a outro banco e um preview antigo, a outro build.
  webServer: [
    {
      command: "node --experimental-strip-types tests/e2e/servidor/iniciar-gateway.ts",
      cwd: root,
      // O "cron" do canal simulado: a jornada do primeiro acesso lê em Mensagens › Simulador o código do número e o da
      // reserva pelo link. O P59 não depende dele (os negócios do seed não têm número conectado).
      env: { E2E_GATEWAY_DESPACHO_MS: process.env.E2E_GATEWAY_DESPACHO_MS ?? "2000" },
      url: `${gatewayUrl}/__saude`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    },
    {
      command: `npx vite preview --outDir "${distDir}" --host 127.0.0.1 --port ${previewPort} --strictPort`,
      cwd: root,
      url: previewUrl,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

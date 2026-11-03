import { defineConfig, devices } from "@playwright/test";

// Smoke E2E contra o build de produção do frontend (vite preview).
// Sem Supabase configurado o app roda em demonstração offline; P10 acrescenta fluxos com banco.
// E2E_PORT: porta do preview (padrão 4173). Duas cópias do repositório rodando e2e ao mesmo tempo precisam de portas
// diferentes; com a mesma porta, reuseExistingServer faria uma testar o build da outra.
const port = Number(process.env.E2E_PORT ?? 4173);
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

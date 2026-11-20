import { defineConfig, devices } from "@playwright/test";

// Smoke E2E contra o build de produção do frontend (vite preview).
// Sem Supabase configurado o app roda em demonstração offline; P10 acrescenta fluxos com banco.
// E2E_PORT: porta do preview (padrão 4173). Duas cópias do repositório rodando e2e ao mesmo tempo precisam de portas
// diferentes; com a mesma porta, reuseExistingServer faria uma testar o build da outra.
const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

// P51 · escopo visível do piloto (D1 a) e periferia congelada (D4).
// - Módulos "por ativação": a pasta de e2e roda em todo PR, com os módulos ligados na demonstração.
// - Módulos guardados: a pasta só roda na `main` (E2E_PILOTO=1 no PR, definido no CI, deixa de fora).
// - O resto (núcleo do piloto) roda como o participante vê: só os 10 módulos do piloto.
// A chave da demonstração fica em localStorage (src/app/scope-demo.ts); com servidor quem decide é o banco.
const ACTIVATION = ["recurrence", "sales", "growth-advice", "analytics", "referrals", "service-ops"];
const STORED = ["messaging", "payments", "fiscal", "presence", "campaigns", "reputation", "field-service", "discovery", "resources", "materials", "finance-advanced"];
const dirs = (names: string[]) => names.map((n) => `**/e2e/${n}/**/*.spec.ts`);
const allModules = { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: "tinindo.demo.modulos", value: "todos" }] }] };
const pilotOnly = process.env.E2E_PILOTO === "1";

const devicesBy = { desktop: devices["Desktop Chrome"], mobile: devices["Pixel 7"] };
const projects = Object.entries(devicesBy).flatMap(([name, device]) => [
  { name, use: { ...device }, testIgnore: dirs([...ACTIVATION, ...STORED]) },
  { name: `${name}-recursos`, use: { ...device, storageState: allModules }, testMatch: dirs(ACTIVATION) },
  ...(pilotOnly ? [] : [{ name: `${name}-guardados`, use: { ...device, storageState: allModules }, testMatch: dirs(STORED) }]),
]);

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects,
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

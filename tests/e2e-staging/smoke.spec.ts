import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { noHorizontalScroll, openFromNav } from "../e2e/qa/helpers.ts";

// P42 · smoke da homologação hospedada (release/CHECKLIST.md, seção 2). Só lê e entra com a conta técnica sintética:
// não grava nada além do login. Os passos que precisam de variável opcional pulam com o motivo quando ela falta.
const env = {
  sha: process.env.STAGING_EXPECTED_SHA,
  supabaseUrl: process.env.STAGING_SUPABASE_URL,
  publishableKey: process.env.STAGING_SUPABASE_PUBLISHABLE_KEY,
  email: process.env.STAGING_TECH_EMAIL,
  password: process.env.STAGING_TECH_PASSWORD,
  slug: process.env.STAGING_PUBLIC_SLUG,
};

// Funções chamadas pelo navegador. `jobs` é só servidor a servidor (cron com segredo) e fica de fora do CORS.
const FUNCTIONS_DIR = fileURLToPath(new URL("../../supabase/functions/", import.meta.url));
const BROWSER_FUNCTIONS = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "jobs")
  .map((d) => d.name);

test.describe("homologação · build publicado", () => {
  test("serve o build de homologação, não a demonstração local", async ({ page }) => {
    await page.goto("/entrar");
    await expect(page.getByRole("note")).toContainText("homologação");
    await expect(page.getByRole("heading", { name: "Entrar", level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("version.json aponta para o SHA aprovado", async ({ request }) => {
    const res = await request.get("/version.json");
    expect(res.ok()).toBe(true);
    const build = (await res.json()) as { commit: string; branch: string };
    test.info().annotations.push({ type: "build", description: `${build.commit} · ${build.branch}` });
    if (env.sha) expect(build.commit.startsWith(env.sha)).toBe(true);
  });

  test("nenhuma chave secreta no bundle", async ({ page, request }) => {
    const scripts: string[] = [];
    page.on("response", (r) => { if (r.url().endsWith(".js")) scripts.push(r.url()); });
    await page.goto("/entrar");
    await page.waitForLoadState("networkidle");
    expect(scripts.length).toBeGreaterThan(0);
    for (const url of scripts) {
      const body = await (await request.get(url)).text();
      expect(body, url).not.toMatch(/sb_secret_|service_role/);
    }
  });

  test("rota interna recarregada abre o app (SPA no Worker), não 404", async ({ page }) => {
    const res = await page.goto("/app/agenda");
    expect(res?.status()).toBe(200);
  });
});

test.describe("homologação · funções", () => {
  test.skip(!env.supabaseUrl, "Defina STAGING_SUPABASE_URL para conferir as funções.");
  // Sem tela envolvida: uma vez só, no projeto desktop.
  test.skip(({ isMobile }) => isMobile, "Funções conferidas uma vez, no desktop.");

  for (const fn of BROWSER_FUNCTIONS) {
    test(`${fn} sobe e aceita a origem do app (CORS)`, async ({ request, baseURL }) => {
      const origin = new URL(baseURL!).origin;
      const res = await request.fetch(`${env.supabaseUrl}/functions/v1/${fn}/health`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          ...(env.publishableKey ? { apikey: env.publishableKey } : {}),
        },
      });
      // 5xx aqui quase sempre é segredo faltando na função (o index.ts recusa subir) ou deploy que não aconteceu.
      expect(res.status(), `${fn}: ${res.status()}`).toBeLessThan(300);
      expect(res.headers()["access-control-allow-origin"], `${fn}: ALLOWED_ORIGINS sem ${origin}`).toBe(origin);
    });
  }
});

test.describe("homologação · conta técnica", () => {
  test.skip(!env.email || !env.password, "Defina STAGING_TECH_EMAIL e STAGING_TECH_PASSWORD (conta técnica sintética).");

  test("entra e abre Agenda e Clientes sem rolagem lateral", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(env.email!);
    await page.getByLabel("Senha").fill(env.password!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/app/);
    for (const name of ["Agenda", "Clientes"]) {
      await openFromNav(page, name);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Erro honesto aparece como alerta; aqui não pode haver nenhum (função caída, RLS, CORS).
      await expect(page.getByRole("alert")).toHaveCount(0);
      await noHorizontalScroll(page);
    }
  });
});

test.describe("homologação · link público", () => {
  test.skip(!env.slug, "Defina STAGING_PUBLIC_SLUG com o perfil publicado da conta técnica.");

  test("perfil público mostra os serviços para reservar", async ({ page }) => {
    await page.goto(`/p/${env.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await noHorizontalScroll(page);
  });
});

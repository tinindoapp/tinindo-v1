// P34 · app instalável, no navegador de verdade (build de produção, vite preview): manifesto e ícones, service
// worker controlando o /app, a casca abrindo sem internet, a troca de versão pelo "Atualizar" e as instruções de
// "Adicionar à tela de início" em 375 px.
import { expect, type Page, test } from "@playwright/test";

async function controlled(page: Page) {
  await page.goto("/app");
  await expect(page.locator("h1").first()).toBeVisible();
  // Primeira visita: o service worker instala; na recarga ele já controla a página.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test("manifesto: nome, início no /app, tela cheia e ícones da marca (comum e maskable) que existem", async ({ page, request }) => {
  await page.goto("/app");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "Tinindo", short_name: "Tinindo", start_url: "/app", display: "standalone", lang: "pt-BR" });
  const purposes = manifest.icons.map((i: { purpose: string; sizes: string }) => `${i.sizes}:${i.purpose}`);
  expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get("/apple-touch-icon-180.png")).status()).toBe(200);
});

test("service worker controla o /app e a casca abre sem internet", async ({ page, context }) => {
  await controlled(page);
  await context.setOffline(true);
  await page.reload();
  // Demonstração: a Hoje monta inteira com o app guardado (sem servidor nenhum).
  await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
  await page.goto("/app/agenda");
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeVisible();
  await context.setOffline(false);
});

test("páginas do cliente final não registram o service worker", async ({ page }) => {
  await page.goto("/p/barbearia-exemplo");
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test("versão nova: assume depois de baixar tudo, avisa 'Nova versão disponível' e 'Atualizar' recarrega", async ({ page }) => {
  await controlled(page);
  await page.getByRole("heading", { level: 1 }).first().evaluate((h) => h.setAttribute("data-antes", "1"));
  // Simula um deploy: o registro passa a apontar para outro script (o navegador instala um worker novo). O Playwright não
  // intercepta a busca de atualização do sw.js, então a troca de endereço faz o papel do arquivo novo.
  await page.evaluate(() => navigator.serviceWorker.register("/sw.js?deploy=2", { scope: "/", updateViaCache: "none" }));
  const bar = page.getByRole("status").filter({ hasText: "Nova versão disponível" });
  await expect(bar).toBeVisible({ timeout: 15_000 });
  // A página aberta não recarregou sozinha (nada do que estava na tela se perdeu).
  await expect(page.locator("[data-antes]")).toHaveCount(1);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain("deploy=2");
  await Promise.all([page.waitForEvent("load"), bar.getByRole("button", { name: "Atualizar" }).click()]);
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("[data-antes]")).toHaveCount(0);
  await expect(page.getByText("Nova versão disponível")).toHaveCount(0);
});

test("sem o toque, a próxima abertura do app já é a versão nova", async ({ page }) => {
  await controlled(page);
  await page.evaluate(() => navigator.serviceWorker.register("/sw.js?deploy=3", { scope: "/", updateViaCache: "none" }));
  await expect(page.getByRole("status").filter({ hasText: "Nova versão disponível" })).toBeVisible({ timeout: 15_000 });
  await page.goto("/app/agenda");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.getByText("Nova versão disponível")).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain("deploy=3");
});

test.describe("375 px no celular", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("convite depois do primeiro dia: 'Como instalar' mostra os passos; 'Agora não' guarda a escolha", async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("tinindo.pwa.primeiro-uso")) localStorage.setItem("tinindo.pwa.primeiro-uso", String(Date.now() - 2 * 86_400_000));
    });
    await page.goto("/app");
    const invite = page.getByRole("complementary", { name: "Instalar o app" });
    await expect(invite).toBeVisible({ timeout: 10_000 });
    // Cabe na largura e os botões têm 44 px.
    for (const b of await invite.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await invite.getByRole("button", { name: /Instalar|Como instalar/ }).tap();
    const help = page.getByRole("dialog", { name: "Adicionar à tela de início" });
    await expect(help).toBeVisible();
    await help.getByRole("button", { name: "Fechar" }).tap();
    await invite.getByRole("button", { name: "Agora não" }).tap();
    await expect(invite).toBeHidden();
    await page.reload();
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Instalar o app" })).toHaveCount(0);
  });

  test("#instalar abre as instruções de iPhone e Android", async ({ page }) => {
    await page.goto("/app/agenda#instalar");
    const help = page.getByRole("dialog", { name: "Adicionar à tela de início" });
    await expect(help).toBeVisible({ timeout: 10_000 });
    await expect(help).toContainText(/Adicionar à Tela de Início|Adicionar à tela inicial/);
    await help.getByText("No iPhone (Safari)").or(help.getByText("No Android (Chrome)")).first().tap();
    const box = (await help.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });
});

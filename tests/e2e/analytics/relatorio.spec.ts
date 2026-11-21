import { expect, test } from "@playwright/test";

// P32 bloco 4: "Sua semana" e "Seu mês" com período, base e "dados insuficientes"; compartilhar só números.
test("relatório: da tela de resultado para a semana; navega, troca para o mês e mostra a base", async ({ page }) => {
  await page.goto("/app/resultado");
  await page.getByRole("link", { name: "Ver o relatório" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sua semana" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "19/10/2026 a 20/10/2026 (até agora)" })).toBeVisible();
  await expect(page.getByText("2 de 3 atendimentos que já começaram")).toBeVisible();
  await expect(page.getByRole("button", { name: "Semana seguinte" })).toBeDisabled();
  await page.getByRole("button", { name: "Semana anterior" }).click();
  await expect(page.getByRole("heading", { name: "12/10/2026 a 18/10/2026" })).toBeVisible();
  await expect(page.getByText("R$ 640,00")).toBeVisible();
  await page.getByRole("button", { name: "Seu mês" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Seu mês" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "01/10/2026 a 20/10/2026 (até agora)" })).toBeVisible();
});

test("relatório: período sem atendimentos diz dados insuficientes, nunca zero", async ({ page }) => {
  await page.goto("/app/resultado/relatorio");
  await expect(page.getByRole("heading", { name: "19/10/2026 a 20/10/2026 (até agora)" })).toBeVisible();
  for (let i = 0; i < 12; i++) await page.getByRole("button", { name: "Semana anterior" }).click();
  await expect(page.getByRole("heading", { name: "27/07/2026 a 02/08/2026" })).toBeVisible();
  await expect(page.getByText("Atendimentos que já começaram: 0")).toBeVisible();
  expect(await page.locator("[data-insufficient]").count()).toBeGreaterThanOrEqual(4);
});

test("relatório: compartilhar como texto leva só números e período", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __shared: unknown[] }).__shared = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (d: unknown) => { (window as unknown as { __shared: unknown[] }).__shared.push(d); return Promise.resolve(); },
    });
  });
  await page.goto("/app/resultado/relatorio");
  await page.getByRole("button", { name: "Compartilhar como texto" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1);
  const text = await page.evaluate(() => ((window as unknown as { __shared: { text: string }[] }).__shared[0]!).text);
  expect(text).toContain("Sua semana");
  expect(text).toContain("19/10/2026 a 20/10/2026");
  expect(text).toContain("dados insuficientes");
  expect(text).not.toMatch(/@|\(\d{2}\)\s?\d/);
});

test("relatório: compartilhar como imagem gera um PNG", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __files: string[] }).__files = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (d: { files?: File[] }) => { (window as unknown as { __files: string[] }).__files.push(...(d.files ?? []).map((f) => `${f.name}|${f.type}|${f.size}`)); return Promise.resolve(); },
    });
  });
  await page.goto("/app/resultado/relatorio");
  await page.getByRole("button", { name: "Compartilhar como imagem" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __files: string[] }).__files.length), { timeout: 15_000 }).toBe(1);
  const [name, type, size] = (await page.evaluate(() => (window as unknown as { __files: string[] }).__files[0]!)).split("|");
  expect(name).toBe("sua-semana-2026-10-20.png");
  expect(type).toBe("image/png");
  expect(Number(size)).toBeGreaterThan(1000);
});

test.describe("375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("relatório cabe na tela sem rolagem lateral", async ({ page }) => {
    await page.goto("/app/resultado/relatorio");
    await expect(page.getByRole("heading", { name: "19/10/2026 a 20/10/2026 (até agora)" })).toBeVisible();
    await page.getByRole("button", { name: "Compartilhar como imagem" }).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

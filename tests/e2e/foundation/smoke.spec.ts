import { expect, test } from "@playwright/test";

test("shell abre em demonstração, navega e não estoura a largura", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Seu negócio em ordem" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Demonstração");
  await expect(page.getByRole("img", { name: "Tinindo" })).toBeVisible();

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Agenda" }).click();
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(page.getByText("Pacote P04")).toBeVisible();

  // Compara com a largura do viewport configurado: no modo mobile o Chrome alarga o
  // viewport de layout para caber conteúdo largo, então innerWidth sozinho não detecta.
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
});

test("rota inexistente mostra página amigável", async ({ page }) => {
  await page.goto("/nao-existe");
  await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
});

test("alvos de toque da navegação têm pelo menos 44px", async ({ page }) => {
  await page.goto("/app");
  const links = page.getByRole("navigation", { name: "Principal" }).getByRole("link");
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const box = await links.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

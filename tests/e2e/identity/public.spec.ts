import { expect, test } from "@playwright/test";

// Rotas públicas do P01 montadas pelo integrador: fora do shell e sem rolagem horizontal.
for (const [path, heading] of [
  ["/criar-conta", "Criar conta"],
  ["/recuperar-senha", "Recuperar acesso"],
] as const) {
  test(`${path} abre fora do shell`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

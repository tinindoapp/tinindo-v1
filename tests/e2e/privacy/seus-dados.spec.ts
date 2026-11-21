import { expect, test } from "@playwright/test";
import { noHorizontalScroll } from "../qa/helpers.ts";

// P57 (D26, recado #137): "Seus dados" abre a partir de Conta em /app/privacidade, no celular e no desktop, na
// demonstração (exportar e eliminar rotulados como exemplo; nada sai do aparelho).
test.beforeEach(async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 800 });
});

test("Conta › Seus dados abre a tela de exportar e eliminar", async ({ page }) => {
  await page.goto("/app/conta");
  await expect(page.getByRole("heading", { name: "Sua conta", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Abrir Seus dados" }).click();
  await expect(page).toHaveURL(/\/app\/privacidade$/);
  await expect(page.getByRole("heading", { name: "Seus dados", level: 1 })).toBeVisible();
  await noHorizontalScroll(page);
});

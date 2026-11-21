import { expect, test } from "@playwright/test";

// P32 bloco 5: a previsão só aparece com 8 semanas; a base de exemplo tem menos e diz isso, sem número inventado.
test("previsão: da tela de resultado; com pouco histórico diz dados insuficientes e quanto falta", async ({ page }) => {
  await page.goto("/app/resultado");
  await page.getByRole("link", { name: "Ver a previsão da próxima semana" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Próxima semana" })).toBeVisible();
  await expect(page.getByText(/nada muda sozinho na agenda/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "dados insuficientes" })).toBeVisible();
  await expect(page.getByText(/precisa de pelo menos 8 semanas fechadas de agenda/)).toBeVisible();
  await expect(page.getByText("%")).toHaveCount(0);
});

test.describe("375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("previsão cabe na tela sem rolagem lateral", async ({ page }) => {
    await page.goto("/app/resultado/previsao");
    await expect(page.getByRole("heading", { name: "dados insuficientes" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

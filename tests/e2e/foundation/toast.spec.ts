import { expect, test } from "@playwright/test";

// Toast (item 5 da auditoria): fica à vista acima da barra de abas e não bloqueia o toque no que está embaixo.
test("o aviso aparece acima da barra de abas e o botão embaixo dele continua tocável", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/app/agenda");
  await page.getByRole("link", { name: /09:00–09:30 Corte Cliente Exemplo Ana/ }).click();
  await page.getByRole("button", { name: "Concluir atendimento" }).click();
  await page.getByRole("button", { name: "Confirmar conclusão" }).click();
  const toast = page.locator(".tn-toast");
  await expect(toast).toContainText("Atendimento concluído.");
  const box = (await toast.boundingBox())!;
  const tabbar = await page.getByRole("navigation", { name: "Abas" }).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(tabbar!.y);
  expect(box.y).toBeGreaterThan(0);
  // O toque atravessa o aviso: o link que está embaixo dele funciona com o aviso na tela.
  await page.getByRole("link", { name: "Cobrar no Caixa" }).click();
  await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
});

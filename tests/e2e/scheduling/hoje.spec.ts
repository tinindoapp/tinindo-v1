import { expect, test } from "@playwright/test";

// Hoje (auditoria de UX, itens 30 e 31) na demonstração: terça 20/10, 09:00 no fuso do negócio.
test("Hoje destaca o próximo atendimento, sem selo Confirmado, e leva à agenda do dia", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app");
  const next = page.getByRole("region", { name: /^Próximo:/ });
  await expect(next).toContainText("Próximo: 09:00 · Cliente Exemplo Ana · agora");
  await expect(page.getByRole("list", { name: "Outros atendimentos de hoje" })).not.toContainText("Confirmado");
  await expect(page.getByRole("list", { name: "Outros atendimentos de hoje" })).toContainText("Reserva provisória");
  await page.getByRole("link", { name: "Ver os 6 de hoje" }).click();
  await expect(page.getByRole("heading", { name: "Agenda", level: 1 })).toBeVisible();

  await page.goBack();
  await next.getByRole("link", { name: /^Abrir/ }).click();
  await expect(page.getByRole("heading", { name: "Atendimento", level: 1 })).toBeVisible();
  await expect(page.getByText(/terça-feira, 20 de outubro, 09:00–09:30/)).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

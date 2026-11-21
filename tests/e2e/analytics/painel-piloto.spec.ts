import { expect, test } from "@playwright/test";

// P32 bloco 3: painel do piloto (equipe Tinindo), na demonstração com negócios de exemplo.
test("painel do piloto: funil com tempos, erros e recusas, telas nunca abertas e CSV", async ({ page }) => {
  await page.goto("/app/resultado/piloto");
  await expect(page.getByRole("heading", { name: "Painel do piloto", level: 1 })).toBeVisible();
  await expect(page.getByText("Demonstração: negócios e números de exemplo.")).toBeVisible();
  const list = page.getByRole("list", { name: "Negócios do piloto" });
  const a = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Barbearia Exemplo A" }) });
  await expect(a.getByRole("list", { name: "Funil de Barbearia Exemplo A" })).toContainText("Primeiro recebimento");
  await expect(a).toContainText("funil 7 de 7");
  await a.locator("summary").filter({ hasText: "Erros e recusas" }).click();
  await expect(a).toContainText("SLOT_CONFLICT");
  const c = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Salão Exemplo C" }) });
  await expect(c).toContainText("funil 1 de 7");
  // Fora do menu do profissional.
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Painel do piloto" })).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^piloto-\d{4}-\d{2}-\d{2}-7d\.csv$/);
  const text = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text).toContain("Barbearia Exemplo A");
  expect(text).not.toMatch(/@|\+55/);

  await page.getByRole("button", { name: "Últimos 28 dias" }).click();
  await expect(page.getByRole("button", { name: "Últimos 28 dias" })).toHaveAttribute("aria-pressed", "true");
  await expect(list).toBeVisible();
});

test.describe("375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("painel do piloto cabe na tela sem rolagem lateral", async ({ page }) => {
    await page.goto("/app/resultado/piloto");
    await expect(page.getByRole("list", { name: "Negócios do piloto" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

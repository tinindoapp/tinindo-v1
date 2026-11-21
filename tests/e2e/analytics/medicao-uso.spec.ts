import { expect, test } from "@playwright/test";

// P32 bloco 1: o negócio vê o que a medição de uso anota e pode desligar (na demonstração nada é enviado).
test("medição de uso: explica o que anota e o que nunca anota; desligar pede confirmação", async ({ page }) => {
  await page.goto("/app/resultado");
  const card = page.getByRole("region", { name: "Medição de uso do app" });
  await expect(card).toContainText("Nunca anota nome, telefone, valor nem o que você digita");
  await expect(card).toContainText("Na demonstração nada é medido nem enviado.");
  await expect(card).toContainText("Ligada.");
  await card.getByRole("button", { name: "Desligar a medição" }).click();
  await expect(card).toContainText("apaga o que já foi anotado");
  await card.getByRole("button", { name: "Sim, desligar" }).click();
  await expect(card).toContainText("Nada do uso deste negócio é anotado.");
  await card.getByRole("button", { name: "Ligar a medição" }).click();
  await expect(card).toContainText("Ligada.");
});

test("medição de uso: na demonstração nenhuma chamada de uso sai do navegador", async ({ page }) => {
  const usage: string[] = [];
  page.on("request", (r) => { if (r.url().includes("usage.record")) usage.push(r.url()); });
  await page.goto("/app/agenda");
  await page.goto("/app/clientes");
  await page.goto("/app/resultado");
  await expect(page.getByRole("region", { name: "Medição de uso do app" })).toBeVisible();
  expect(usage).toEqual([]);
});

test.describe("375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("medição de uso cabe na tela sem rolagem lateral", async ({ page }) => {
    await page.goto("/app/resultado");
    const card = page.getByRole("region", { name: "Medição de uso do app" });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("button", { name: "Desligar a medição" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

import { expect, test } from "@playwright/test";

test("materiais: uso pela ficha sai uma vez, estorno devolve, margem real com cobertura, compra com despesa, ajuste de contagem", async ({ page }) => {
  await page.goto("/app/materiais");
  await expect(page.getByRole("heading", { name: "Materiais", level: 1 })).toBeVisible();
  await expect(page.getByText("nada é cobrado nem lançado de verdade")).toBeVisible();
  const stock = page.getByRole("list", { name: "Itens em estoque" });
  await expect(stock).toContainText("Shampoo · Consumível · 1.000 ml · R$ 50,00 · custo médio R$ 0,05/ml");

  // Uso pela ficha no corte de ontem: sai do estoque uma vez e a margem real aparece.
  const uses = page.getByRole("list", { name: "Uso por atendimento" });
  const corte = uses.getByRole("listitem").filter({ hasText: "Corte" });
  await expect(corte).toContainText("Uso de materiais não registrado");
  await corte.getByRole("button", { name: "Registrar uso pela ficha" }).click();
  await expect(page.getByText("Uso registrado pela ficha: saiu do estoque uma vez.")).toBeVisible();
  await expect(corte).toContainText("custo R$ 4,00 · margem R$ 56,00");
  await expect(stock).toContainText("Shampoo · Consumível · 980 ml");
  const margin = page.getByRole("list", { name: "Margem por serviço" });
  await expect(margin).toContainText("Corte: R$ 60,00 combinados − R$ 4,00 em materiais = R$ 56,00 (93,3%)");
  await expect(margin).toContainText("Barba: sem uso registrado · 0 de 1 atendimento(s) com materiais");
  await expect(page.getByText("1 atendimento(s) sem uso registrado ficam fora da margem real.")).toBeVisible();
  // A barba não tem ficha: o botão não aparece.
  await expect(uses.getByRole("listitem").filter({ hasText: "Barba" })).toContainText("(o serviço não tem ficha)");

  // Estorno devolve exato.
  await corte.getByRole("button", { name: "Estornar uso" }).click();
  await expect(page.getByText("Uso estornado: os materiais voltaram ao estoque.")).toBeVisible();
  await expect(stock).toContainText("Shampoo · Consumível · 1.000 ml · R$ 50,00");

  // Compra com despesa no Caixa recalcula o custo médio.
  await page.getByRole("button", { name: "Nova compra" }).click();
  const buy = page.getByRole("form", { name: "Nova compra" });
  await buy.getByRole("combobox", { name: "Item", exact: true }).selectOption({ label: "Shampoo (ml)" });
  await buy.getByLabel("Quantidade").fill("1000");
  await buy.getByLabel("Valor pago (R$)").fill("70,00");
  await buy.getByRole("button", { name: "Registrar compra de R$ 70,00" }).click();
  await expect(page.getByText("Compra de R$ 70,00 lançada no estoque e como despesa de materiais no Caixa.")).toBeVisible();
  await expect(stock).toContainText("Shampoo · Consumível · 2.000 ml · R$ 120,00 · custo médio R$ 0,06/ml");

  // Ajuste de contagem com motivo.
  await stock.getByRole("listitem").filter({ hasText: "Pomada" }).getByRole("button", { name: "Editar ou contar" }).click();
  const adj = page.getByRole("form", { name: "Ajustar contagem de Pomada" });
  await adj.getByLabel("Quantidade contada (un)").fill("8");
  await adj.getByLabel("Motivo").fill("Duas vendidas no balcão");
  await adj.getByRole("button", { name: "Ajustar" }).click();
  await expect(page.getByText("Contagem de “Pomada” ajustada para 8 un.")).toBeVisible();

  // Ficha nova: barba usa 1 toalha.
  const usage = page.getByRole("form", { name: "Item na ficha de uso" });
  await usage.getByLabel("Serviço").selectOption({ label: "Barba" });
  await usage.getByLabel("Item").selectOption({ label: "Toalha descartável (un)" });
  await usage.getByLabel("Quantidade por atendimento").fill("1");
  await usage.getByRole("button", { name: "Salvar na ficha" }).click();
  await expect(page.getByRole("list", { name: "Ficha de Barba" })).toContainText("Toalha descartável: 1 un");
  // Sem toalha em estoque, o uso pela ficha é recusado por inteiro.
  await uses.getByRole("listitem").filter({ hasText: "Barba" }).getByRole("button", { name: "Registrar uso pela ficha" }).click();
  await expect(page.getByText("Estoque insuficiente para um dos itens. Nada foi lançado")).toBeVisible();

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

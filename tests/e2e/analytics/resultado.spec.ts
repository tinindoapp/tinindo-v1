import { expect, test } from "@playwright/test";

test("resultado: conta e denominador, dado ausente não vira zero, baseline congelada e comparação sem causa", async ({ page }) => {
  await page.goto("/app/resultado");
  await expect(page.getByRole("heading", { name: "Resultado", level: 1 })).toBeVisible();
  await expect(page.getByText("Comparar antes e depois não prova")).toBeVisible();
  const metrics = page.getByRole("region", { name: "Indicadores" });
  const occupancy = metrics.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Ocupação" }) });
  await expect(occupancy).toContainText(/Conta: [\d.]+ min de [\d.]+ min/);
  await expect(occupancy).toContainText("expediente menos bloqueios");
  const reminders = metrics.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Lembretes enviados" }) });
  await expect(reminders).toContainText("Ainda não medido");
  await expect(reminders).not.toContainText("0%");
  const quotes = metrics.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Orçamentos aceitos" }) });
  await expect(quotes).toContainText("Dados insuficientes");
  await expect(page.getByRole("region", { name: "O que falta nos dados" })).toContainText("sem cobrança registrada");

  const form = page.getByRole("form", { name: "Congelar uma baseline" });
  await form.getByRole("button", { name: "Congelar baseline" }).click();
  await expect(page.getByText(/Baseline “Antes da Tinindo” congelada/)).toBeVisible();
  await page.getByLabel("Período").selectOption({ label: "Últimos 7 dias (até ontem)" });
  await expect(occupancy).toContainText(/Baseline: .* · diferença: /);
  await expect(reminders).toContainText("sem comparação");
  await expect(metrics).toContainText("não prova que a Tinindo causou a mudança");

  await page.getByLabel("Período").selectOption({ label: "Hoje e próximos 6 dias" });
  await expect(page.getByRole("region", { name: "O que falta nos dados" })).toContainText("inclui dias futuros");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("custo por cliente: minutos medidos × custo-hora informado", async ({ page }) => {
  await page.goto("/app/resultado/custo");
  await expect(page.getByRole("heading", { name: "Custo por cliente", level: 1 })).toBeVisible();
  const table = page.getByRole("region", { name: "Por cliente", exact: true });
  await expect(table).toContainText("Barbearia Exemplo A");
  await expect(table).toContainText(/R\$\s95,00/);
  await page.getByLabel("Custo-hora (R$)").fill("120");
  await page.getByRole("button", { name: "Recalcular" }).click();
  await expect(table).toContainText(/R\$\s190,00/);
  await expect(table).toContainText("não são pagamentos confirmados");
});

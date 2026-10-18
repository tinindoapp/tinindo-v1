import { expect, test } from "@playwright/test";

test("preços: simulador real, piso bloqueia e regra só vale depois de aprovar", async ({ page }) => {
  await page.goto("/app/precos");
  await expect(page.getByRole("heading", { name: "Preços", level: 1 })).toBeVisible();
  await expect(page.getByText("Dados de exemplo.")).toBeVisible();

  // Simulador (Corte: base R$60, piso R$45, custo R$15, taxa 5%): 15% → R$51.
  const sim = page.getByRole("region", { name: "Simulador de desconto" });
  await expect(sim.getByLabel("Resultado da simulação")).toContainText("R$ 51,00");
  await sim.getByLabel("Margem alvo (%)").fill("80");
  await expect(sim.getByText(/acima do preço base/)).toBeVisible();

  // Regra ativa de exemplo (v3); nova regra fica inativa até aprovar.
  const active = page.getByRole("region", { name: "Regras ativas" });
  await expect(active.getByText(/regra v3/)).toBeVisible();
  const form = page.getByRole("form", { name: "Nova regra" });
  await form.getByLabel("Terça").uncheck();
  await form.getByLabel("Quarta").check();
  await form.getByLabel("Das", { exact: true }).fill("09:00");
  await form.getByLabel("Até", { exact: true }).fill("12:00");
  await form.getByLabel("Desconto pedido (%)").fill("20");
  await form.getByLabel("Teto aprovado (%)").fill("10");
  await form.getByRole("button", { name: "Ver prévia" }).click();
  const proposals = page.getByRole("list", { name: "Propostas aguardando aprovação" });
  await expect(proposals).toContainText("R$ 54,00");
  await expect(proposals).toContainText("desconto efetivo 10%");
  await expect(active.getByText(/regra v3/)).toBeVisible();

  await proposals.getByRole("button", { name: "Aprovar e publicar" }).click();
  await expect(page.getByText(/Regra v4 publicada/)).toBeVisible();
  await expect(active.getByRole("listitem")).toHaveCount(1);
  await expect(active).toContainText("Quarta 09:00–12:00");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

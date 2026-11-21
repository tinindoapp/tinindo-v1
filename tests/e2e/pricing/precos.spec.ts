import { expect, test } from "@playwright/test";

test("preços: simulador real, piso bloqueia e regra só vale depois de aprovar", async ({ page }) => {
  await page.goto("/app/precos");
  await expect(page.getByRole("heading", { name: "Preços", level: 1 })).toBeVisible();
  // D11 (b): sem aviso de demonstração por tela; a faixa do topo já diz.
  await expect(page.getByText("Dados de exemplo.")).toHaveCount(0);

  // P54: as regras que valem vêm antes do simulador, que nasce recolhido numa linha.
  const active = page.getByRole("region", { name: "Regras ativas" });
  await expect(active).toContainText("Terça 13:00–17:00");
  await page.getByText("Simular um desconto").click();
  // Simulador (Corte: base R$60, piso R$45, custo R$15, taxa 5%): 15% → R$51.
  const sim = page.getByRole("group", { name: "Simular um desconto" });
  await expect(sim.getByLabel("Resultado da simulação")).toContainText("R$ 51,00");
  await sim.getByLabel("Margem alvo (%)").fill("80");
  await expect(sim.getByText(/acima do preço base/)).toBeVisible();

  // Regra ativa de exemplo (terça à tarde, 15%), sem número de versão na tela; nova regra fica inativa até aprovar.
  await expect(active).not.toContainText(/regra v\d/);
  await page.getByRole("button", { name: "Nova regra" }).click();
  const form = page.getByRole("form", { name: "Nova regra" });
  await form.getByLabel("Terça").uncheck();
  await form.getByLabel("Quarta").check();
  await form.getByLabel("Das", { exact: true }).fill("09:00");
  await form.getByLabel("Até", { exact: true }).fill("12:00");
  await form.getByLabel("Desconto pedido (%)").fill("20");
  await form.getByLabel("Desconto máximo (%)").fill("10");
  await form.getByRole("button", { name: "Ver prévia" }).click();
  const proposals = page.getByRole("list", { name: "Propostas aguardando aprovação" });
  await expect(proposals).toContainText("R$ 54,00");
  await expect(proposals).toContainText("desconto aplicado 10%");
  await expect(active).toContainText("Terça 13:00–17:00");
  await expect(form).toHaveCount(0);

  await proposals.getByRole("button", { name: "Aprovar e publicar" }).click();
  await expect(page.getByText(/Regra publicada para Corte/)).toBeVisible();
  await expect(active.getByRole("listitem")).toHaveCount(1);
  await expect(active).toContainText("Quarta 09:00–12:00");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

import { expect, test } from "@playwright/test";

test("indicações: o benefício não é avaliação; aceite não concede; duplicidade bloqueada; uso real concede uma vez", async ({ page }) => {
  await page.goto("/app/indicacoes");
  await expect(page.getByRole("heading", { name: "Indicações", level: 1 })).toBeVisible();
  await expect(page.getByText("O benefício não é avaliação.")).toBeVisible();
  await expect(page.getByText("nada é concedido de verdade")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Perfil" })).toHaveAttribute("href", "/app/perfil");
  const summary = page.locator("dl[aria-label=\"Resumo\"]");
  await expect(summary).toContainText("50 perguntas");
  const invites = page.getByRole("list", { name: "Convites" });
  await expect(invites.getByRole("listitem")).toHaveCount(4);
  await expect(invites).toContainText("Benefício concedido · 50 perguntas");
  await expect(invites).toContainText("aguardando uso real (1 cliente(s), 0 atendimento(s) concluído(s))");
  await expect(invites).toContainText("Sem benefício: este negócio já aderiu por outro convite");
  await expect(invites).toContainText("Aguardando aceite");
  await expect(page.getByRole("list", { name: "Benefícios" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "Simular uso real do indicado" }).click();
  await expect(page.getByText("Avaliação (simulação): 1 benefício(s) concedido(s).")).toBeVisible();
  await expect(page.getByRole("list", { name: "Benefícios" }).getByRole("listitem")).toHaveCount(2);
  await expect(summary).toContainText("100 perguntas");
  await page.getByRole("button", { name: "Simular uso real do indicado" }).click();
  await expect(page.getByText("Avaliação (simulação): 0 benefício(s) concedido(s).")).toBeVisible();
  await expect(page.getByRole("list", { name: "Benefícios" }).getByRole("listitem")).toHaveCount(2);

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

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
  await expect(invites).toContainText("Aceito: aguardando uso real");
  // Progresso escrito e em barra (item 58): "1 de 3 clientes", sem "(s)".
  const progress = invites.getByRole("group", { name: /^Uso real de / });
  await expect(progress).toContainText("1 de 3 clientes");
  await expect(progress).toContainText("0 de 2 atendimentos concluídos");
  await expect(progress.getByRole("progressbar")).toHaveCount(2);
  await expect(invites).toContainText("Sem benefício: este negócio já aderiu por outro convite");
  await expect(invites).toContainText("Aguardando aceite");
  await expect(page.getByRole("list", { name: "Benefícios" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "Simular uso real do indicado" }).click();
  await expect(page.getByText("Avaliação (simulação): 1 benefício concedido.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Benefícios" }).getByRole("listitem")).toHaveCount(2);
  await expect(summary).toContainText("100 perguntas");
  await page.getByRole("button", { name: "Simular uso real do indicado" }).click();
  await expect(page.getByText("Avaliação (simulação): 0 benefícios concedidos.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Benefícios" }).getByRole("listitem")).toHaveCount(2);

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

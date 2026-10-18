import { expect, type Page, test } from "@playwright/test";

const summary = (page: Page) => page.getByRole("region", { name: /Caixa registrado/ });
const received = (page: Page) => summary(page).locator("div").filter({ hasText: "Recebido" }).locator("dd");

test("caixa: recebido, estorno, crédito de pacote e despesa, sem misturar com o que foi agendado", async ({ page }) => {
  await page.goto("/app/caixa");
  await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
  await expect(page.getByText("Dados de exemplo.")).toBeVisible();
  await expect(received(page)).toHaveText("R$ 260,00");
  await expect(summary(page)).toContainText("Não é lucro");

  const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
  await expect(pending.getByRole("listitem")).toHaveCount(2);

  // Barba do Bruno paga em dinheiro: entra no caixa uma vez.
  const bruno = pending.getByRole("listitem").filter({ hasText: "Bruno" });
  await bruno.getByLabel("Forma").selectOption("cash");
  await bruno.getByRole("button", { name: /Marcar como recebido/ }).click();
  await expect(page.getByText(/Recebido R\$\s?40,00 \(Dinheiro\)/)).toBeVisible();
  await expect(received(page)).toHaveText("R$ 300,00");
  await expect(pending.getByRole("listitem")).toHaveCount(1);

  // Estorno: o recebimento original fica no histórico e sai do total.
  const payments = page.getByRole("region", { name: "Recebimentos no mês" });
  await payments.getByRole("listitem").filter({ hasText: "R$ 40,00" }).getByRole("button", { name: /Estornar/ }).click();
  await payments.getByLabel("Motivo do estorno").fill("Cliente pagou com Pix depois");
  await payments.getByRole("button", { name: "Confirmar estorno" }).click();
  await expect(received(page)).toHaveText("R$ 260,00");
  await expect(payments.getByText(/Estorno de R\$\s?40,00/)).toBeVisible();

  // Corte da Ana pago com crédito: debita o pacote, não gera caixa.
  await pending.getByRole("listitem").filter({ hasText: "Ana" }).getByRole("button", { name: /Usar crédito do pacote/ }).click();
  await expect(page.getByText(/Saldo: 3 sessões de 4/)).toBeVisible();
  await expect(received(page)).toHaveText("R$ 260,00");

  // Despesa registrada entra em "Gasto".
  await page.getByLabel("Valor da despesa (R$)").fill("20,00");
  await page.getByRole("button", { name: "Registrar despesa" }).click();
  await expect(summary(page).locator("div").filter({ hasText: "Gasto" }).locator("dd")).toHaveText("R$ 35,00");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("caixa: recebimento acima do que falta é explicado e nada é registrado", async ({ page }) => {
  await page.goto("/app/caixa");
  await page.getByLabel("Descrição", { exact: true }).fill("Pomada");
  await page.getByLabel("Valor (R$)", { exact: true }).fill("30,00");
  await page.getByRole("button", { name: "Criar cobrança" }).click();
  const open = page.getByRole("region", { name: "A receber" });
  await open.getByRole("button", { name: /Registrar recebimento de Pomada/ }).click();
  await open.getByLabel("Valor recebido (R$)").fill("45,00");
  await open.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(open.getByText(/passa do que falta receber/)).toBeVisible();
  await expect(received(page)).toHaveText("R$ 260,00");
});

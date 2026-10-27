import { expect, type Page, test } from "@playwright/test";

const summary = (page: Page) => page.getByRole("region", { name: /Caixa registrado/ });
const received = (page: Page) => summary(page).locator("div").filter({ hasText: "Recebido" }).locator("dd");
const spent = (page: Page) => summary(page).locator("div").filter({ hasText: "Gasto" }).locator("dd");
const cents = (t: string | null) => Number(t!.replace(/[^\d,-]/g, "").replace(",", "")) ;
/** "Sobrou no mês" bate com Recebido − Gasto exibidos. */
async function expectLeftover(page: Page) {
  const r = cents(await received(page).textContent());
  const g = cents(await spent(page).textContent());
  const left = cents(await page.getByTestId("fin-left").textContent());
  await expect(summary(page)).toContainText(r - g >= 0 ? "Sobrou no mês" : "Faltou no mês");
  expect(left).toBe(Math.abs(r - g));
}

test("caixa: recebido, estorno, crédito de pacote e despesa, sem misturar com o que foi agendado", async ({ page }) => {
  await page.goto("/app/caixa");
  await expect(page.getByRole("heading", { name: "Caixa", level: 1 })).toBeVisible();
  await expect(page.getByText("Dados de exemplo.")).toBeVisible();
  await expect(received(page)).toHaveText("R$ 260,00");
  await expect(summary(page)).toContainText("Não é lucro");
  // Destaque: sobrou = recebido − gasto, ambos como exibidos.
  await expectLeftover(page);
  // Mês com só a primeira letra maiúscula.
  await expect(page.getByRole("group", { name: "Período" })).toContainText(/[A-ZÇ][a-zç]+ de \d{4}/);
  await expect(page.getByRole("group", { name: "Período" })).not.toContainText(/ De \d{4}/);
  // Alerta dos atendimentos sem cobrança, com atalho para a seção.
  await expect(summary(page)).toContainText(/2 atendimentos sem cobrança · R\$\s?\d/);
  await summary(page).getByRole("link", { name: /Cobrar agora/ }).click();
  await expect(page.getByRole("heading", { name: "Atendimentos concluídos sem cobrança" })).toBeFocused();
  // A ressalva longa fica recolhida em "Como esse número é feito".
  const how = summary(page).locator("details");
  await expect(how.locator("summary")).toHaveText("Como esse número é feito");
  await expect(how).not.toHaveAttribute("open", "");

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
  await expect(spent(page)).toHaveText("R$ 35,00");
  await expectLeftover(page);
  await expect(page.getByTestId("fin-left")).toHaveText(/R\$\s?225,00/);

  // Estorno de despesa: mesmo padrão do recebimento (abre, explica, confirma).
  const expenses = page.getByRole("region", { name: "Despesas" });
  await expenses.getByRole("listitem").filter({ hasText: "R$ 20,00" }).getByRole("button", { name: /Estornar/ }).click();
  const confirm = expenses.getByRole("form", { name: /Estornar despesa/ });
  await expect(confirm).toContainText("Sai R$");
  await expect(spent(page)).toHaveText("R$ 35,00");
  await confirm.getByRole("button", { name: "Confirmar estorno" }).click();
  await expect(page.getByText("Despesa estornada.")).toBeVisible();
  await expect(spent(page)).toHaveText("R$ 15,00");

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

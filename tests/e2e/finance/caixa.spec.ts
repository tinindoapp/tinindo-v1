import { expect, type Locator, type Page, test } from "@playwright/test";

const summary = (page: Page) => page.getByRole("region", { name: /Caixa registrado/ });
/** Linha do resumo (P54: SummaryRows) pelo rótulo; devolve o valor. */
const row = (page: Page, label: string | RegExp) => summary(page).getByRole("listitem").filter({ hasText: label }).locator(".tn-summary__row-value");
const received = (page: Page) => row(page, "Recebido no mês");
const spent = (page: Page) => row(page, "Gasto no mês");
/** Histórico (P54): nasce recolhido; abre e escolhe a lista no segmentado. */
async function history(page: Page, tab: "Recebimentos" | "Despesas" | "Pacotes") {
  const fold = page.locator("details.tn-section--fold").filter({ has: page.getByRole("heading", { name: /^Histórico do mês/ }) });
  if ((await fold.getAttribute("open")) === null) await fold.locator("summary").click();
  await fold.getByRole("radio", { name: tab }).check();
  return page.getByRole("region", { name: { Recebimentos: "Recebimentos no mês", Despesas: "Despesas", Pacotes: "Pacotes de sessões" }[tab], exact: true });
}
/** Ação do menu "⋯" de uma linha. */
async function fromMenu(item: Locator, action: string | RegExp) {
  await item.getByRole("button", { name: /^Mais ações/ }).click();
  await item.getByRole("menuitem", { name: action }).click();
}
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
  // D11 (b): o aviso de demonstração fica só na faixa do topo.
  await expect(page.getByText("Dados de exemplo.")).toHaveCount(0);
  await expect(received(page)).toHaveText("R$ 1.740,00");
  await expect(summary(page)).toContainText("Não é lucro");
  // Destaque: sobrou = recebido − gasto, ambos como exibidos.
  await expectLeftover(page);
  // Mês com só a primeira letra maiúscula.
  await expect(page.getByRole("group", { name: "Período" })).toContainText(/[A-ZÇ][a-zç]+ de \d{4}/);
  await expect(page.getByRole("group", { name: "Período" })).not.toContainText(/ De \d{4}/);
  // Atendimentos sem cobrança (de qualquer mês, inclusive o Corte de 28/09) logo depois do resumo, com a contagem.
  await expect(page.getByRole("heading", { name: "Atendimentos concluídos sem cobrança" })).toHaveText(/^Atendimentos concluídos sem cobrança\s*·\s*3$/);
  // A ressalva longa fica recolhida em "Como esse número é feito".
  const how = summary(page).locator("details");
  await expect(how.locator("summary")).toHaveText("Como esse número é feito");
  await expect(how).not.toHaveAttribute("open", "");

  const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
  await expect(pending.getByRole("listitem")).toHaveCount(3);

  // Barba do Bruno paga em dinheiro: o atalho "Recebi R$ 40,00 no Pix ▾" troca a forma e entra no caixa uma vez.
  const bruno = pending.getByRole("listitem").filter({ hasText: "Bruno" }).filter({ hasText: "19/10/2026" });
  await expect(bruno.getByRole("button", { name: /^Recebi R\$\s?40,00 no Pix/ })).toBeVisible();
  // Uma ação visível por linha: "Cobrar depois" e o crédito ficam no "⋯".
  await expect(bruno.getByRole("button", { name: /Cobrar depois/ })).toHaveCount(0);
  const more = bruno.getByRole("button", { name: /Outra forma de pagamento/ });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await bruno.getByRole("radio", { name: "Dinheiro" }).check();
  await bruno.getByRole("button", { name: /^Recebi R\$\s?40,00 em dinheiro/ }).click();
  await expect(page.getByText(/Recebido R\$\s?40,00 \(Dinheiro\)/)).toBeVisible();
  await expect(received(page)).toHaveText("R$ 1.780,00");
  await expect(pending.getByRole("listitem")).toHaveCount(2);

  // Estorno: o recebimento original fica no histórico e sai do total.
  const payments = await history(page, "Recebimentos");
  await fromMenu(payments.getByRole("listitem").filter({ hasText: "Dinheiro · 20/10" }).filter({ hasText: "R$ 40,00" }), "Estornar");
  await expect(payments.getByRole("group", { name: /Estornar recebimento de R\$\s?40,00\?/ })).toBeVisible();
  await payments.getByLabel("Motivo do estorno").fill("Cliente pagou com Pix depois");
  await payments.getByRole("button", { name: "Sim, estornar" }).click();
  await expect(received(page)).toHaveText("R$ 1.740,00");
  await expect(payments.getByRole("listitem").filter({ hasText: "Estorno · Dinheiro" })).toHaveCount(1);

  // Corte da Ana pago com crédito (no "⋯"): debita o pacote, não gera caixa.
  await fromMenu(pending.getByRole("listitem").filter({ hasText: "Ana" }), /Usar crédito do pacote/);
  await expect(page.getByText(/Crédito usado\. Saldo: 3 sessões/)).toBeVisible();
  await expect((await history(page, "Pacotes")).getByText(/Saldo: 3 sessões de 4/)).toBeVisible();
  await expect(received(page)).toHaveText("R$ 1.740,00");

  // Despesa registrada entra em "Gasto" (o formulário abre pelo "+ Registrar").
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("radio", { name: "Despesa", exact: true }).check();
  await expect(page.getByLabel("Valor da despesa (R$)")).toBeVisible();
  await page.getByLabel("Valor da despesa (R$)").fill("20,00");
  await page.getByRole("button", { name: "Registrar despesa" }).click();
  await expect(spent(page)).toHaveText("R$ 335,00");
  await expectLeftover(page);
  await expect(page.getByTestId("fin-left")).toHaveText(/R\$\s?1\.405,00/);

  // Estorno de despesa: mesmo padrão do recebimento (abre, explica, confirma).
  const expenses = await history(page, "Despesas");
  await fromMenu(expenses.getByRole("listitem").filter({ hasText: "R$ 20,00" }), "Estornar");
  const confirm = expenses.getByRole("group", { name: /Estornar despesa/ });
  await expect(confirm).toContainText("Sai R$");
  await expect(spent(page)).toHaveText("R$ 335,00");
  await confirm.getByRole("button", { name: "Sim, estornar" }).click();
  await expect(page.getByRole("status").getByText(/Despesa estornada\./)).toBeVisible();
  await expect(spent(page)).toHaveText("R$ 315,00");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("caixa: recebimento acima do que falta é explicado e nada é registrado", async ({ page }) => {
  await page.goto("/app/caixa");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("radio", { name: "A receber", exact: true }).check();
  await page.getByLabel("Descrição", { exact: true }).fill("Pomada");
  await page.getByLabel("Valor (R$)", { exact: true }).fill("30,00");
  await page.getByRole("button", { name: "Criar cobrança" }).click();
  const open = page.getByRole("region", { name: "A receber" });
  await open.getByRole("button", { name: /Registrar recebimento de Pomada/ }).click();
  await open.getByLabel("Valor recebido (R$)").fill("45,00");
  await open.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(open.getByText(/passa do que falta receber/)).toBeVisible();
  await expect(received(page)).toHaveText("R$ 1.740,00");
});

test("caixa: pendências primeiro, formulários fechados até tocar em Registrar, com foco no primeiro campo", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app/caixa");
  const main = page.getByRole("main");
  await expect(main.getByRole("region", { name: "Atendimentos concluídos sem cobrança" })).toBeVisible();
  // Ordem (P54): resumo → pendências → A receber → histórico (recolhido).
  const order = (await main.locator("h2").allTextContents()).map((h) => h.trim());
  const at = (t: RegExp) => order.findIndex((h) => t.test(h));
  expect(at(/^Caixa registrado/)).toBe(0);
  expect(at(/^Atendimentos concluídos sem cobrança/)).toBe(1);
  expect(at(/^A receber/)).toBe(2);
  expect(at(/^Histórico do mês/)).toBe(3);
  // O número do mês logo no começo da tela, sem aviso de demonstração antes dele.
  expect((await page.getByTestId("fin-left").boundingBox())!.y).toBeLessThan(400);
  // Nenhum formulário aberto ao chegar.
  await expect(main.getByRole("form")).toHaveCount(0);
  // Histórico: os 5 mais recentes à vista; o resto a um toque.
  const recent = await history(page, "Recebimentos");
  await expect(recent.getByRole("listitem")).toHaveCount(5);
  await recent.getByRole("button", { name: /^Ver todos \(\d+\)$/ }).click();
  expect(await recent.getByRole("listitem").count()).toBeGreaterThan(5);

  const open = page.getByRole("button", { name: "Registrar", exact: true });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("region", { name: "Registrar" });
  // P48: abre em "Recebi" (valor, forma, cliente opcional), antes de Despesa, A receber e Pacote.
  await expect(panel.locator(".tn-segmented__option")).toHaveText(["Recebi", "Despesa", "A receber", "Pacote"]);
  await expect(panel.getByRole("form", { name: "Novo recebimento" })).toBeVisible();
  await expect(panel.getByLabel("Valor recebido (R$)")).toBeFocused();
  await panel.getByRole("radio", { name: "Despesa", exact: true }).check();
  await expect(panel.getByRole("form", { name: "Nova despesa" })).toBeVisible();
  await panel.getByRole("radio", { name: "Pacote", exact: true }).check();
  await expect(panel.getByRole("form", { name: "Vender pacote" })).toBeVisible();
  await panel.getByRole("radio", { name: "A receber", exact: true }).check();
  await panel.getByLabel("Descrição", { exact: true }).fill("Pomada");
  await panel.getByLabel("Valor (R$)", { exact: true }).fill("30,00");
  await panel.getByRole("button", { name: "Criar cobrança" }).click();
  await expect(page.getByRole("status").getByText(/Cobrança de R\$\s?30,00 criada/)).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("region", { name: "A receber" })).toContainText("Pomada");

  // Atalho de um toque: recebido no Pix, sem abrir formulário.
  const pending = page.getByRole("region", { name: "Atendimentos concluídos sem cobrança" });
  const bruno = pending.getByRole("listitem").filter({ hasText: "Bruno" }).filter({ hasText: "19/10/2026" });
  const quick = bruno.getByRole("button", { name: /^Recebi R\$\s?40,00 no Pix/ });
  expect((await quick.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await quick.click();
  await expect(page.getByText(/Recebido R\$\s?40,00 \(Pix\)/)).toBeVisible();
  await expect(bruno).toHaveCount(0);

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("caixa (P48): Hoje · Semana · Mês no topo e \"Recebi\" avulso entra nos três de uma vez", async ({ page }) => {
  await page.goto("/app/caixa");
  // P54: um resumo só; hoje e semana são linhas dele, o mês não se repete.
  const value = (label: string) => row(page, label);
  await expect(value("Recebido hoje")).toHaveText(/R\$\s?0,00/);
  await expect(value("Recebido no mês")).toHaveText(/R\$\s?1\.740,00/);
  await expect(summary(page)).toContainText("19/10 a 20/10");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  const form = page.getByRole("form", { name: "Novo recebimento" });
  await form.getByLabel("Valor recebido (R$)").fill("35");
  await form.getByLabel("Forma").selectOption("cash");
  await form.getByLabel("Cliente (opcional)").selectOption({ label: "Cliente Exemplo Bruno" });
  await form.getByRole("button", { name: "Salvar recebimento" }).dblclick();
  await expect(page.getByRole("status").getByText(/Recebimento de R\$\s?35,00 registrado \(Dinheiro, manual\)/)).toBeVisible();
  await expect(value("Recebido hoje")).toHaveText(/R\$\s?35,00/);
  await expect(received(page)).toHaveText("R$ 1.775,00");
  const payments = await history(page, "Recebimentos");
  await expect(payments.getByRole("listitem").filter({ hasText: "R$ 35,00" }).filter({ hasText: "Dinheiro · 20/10" })).toHaveCount(1);
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

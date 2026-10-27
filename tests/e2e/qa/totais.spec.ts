import { expect, type Page, test } from "@playwright/test";

// Item 47 da auditoria de UX: a demonstração mostra os mesmos totais em todas as telas de dinheiro e de resultado,
// no mesmo período. Antes, o Caixa tinha R$ 260, o Assistente R$ 160 na semana em que o Caixa tinha R$ 60, e as faltas
// eram 6,8% numa tela e 15% na outra. Todas leem agora a base de exemplo única (src/lib/demo/dataset.ts).
// Período comparado: outubro até agora (o relógio da demonstração está em 20/10, 09:00, sem nada registrado hoje).

const BRL = /R\$\s?[\d.]+,\d{2}/;
const money = (text: string) => {
  const m = BRL.exec(text);
  if (!m) throw new Error(`sem valor em reais: ${text}`);
  return m[0].replace(/\s/g, " ");
};

async function caixa(page: Page) {
  await page.goto("/app/caixa");
  const summary = page.getByRole("region", { name: /Caixa registrado em outubro/i });
  await expect(summary).toBeVisible();
  const value = (label: string) => summary.locator("div").filter({ hasText: label }).locator("dd").first().innerText();
  return { received: money(await value("Recebido")), spent: money(await value("Gasto")), open: money(await value("A receber")) };
}

async function resultado(page: Page) {
  await page.goto("/app/resultado");
  await page.getByLabel("Período").selectOption("month");
  const metrics = page.getByRole("region", { name: "Indicadores" });
  const card = (name: string) => metrics.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card("Faltas")).toContainText("De 01/10 a 19/10");
  return {
    received: money(await card("Recebimentos registrados").innerText()),
    spent: money(await card("Despesas registradas").innerText()),
    noShow: /Conta: (\d+) de (\d+)/.exec(await card("Faltas").innerText())!.slice(1, 3).join(" de "),
  };
}

async function metas(page: Page) {
  await page.goto("/app/metas");
  const form = page.getByRole("form", { name: "Nova meta" });
  const indicator = form.getByRole("combobox", { name: "Indicador" });
  const now = form.getByText(/^Em outubro até agora:/);
  const read = async (key: string) => {
    await indicator.selectOption(key);
    return now.innerText();
  };
  return {
    received: money(await read("received")),
    spent: money(await read("expenses")),
    noShow: /\((\d+ de \d+)\)/.exec(await read("no_show"))![1],
  };
}

async function assistente(page: Page) {
  await page.goto("/app/assistente");
  await page.getByRole("textbox").first().fill("quanto recebi este mês?");
  await page.getByRole("button", { name: "Perguntar" }).click();
  const answer = page.getByText(/^De 01\/10 a 20\/10: você recebeu/);
  await expect(answer).toBeVisible();
  return { received: money(await answer.innerText()) };
}

async function pagamentos(page: Page) {
  await page.goto("/app/pagamentos");
  const options = await page.getByLabel("Quem está devendo").locator("option").allInnerTexts();
  const cents = options.map((o) => BRL.exec(o)).filter(Boolean).map((m) => Number(m![0].replace(/[^\d]/g, "")));
  const total = cents.reduce((s, c) => s + c, 0);
  return { open: `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(total / 100)}` };
}

test("mesmos totais em Caixa, Resultado, Metas, Assistente e Pagamentos (outubro até agora)", async ({ page }) => {
  const c = await caixa(page);
  const r = await resultado(page);
  const m = await metas(page);
  const a = await assistente(page);
  const p = await pagamentos(page);

  // Recebido: as quatro telas que mostram o recebido do mês dizem o mesmo valor.
  expect(r.received).toBe(c.received);
  expect(m.received).toBe(c.received);
  expect(a.received).toBe(c.received);
  // Gasto.
  expect(r.spent).toBe(c.spent);
  expect(m.spent).toBe(c.spent);
  // Faltas: a mesma conta (quantos de quantos) no Resultado e nas Metas.
  expect(m.noShow).toBe(r.noShow);
  // A receber: o Caixa e a lista de quem está devendo em Pagamentos.
  expect(p.open).toBe(c.open);
});

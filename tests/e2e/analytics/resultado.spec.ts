import { expect, test } from "@playwright/test";

test("resultado: conta e denominador, dado ausente não vira zero, ponto de partida guardado e comparação sem causa", async ({ page }) => {
  await page.goto("/app/resultado");
  await expect(page.getByRole("heading", { name: "Resultado", level: 1 })).toBeVisible();
  // Um aviso só no topo (item 19): as ressalvas ficam em "Como funciona", recolhido.
  const help = page.locator("main details.tn-help");
  await expect(help.locator("summary")).toHaveText("Como funciona");
  await expect(help).toContainText("Comparar antes e depois não prova");
  await expect(help).not.toHaveAttribute("open", "");
  await expect(page.locator("main .tn-page-intro .tn-banner")).toHaveCount(0);

  // Dinheiro no topo (item 54): Recebido, Gasto e Sobrou = Recebido − Gasto.
  const money = page.getByRole("group", { name: "Recebido, gasto e o que sobrou" });
  const cents = async (label: string) => Number((await money.locator(".tn-stat").filter({ hasText: label }).locator(".tn-stat__value").innerText()).replace(/[^\d]/g, ""));
  await expect(money).toContainText("Recebido");
  const r = await cents("Recebido");
  const g = await cents("Gasto");
  expect(await cents(r - g >= 0 ? "Sobrou" : "Faltou")).toBe(Math.abs(r - g));

  const metrics = page.getByRole("region", { name: "Indicadores" });
  // O dinheiro não se repete nos cartões.
  await expect(metrics.getByRole("heading", { name: "Recebimentos registrados" })).toHaveCount(0);
  const occupancy = metrics.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Ocupação" }) });
  await expect(occupancy).toContainText(/Conta: [\d.]+ min de [\d.]+ min/);
  await expect(occupancy).toContainText("expediente menos bloqueios");
  const reminders = metrics.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Lembretes enviados" }) });
  await expect(reminders).toContainText("Conta: 43 de 57");
  await expect(reminders).toContainText("Enviado não é entregue nem lido");
  // Sem oferta de vaga no período: "Dados insuficientes", nunca 0%, agrupado no fim e não como cartão vazio.
  const missing = metrics.getByRole("region", { name: "Ainda sem dados suficientes" });
  await expect(missing.getByRole("listitem").filter({ hasText: "Ofertas de vaga aceitas" })).toContainText("Dados insuficientes");
  await expect(metrics.locator(".tn-an-metric").filter({ hasText: "Dados insuficientes" })).toHaveCount(0);
  const gaps = page.getByRole("region", { name: "O que falta nos dados" });
  await expect(gaps).toContainText("sem cobrança registrada");
  // Lacuna com atalho específico e alvo de 44 px (item 59).
  const charge = gaps.getByRole("link", { name: /^Cobrar \d+ atendimentos? →$/ });
  await expect(charge).toHaveAttribute("href", "/app/caixa");
  expect((await charge.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const form = page.getByRole("form", { name: "Guardar como ponto de partida" });
  await form.getByRole("button", { name: "Guardar ponto de partida" }).click();
  await expect(page.getByText(/Ponto de partida “Antes da Tinindo” guardado/)).toBeVisible();
  await page.getByLabel("Período").selectOption({ label: "Últimos 7 dias (até ontem)" });
  // Diferença com seta e palavra (a seta é só visual; o leitor de tela ouve "subiu" ou "caiu"), e se melhorou ou piorou conforme o indicador (item 54).
  await expect(occupancy).toContainText(/Ponto de partida: .* · [▲▼=] (?:subiu |caiu |ficou igual )?[\d.,]+ p\.p\. · (melhorou|piorou|sem mudança)/);
  await expect(reminders).toContainText(/Ponto de partida: .* · [▲▼=] (?:subiu |caiu |ficou igual )?[\d.,]+ p\.p\. · (melhorou|piorou|sem mudança)/);
  await expect(money).toContainText(/[▲▼=] (?:subiu |caiu |ficou igual )?R\$\s?[\d.,]+ · (melhorou|piorou|sem mudança)/);
  // Sem jargão nem indicador interno da Tinindo na tela do profissional.
  const body = await page.locator("main").innerText();
  expect(body.toLowerCase()).not.toContain("baseline");
  expect(body).not.toContain("Minutos da equipe Tinindo");
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
  // Tela da equipe Tinindo: não aparece no menu do profissional.
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Custo por cliente" })).toHaveCount(0);
  // No celular, cada linha é um cartão com o rótulo ao lado do valor, sem tabela cortada (item 60).
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const cell = table.locator("tbody td").first();
  if (width < 640) {
    await expect(cell).toHaveCSS("display", "flex");
    expect(await cell.evaluate((el) => getComputedStyle(el, "::before").content)).toContain("Min. humanos");
    const box = (await table.locator("tbody tr").first().boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  } else {
    await expect(cell).toHaveCSS("display", "table-cell");
  }
});

test("resultado: cartões alinhados pelo topo e, no desktop, item ativo do menu à vista", async ({ page }) => {
  await page.goto("/app/resultado");
  const cards = page.getByRole("region", { name: "Indicadores" }).locator(".tn-an-metric");
  await expect(cards.first()).toBeVisible();
  const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left })));
  const first = boxes[0]!;
  const row = boxes.filter((b) => b.top < first.bottom);
  // Item 55: sem "escada" — os cartões da mesma linha começam na mesma altura (no celular, uma coluna só).
  for (const b of row) expect(Math.abs(b.top - first.top)).toBeLessThan(1);
  if (page.viewportSize()!.width < 1024) {
    for (const b of boxes) expect(Math.abs(b.left - first.left)).toBeLessThan(1);
    return;
  }
  expect(row.length).toBeGreaterThan(1);

  // Item 60: o menu lateral rola até o item ativo.
  const nav = page.getByRole("navigation", { name: "Principal" });
  const active = nav.locator('[aria-current="page"]');
  await expect(active).toHaveText("Resultado");
  const n = (await nav.boundingBox())!;
  const a = (await active.boundingBox())!;
  expect(a.y).toBeGreaterThanOrEqual(n.y - 1);
  expect(a.y + a.height).toBeLessThanOrEqual(n.y + n.height + 1);
});

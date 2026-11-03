import { expect, test } from "@playwright/test";

test("contas: caixa do mês com período e cobertura, categoria própria, pagar com desfazer, não pagar duas vezes, mensal, conferir extrato", async ({ page }, info) => {
  // Celular estreito (375 px), além do desktop.
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/contas");
  await expect(page.getByRole("heading", { name: "Contas", level: 1 })).toBeVisible();
  await expect(page.getByText("nada sai do seu banco")).toBeVisible();

  // Caixa do mês: período escrito, entrou/saiu/sobrou, o que falta lançar, e não é DRE.
  await expect(page.getByRole("heading", { name: "Caixa de outubro de 2026" })).toBeVisible();
  await expect(page.getByText("Período: 1º a 31 de outubro de 2026 · fuso America/Sao_Paulo")).toBeVisible();
  const summary = page.getByRole("group", { name: "Resumo do mês" });
  await expect(summary).toContainText(/Entrou\s*R\$\s300,00/);
  await expect(summary).toContainText(/Saiu\s*R\$\s1\.535,00/);
  await expect(summary).toContainText(/Sobrou\s*-R\$\s1\.235,00/);
  const gaps = page.getByRole("region", { name: "O que falta lançar" });
  await expect(gaps).toContainText("1 atendimento(s) concluído(s) sem cobrança");
  await expect(gaps).toContainText("dia(s) com recebimento sem conferir o extrato");
  await expect(page.getByText(/Não é DRE/)).toBeVisible();

  // Categoria própria de receita e classificação da assinatura.
  await page.getByText("Categorias", { exact: true }).click();
  const catForm = page.getByRole("form", { name: "Nova categoria" });
  await catForm.getByText("Receita", { exact: true }).click();
  await catForm.getByLabel("Nome").fill("Planos mensais");
  await catForm.getByRole("button", { name: "Criar categoria" }).click();
  await expect(page.getByText("Categoria “Planos mensais” criada.")).toBeVisible();
  await page.getByText("Mês", { exact: true }).click();
  const entries = page.getByRole("list", { name: "Lançamentos para classificar" });
  await entries.getByRole("listitem").filter({ hasText: "Assinatura" }).getByLabel("Categoria").selectOption({ label: "Planos mensais" });
  await expect(page.getByText("Categoria salva.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Entradas por categoria" })).toContainText(/Planos mensais\s*R\$\s200,00/);

  // Pagar com "Desfazer"; pagar de novo; estornar com confirmação.
  await page.getByText("A pagar", { exact: true }).click();
  const list = page.getByRole("list", { name: "Contas a pagar" });
  const luz = list.getByRole("listitem").filter({ hasText: "Conta de luz" });
  await expect(luz).toContainText("A pagar");
  await luz.getByRole("button", { name: /^Pagar Conta de luz/ }).click();
  await expect(page.getByText("“Conta de luz” paga: R$ 180,00 saiu no Caixa.")).toBeVisible();
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Pagamento desfeito: a despesa foi estornada no Caixa.")).toBeVisible();
  await expect(luz).toContainText("1 estorno(s)");
  await luz.getByRole("button", { name: /^Pagar Conta de luz/ }).click();
  await expect(luz).toContainText("Paga");
  await expect(luz.getByRole("button", { name: /^Pagar/ })).toHaveCount(0);
  await luz.getByRole("button", { name: "Estornar pagamento de Conta de luz" }).click();
  await expect(luz.getByRole("group", { name: "Estornar o pagamento?" })).toContainText("volta a ficar a pagar");
  await luz.getByRole("button", { name: "Sim, estornar" }).click();
  await expect(page.getByText("Pagamento estornado no Caixa.")).toBeVisible();
  await expect(luz).toContainText("2 estorno(s)");

  // Nova conta: erros embaixo dos campos; conta mensal cria 12.
  await page.getByRole("button", { name: "Nova conta" }).click();
  const form = page.getByRole("form", { name: "Nova conta a pagar" });
  await form.getByRole("button", { name: "Criar conta" }).click();
  await expect(form.getByText("Diga o que é a conta (ex.: aluguel).")).toBeVisible();
  await expect(form.getByText("Informe o valor.")).toBeVisible();
  await form.getByLabel("O que é").fill("Contador");
  await form.getByLabel("Valor (R$)").fill("250,00");
  await form.getByLabel("Vencimento").fill("2026-10-20");
  await form.getByLabel("Categoria").selectOption({ label: "Taxas" });
  await form.getByLabel(/Repetir todo mês/).check();
  await form.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("“Contador” todo mês: 12 contas criadas, a primeira vence em 20/10/2026.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Contas mensais" })).toContainText("Contador");

  // Conferir o extrato de um dia: diferença.
  await page.getByText("Conferir", { exact: true }).click();
  await page.getByLabel("Dia").fill("2026-10-14");
  const rows = page.getByRole("list", { name: "Recebimentos por meio" });
  const pix = rows.getByRole("listitem").filter({ hasText: "Pix registrado à mão" });
  await expect(pix).toContainText("registrado R$ 60,00");
  await pix.getByLabel("Valor no extrato (R$)").fill("55,00");
  await pix.getByRole("button", { name: "Conferir" }).click();
  await expect(pix).toContainText("Conferido com diferença de -R$ 5,00");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

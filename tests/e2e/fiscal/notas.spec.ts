import { expect, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

test("notas fiscais: passo a passo até elegível, nota em homologação não é pagamento, cancelamento com motivo e pasta do contador", async ({ page }) => {
  await page.goto("/app");
  await openFromNav(page, "Notas fiscais");
  await expect(page.getByRole("heading", { name: "Notas fiscais", level: 1 })).toBeVisible();
  await expect(page.getByText("Emitir a nota não é receber")).toBeVisible();
  await expect(page.getByText("As notas daqui são de teste e não têm valor fiscal.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova nota" })).toHaveCount(0);
  const missing = page.getByRole("list", { name: "O que falta" });
  await expect(missing).toContainText("Preencha os dados fiscais do negócio.");

  const profile = page.getByRole("form", { name: "Dados fiscais" });
  await profile.getByLabel("Razão social").fill("Barbearia Exemplo A ME");
  await profile.getByLabel("CNPJ").fill("11.222.333/0001-80");
  const ibge = profile.getByLabel("Código da sua cidade (IBGE)");
  await expect(ibge).toHaveAccessibleDescription(/7 números.*São Paulo 3550308/);
  await ibge.fill("3550308");
  await profile.getByRole("button", { name: "Salvar dados fiscais" }).click();
  await expect(page.getByText("CNPJ inválido. Confira os números.")).toBeVisible();
  await profile.getByLabel("CNPJ").fill("11.222.333/0001-81");
  await profile.getByRole("button", { name: "Salvar dados fiscais" }).click();
  await expect(page.getByText("Dados fiscais salvos.")).toBeVisible();
  await expect(page.getByText(/CNPJ 11\.222\.333\/0001-81 · MEI/)).toBeVisible();

  await page.getByRole("button", { name: "Autorizo nestes termos" }).click();
  await expect(page.getByText("Autorização registrada por um ano.")).toBeVisible();
  await page.getByRole("button", { name: "Conferir credencial" }).click();
  await expect(page.getByText(/Tudo pronto: você pode emitir notas/)).toBeVisible();

  await page.getByRole("button", { name: "Nova nota" }).click();
  const form = page.getByRole("form", { name: "Nova nota" });
  await expect(form.getByLabel("Nome do cliente (tomador)")).toHaveValue("Ana Beatriz (exemplo)");
  await form.getByLabel("CPF ou CNPJ do cliente (opcional)").fill("123.456.789-09");
  // Antes de emitir, a tela mostra tudo para conferir; "Corrigir" volta ao formulário com os dados.
  await expect(form.getByRole("button", { name: "Emitir nota" })).toHaveCount(0);
  await form.getByRole("button", { name: "Revisar a nota" }).click();
  await expect(page.getByRole("heading", { name: "Confira antes de emitir" })).toBeVisible();
  const data = page.getByLabel("Dados da nota");
  await expect(data).toContainText("Ana Beatriz (exemplo)");
  await expect(data).toContainText("Cliente (tomador)");
  await expect(data).toContainText("123.456.789-09");
  await expect(data).toContainText(/R\$\s?\d/);
  await expect(data).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  await expect(data).toContainText("Homologação (teste, sem valor fiscal)");
  await expect(page.getByRole("list", { name: "Notas emitidas" })).not.toContainText("Nota H000001");
  await page.getByRole("button", { name: "Corrigir" }).click();
  await expect(form.getByLabel("CPF ou CNPJ do cliente (opcional)")).toHaveValue("123.456.789-09");
  await form.getByRole("button", { name: "Revisar a nota" }).click();
  await page.getByRole("button", { name: "Emitir nota" }).click();
  await expect(page.getByText("Emitir não registra recebimento: o Caixa continua igual.")).toBeVisible();
  const list = page.getByRole("list", { name: "Notas emitidas" });
  await expect(list).toContainText("Nota H000001");
  await expect(list).toContainText("Autorizada");
  await expect(list).toContainText("homologação");
  await expect(list).not.toContainText("12345678909");

  await list.getByRole("button", { name: "Cancelar nota" }).click();
  const cancel = page.getByRole("form", { name: /Cancelar nota H000001/ });
  await expect(cancel.getByRole("button", { name: "Pedir cancelamento" })).toBeDisabled();
  await cancel.getByLabel("Motivo do cancelamento").fill("Valor lançado errado no atendimento");
  await cancel.getByRole("button", { name: "Pedir cancelamento" }).click();
  await expect(list).toContainText("Cancelada");

  // Mês padrão = mês corrente, o mesmo da data do serviço preenchida.
  await page.getByRole("button", { name: "Ver pasta" }).click();
  const folder = page.getByRole("region", { name: /Pasta de \d{4}-\d{2}/ });
  await expect(folder).toContainText("0 nota(s) válida(s)");
  await expect(folder).toContainText("1 cancelada(s)");

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

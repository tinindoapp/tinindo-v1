import { expect, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

test("diretório: dono entra com cidade e dias, cartão só com o que o perfil mostra; busca pública com filtros e critérios", async ({ page }) => {
  await page.goto("/app");
  await openFromNav(page, "Diretório");
  await expect(page.getByRole("heading", { name: "Diretório", level: 1 })).toBeVisible();
  const form = page.getByRole("form", { name: "Diretório" });
  await form.getByLabel("Cidade").fill("São Paulo");
  await form.getByLabel(/Mostrar os dias em que atendo/).check();
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Pronto: seu negócio aparece no diretório.")).toBeVisible();
  const card = page.getByRole("list", { name: "Seu cartão no diretório" });
  await expect(card).toContainText("Barbearia Exemplo A");
  await expect(card).toContainText("Atende seg, ter, qua, qui, sex");

  await page.getByRole("link", { name: "Ver no diretório" }).click();
  await expect(page).toHaveURL(/\/diretorio\/sp\/sao-paulo\/barber$/);
  await expect(page.getByRole("heading", { name: "Barbearias em São Paulo/SP", level: 1 })).toBeVisible();
  const results = page.getByRole("list", { name: "Resultados" });
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText(/ordem alfabética do nome exibido · sem destaque pago/)).toBeVisible();
  // Ordem alfabética: "Barbearia Exemplo A" antes do perfil sem nome público (mostra a área "Moema").
  await expect(results.getByRole("listitem").first()).toContainText("Barbearia Exemplo A");
  await page.getByLabel("Atende no dia").selectOption("6");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results).not.toContainText("Barbearia Exemplo A");
  await page.getByText("Como os resultados são escolhidos").click();
  await expect(page.getByText(/Nunca: destaque pago, nota ou avaliação/)).toBeVisible();

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("diretório público: índice de cidades", async ({ page }) => {
  await page.goto("/diretorio");
  await expect(page.getByRole("heading", { name: "Encontre um profissional", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Cidades" })).toContainText("São Paulo/SP");
});

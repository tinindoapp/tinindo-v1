import { expect, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

test("site e Google: rascunho, prévia só pública, publicar a prévia, página pública, domínio por DNS, acesso ao Google e entregas", async ({ page }) => {
  await page.goto("/app");
  await openFromNav(page, "Site e Google");
  await expect(page.getByRole("heading", { name: "Site e Google", level: 1 })).toBeVisible();
  await expect(page.getByText("Sem promessa de posição.")).toBeVisible();
  await expect(page.getByText("o DNS é simulado")).toBeVisible();

  const form = page.getByRole("form", { name: "Conteúdo do site" });
  await form.getByLabel("Frase de apresentação (opcional)").fill("Corte na hora marcada");
  await form.getByLabel("Preços dos serviços").check();
  await form.getByLabel("Horários de atendimento").check();
  await form.getByRole("checkbox", { name: /Corte/ }).check();
  await form.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho salvo. Nada foi ao ar")).toBeVisible();

  const preview = page.getByRole("article", { name: /Prévia do site de Barbearia Exemplo A/ });
  await expect(preview).toContainText("Corte na hora marcada");
  await expect(preview).toContainText(/R\$\s60,00/);
  await expect(preview).toContainText("Segunda");
  await expect(preview).not.toContainText(/45,00|15,00/);
  await page.getByRole("button", { name: "Publicar esta versão" }).click();
  await expect(page.getByText("Site publicado: esta versão está no ar.")).toBeVisible();
  await expect(page.getByText("No ar · versão 1")).toBeVisible();
  await expect(page.getByText("Esta prévia é exatamente o que está no ar.")).toBeVisible();

  // Domínio do cliente: sem o registro não verifica; com o registro (simulado) verifica.
  const domain = page.getByRole("form", { name: "Ligar domínio" });
  await domain.getByLabel("Seu domínio").fill("MinhaBarbearia.com.br");
  await domain.getByRole("button", { name: "Ligar domínio" }).click();
  await expect(page.getByText("_tinindo-verify.minhabarbearia.com.br")).toBeVisible();
  await page.getByRole("button", { name: "Verificar agora" }).click();
  await expect(page.getByText("O registro ainda não apareceu no DNS").first()).toBeVisible();
  await page.getByRole("button", { name: "Simular registro no DNS (demonstração)" }).click();
  await page.getByRole("button", { name: "Verificar agora" }).click();
  await expect(page.getByText("Registro encontrado: domínio verificado.")).toBeVisible();
  await expect(page.getByText(/minhabarbearia\.com\.br · verificado em/)).toBeVisible();

  // Google: só registra com a declaração (o botão avisa o que falta embaixo do campo); revogar fica disponível.
  const google = page.getByRole("form", { name: "Conceder acesso ao Google" });
  await google.getByLabel("Nome do perfil no Google").fill("Barbearia Exemplo A");
  await google.getByRole("button", { name: "Registrar acesso" }).click();
  await expect(google.getByText("Confirme que adicionou a Tinindo como gerente.")).toBeVisible();
  await expect(google.getByLabel(/Adicionei a Tinindo como gerente/)).toBeFocused();
  await google.getByLabel(/Adicionei a Tinindo como gerente/).check();
  await google.getByRole("button", { name: "Registrar acesso" }).click();
  await expect(page.getByText(/Acesso concedido ao perfil “Barbearia Exemplo A” como gerente/)).toBeVisible();
  // Revogar corta o acesso de terceiros: pede confirmação com a consequência antes de executar.
  await page.getByRole("button", { name: "Revogar acesso" }).click();
  await expect(page.getByText("Revogar o acesso da Tinindo?")).toBeVisible();
  await expect(page.getByText(/para de agir no perfil “Barbearia Exemplo A”/)).toBeVisible();
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByText(/Acesso concedido ao perfil/)).toBeVisible();

  const deliveries = page.getByRole("list", { name: "Entregas" });
  await expect(deliveries).toContainText("Site publicado");
  await expect(deliveries).toContainText("Domínio verificado");
  await expect(deliveries).toContainText("Acesso ao Google concedido");

  // A página pública mostra a versão aprovada.
  await page.getByRole("link", { name: "Ver página pública" }).click();
  await expect(page).toHaveURL(/\/s\/barbearia-exemplo-a$/);
  await expect(page.getByRole("heading", { name: "Barbearia Exemplo A", level: 1 })).toBeVisible();
  await expect(page.getByText("Corte na hora marcada")).toBeVisible();
  await expect(page.getByText("Página feita com a Tinindo · versão 1")).toBeVisible();

  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("site público sem publicação: não encontrado", async ({ page }) => {
  await page.goto("/s/nao-existe");
  await expect(page.getByRole("heading", { name: "Site não encontrado" })).toBeVisible();
});

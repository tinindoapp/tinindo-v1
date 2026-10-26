import { expect, test } from "@playwright/test";

// Rotas públicas do P09 montadas no roteador: /p/:slug, /convite e /indicar.
// Demonstração offline: o estado vive na aba, então os fluxos usam navegação do próprio app.

test("perfil público abre fora do shell, sem dados privados; escolher horário não reserva", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-publica");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();

  await expect(page).toHaveURL(/\/p\/barbearia-publica$/);
  await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("Demonstração");
  await expect(page.getByRole("heading", { name: "Barbearia Exemplo A" })).toBeVisible();
  // Mesmo resumo da lista de avaliações da demonstração (2 de exemplo), com link para ela.
  await expect(page.getByRole("link", { name: "2 avaliações de clientes" })).toHaveAttribute("href", "/avaliacoes/barbearia-publica");
  await expect(page.locator("body")).not.toContainText("10000000-0000-4000-8000-00000000000a");
  const slots = page.getByRole("list", { name: "Horários livres" });
  await slots.getByRole("button").first().click();
  // Escolher só abre o pedido (nome, WhatsApp e código); o fluxo completo está em public-booking.spec.ts.
  await expect(page.getByRole("form", { name: "Pedir horário" })).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("perfil inexistente mostra página amigável", async ({ page }) => {
  await page.goto("/p/nao-existe");
  await expect(page.getByRole("heading", { name: "Perfil não encontrado" })).toBeVisible();
});

test("convite: abrir não aceita, token sai da URL e aceitar é ação explícita", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("quem-convida");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByLabel("Nome do colega (só você vê)").fill("Colega Exemplo");
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = new URL(await page.getByLabel("Link para compartilhar").inputValue());

  // Navegação do app (sem recarregar) para manter a demonstração da aba.
  await page.evaluate((href) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `${link.pathname}${link.hash}`);

  await expect(page.getByRole("heading", { name: "Você recebeu um convite de um colega" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("link", { name: "Ver o perfil de quem convidou" })).toHaveAttribute("href", "/p/quem-convida");
  await page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(page.getByText(/Convite aceito\. Demonstração: nada foi salvo\./)).toBeVisible();
});

test("convite desconhecido some da URL e aparece como indisponível", async ({ page }) => {
  await page.goto(`/convite#t=${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Convite indisponível" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});

test("cliente indica profissional sem telefone e sem envio automático", async ({ page }) => {
  await page.goto("/indicar");
  await expect(page.getByRole("heading", { name: "Indicar um profissional" })).toBeVisible();
  await expect(page.getByLabel(/telefone/i)).toHaveCount(0);
  await page.getByLabel("Nome do profissional (só você vê)").fill("Profissional Exemplo");
  await page.getByRole("button", { name: "Gerar link de indicação" }).click();
  const value = await page.getByLabel("Link para compartilhar").inputValue();
  expect(value).toMatch(/\/convite#t=[A-Za-z0-9_-]{43}$/);
  expect(value).not.toContain("Profissional");
});

import { expect, test } from "@playwright/test";
import { openFromNav } from "../qa/helpers.ts";

// Fluxo do dono em demonstração offline (sem servidor): publicar perfil, ver a prévia com
// horários livres e gerar convite de colega. Rotas públicas: tests/e2e/network/public.spec.ts.

async function noHorizontalScroll(page: import("@playwright/test").Page) {
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
}

test("dono publica o perfil, vê a prévia e gera convite sem envio automático", async ({ page }) => {
  await page.goto("/app");
  await openFromNav(page, "Perfil");
  await expect(page.getByRole("heading", { name: "Seu perfil público" })).toBeVisible();
  await expect(page.getByText("Demonstração: nada é salvo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Convidar um colega" })).toHaveCount(0);

  await page.getByLabel("Endereço do perfil").fill("Barbearia do Centro");
  await expect(page.getByLabel("Endereço do perfil")).toHaveValue("barbearia-do-centro");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Perfil publicado." })).toBeVisible();
  await expect(page.getByRole("region", { name: /Primeiros passos/ })).toContainText("2 de 3");
  await noHorizontalScroll(page);

  await page.getByRole("link", { name: "Ver como o cliente vê" }).click();
  await expect(page).toHaveURL(/\/app\/perfil\/previa$/);
  await expect(page.getByRole("heading", { name: "Barbearia Exemplo A" })).toBeVisible();
  await expect(page.getByText("Perfil novo · ainda sem avaliações")).toBeVisible();
  const slots = page.getByRole("list", { name: "Horários livres" });
  await expect(slots.getByRole("button", { name: "12:00" })).toBeVisible();
  await slots.getByRole("button", { name: "12:00" }).click();
  await expect(page.getByText("Demonstração: nada foi reservado.")).toBeVisible();
  const box = await slots.getByRole("button", { name: "12:00" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await noHorizontalScroll(page);

  await page.getByRole("link", { name: "Voltar ao perfil" }).click();
  await page.getByLabel("Nome do colega (só você vê)").fill("Colega Exemplo");
  await page.getByRole("button", { name: "Gerar link de convite" }).click();
  const link = await page.getByLabel("Link para compartilhar").inputValue();
  expect(new URL(link).search).toBe("");
  expect(link).toMatch(/\/convite#t=[A-Za-z0-9_-]{43}$/);
  expect(link).not.toContain("Colega");
  await expect(page.getByText("A Tinindo não manda mensagem para ninguém.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: /Primeiros passos/ })).toContainText("3 de 3");
  await noHorizontalScroll(page);
});

test("dono tira o perfil do ar e a prévia deixa de mostrá-lo", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("perfil-temporario");
  await page.getByLabel("Bairro ou região").fill("Zona Sul");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("button", { name: "Tirar do ar" }).click();
  await expect(page.getByText(/Perfil removido do ar/)).toBeVisible();
  await page.goto("/app/perfil/previa");
  // Navegação completa recarrega a demonstração: nada persiste fora da aba.
  await expect(page.getByRole("heading", { name: "Perfil ainda não publicado" })).toBeVisible();
});

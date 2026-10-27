import { expect, type Locator, test } from "@playwright/test";

// Onda 1 da auditoria de UX (itens 16, E3 e E6): campos das páginas públicas com a linguagem do app, texto do código
// que vai para o WhatsApp de quem pede e o cartão "Seu perfil está no ar!" com o link para mandar.
async function height(l: Locator) {
  const box = await l.boundingBox();
  return box?.height ?? 0;
}

test("dono publica e recebe o link pronto para mandar; no /p/:slug os campos têm 44 px e o texto do código é o novo", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-ux");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();

  const card = page.getByRole("region", { name: "Seu perfil está no ar!" });
  await expect(card).toBeVisible();
  const url = await card.getByLabel("Endereço do seu perfil").inputValue();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/p\/barbearia-ux$/);
  const wa = card.getByRole("link", { name: "Mandar no WhatsApp" });
  const href = (await wa.getAttribute("href"))!;
  expect(href.startsWith("https://wa.me/?text=")).toBe(true);
  expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toContain(url);
  await expect(card.getByRole("button", { name: "Copiar link" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver como o cliente vê" })).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-ux$/);
  const slots = page.getByRole("list", { name: "Horários livres" });
  await slots.getByRole("button").first().click();
  await expect(page.getByText(/Vamos mandar um código de 6 dígitos para o\s+seu WhatsApp para confirmar/)).toBeVisible();
  await expect(page.getByText(/WhatsApp do profissional/)).toHaveCount(0);
  for (const field of [page.getByLabel("Serviço"), page.getByLabel("Seu nome"), page.getByLabel("WhatsApp com DDD")]) {
    expect(await height(field)).toBeGreaterThanOrEqual(44);
  }
  if (test.info().project.name === "mobile") {
    // Tela de toque: 16 px ou mais, para o Safari não ampliar a tela ao tocar.
    const size = await page.getByLabel("Seu nome").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  }
});

test("/avaliar: cada opção de nota tem 44 × 44 e nome acessível com a palavra", async ({ page }) => {
  await page.goto("/avaliar");
  const form = page.getByRole("form", { name: /Avaliar Corte em Barbearia Exemplo A/ });
  const words = ["1 – Ruim", "2 – Regular", "3 – Bom", "4 – Muito bom", "5 – Excelente"];
  for (const name of words) {
    const radio = form.getByRole("radio", { name, exact: true });
    await expect(radio).toBeVisible();
    const box = await radio.locator("xpath=..").boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await form.getByRole("radio", { name: "4 – Muito bom" }).check();
  await expect(form.getByRole("radio", { name: "4 – Muito bom" })).toBeChecked();
  await expect(form.getByRole("button", { name: "Publicar avaliação" })).toBeEnabled();
});

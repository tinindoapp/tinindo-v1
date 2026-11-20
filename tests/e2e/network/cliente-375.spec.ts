import { expect, type Page, test } from "@playwright/test";

// P55 · Páginas do cliente final em 375 px (celular pequeno): o negócio primeiro (D18), a Tinindo só no rodapé, nenhuma
// rolagem horizontal e "não encontrado" sempre com saída. Demonstração offline: o perfil vive na aba.
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

const soft = (page: Page, to: string) =>
  page.evaluate((href) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);

test("375 px: perfil com o negócio no topo, reserva na primeira tela e rodapé da Tinindo", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-375");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-375$/);

  const name = page.getByRole("heading", { name: "Barbearia Exemplo A", level: 1 });
  await expect(name).toBeVisible();
  // Sem foto: a inicial ocupa o lugar dela.
  await expect(page.locator(".tn-pub-avatar")).toHaveText("B");
  const step = page.getByRole("heading", { name: "Escolha o serviço" });
  await expect(step).toBeVisible();
  expect((await step.boundingBox())!.y).toBeLessThan(812);
  await expect(page.locator("footer.tn-pub-foot")).toContainText("Página feita com a Tinindo");
  await noHorizontalScroll(page);

  // Do passo 2 em diante o cabeçalho recolhe e o resto da página sai da frente.
  await page.getByRole("button", { name: "Escolher dia e hora" }).click();
  await expect(page.locator(".tn-pub-head[data-compact]")).toBeVisible();
  await expect(page.getByRole("list", { name: "Reputação" })).toHaveCount(0);
  await noHorizontalScroll(page);
});

test("375 px: links sem token válido mostram 'não encontrado' com saída", async ({ page }) => {
  await page.goto("/p/nao-existe-375");
  await expect(page.getByRole("heading", { name: "Perfil não encontrado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await noHorizontalScroll(page);

  for (const [path, title] of [
    ["/pagar", "Este link de pagamento não vale mais"],
    ["/orcamento", "Este orçamento não está mais disponível"],
  ] as const) {
    await soft(page, path);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    await expect(page.locator("footer.tn-pub-foot")).toContainText("Página feita com a Tinindo");
    await noHorizontalScroll(page);
  }
});
